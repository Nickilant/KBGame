import os
import time
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket
from sqlalchemy import distinct, func, text
from sqlalchemy.exc import OperationalError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .auth import create_access_token, hash_password, verify_password
from .database import Base, engine, get_db
from .deps import get_current_user, require_roles
from .models import (
    Boss,
    Channel,
    Inventory,
    Item,
    Message,
    Post,
    PostComment,
    PostLike,
    PostReaction,
    PostView,
    Room,
    RoomInvite,
    RoomMember,
    RoomUserState,
    User,
)
from .raid import boss_auto_attack, get_raid_state, player_attack, start_raid, stop_raid
from .schemas import (
    AttackOut,
    BanIn,
    BossIn,
    ChannelIn,
    LoginIn,
    LootUpdateIn,
    MessageIn,
    PasswordUpdateIn,
    PostCommentIn,
    PostIn,
    PostReactionIn,
    RegisterIn,
    RoleUpdateIn,
    RoomIn,
    RoomUpdateIn,
    StatUpdateIn,
    TokenOut,
    UserOut,
)
from .ws import ws_manager

app = FastAPI(title="KB Raid Game")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def apply_compat_migrations():
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_read_post_id INTEGER"))
        connection.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS audio_url VARCHAR(255) DEFAULT ''"))
        connection.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS channel_id INTEGER"))

        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255) DEFAULT ''"))
        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS allow_media BOOLEAN DEFAULT TRUE"))
        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cooldown_enabled BOOLEAN DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER DEFAULT 0"))
        connection.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS join_code VARCHAR(24)"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_rooms_join_code ON rooms(join_code)"))
        connection.execute(text("ALTER TABLE room_members ADD COLUMN IF NOT EXISTS nickname_color VARCHAR(16) DEFAULT '#9fc5ff'"))
        connection.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url VARCHAR(255) DEFAULT ''"))
        connection.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(32) DEFAULT ''"))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS room_members (
                id SERIAL PRIMARY KEY,
                room_id INTEGER REFERENCES rooms(id) NOT NULL,
                user_id INTEGER REFERENCES users(id) NOT NULL,
                joined_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_room_member UNIQUE (room_id, user_id)
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS room_invites (
                id SERIAL PRIMARY KEY,
                room_id INTEGER REFERENCES rooms(id) NOT NULL,
                invited_user_id INTEGER REFERENCES users(id) NOT NULL,
                invited_by INTEGER REFERENCES users(id) NOT NULL,
                status VARCHAR(16) DEFAULT 'pending' NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_room_invite UNIQUE (room_id, invited_user_id)
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS room_user_rules (
                id SERIAL PRIMARY KEY,
                room_id INTEGER REFERENCES rooms(id) NOT NULL,
                user_id INTEGER REFERENCES users(id) NOT NULL,
                cooldown_seconds INTEGER DEFAULT 0 NOT NULL,
                can_attach_media BOOLEAN DEFAULT TRUE NOT NULL,
                CONSTRAINT uq_room_user_rule UNIQUE (room_id, user_id)
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS room_user_states (
                id SERIAL PRIMARY KEY,
                room_id INTEGER REFERENCES rooms(id) NOT NULL,
                user_id INTEGER REFERENCES users(id) NOT NULL,
                last_message_at TIMESTAMP NULL,
                CONSTRAINT uq_room_user_state UNIQUE (room_id, user_id)
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS channels (
                id SERIAL PRIMARY KEY,
                name VARCHAR(128) UNIQUE NOT NULL,
                avatar_url VARCHAR(255) DEFAULT '',
                created_by INTEGER REFERENCES users(id) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        connection.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE constraint_name = 'posts_channel_id_fkey'
                    AND table_name = 'posts'
                ) THEN
                    ALTER TABLE posts
                    ADD CONSTRAINT posts_channel_id_fkey
                    FOREIGN KEY (channel_id) REFERENCES channels(id);
                END IF;
            END$$;
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS post_reactions (
                id SERIAL PRIMARY KEY,
                post_id INTEGER REFERENCES posts(id),
                user_id INTEGER REFERENCES users(id),
                emoji VARCHAR(16) NOT NULL,
                CONSTRAINT uq_post_reaction_user UNIQUE (post_id, user_id)
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS post_comments (
                id SERIAL PRIMARY KEY,
                post_id INTEGER REFERENCES posts(id),
                user_id INTEGER REFERENCES users(id),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS post_views (
                id SERIAL PRIMARY KEY,
                post_id INTEGER REFERENCES posts(id),
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_post_view_user UNIQUE (post_id, user_id)
            )
        """))


@app.on_event("startup")
def init_data():
    max_retries = 10
    for attempt in range(1, max_retries + 1):
        try:
            with engine.begin() as connection:
                connection.execute(text("SELECT 1"))
            Base.metadata.create_all(bind=engine)
            apply_compat_migrations()
            break
        except OperationalError:
            if attempt == max_retries:
                raise
            time.sleep(2)

    db = next(get_db())
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        admin = User(username="admin", password_hash=hash_password("admin123"), role="admin")
        db.add(admin)
        db.flush()
    elif admin.role not in {"admin", "master_admin"}:
        admin.role = "admin"

    if not db.query(User).filter(User.username == "root_admin").first():
        db.add(User(username="root_admin", password_hash=hash_password("root_admin_123"), role="admin"))

    global_room = db.query(Room).filter(Room.name == "global").first()
    if not global_room:
        global_room = Room(name="global", avatar_url="", created_by=admin.id, is_main=True, join_code="GLOBAL")
        db.add(global_room)
        db.flush()
    else:
        global_room.is_main = True
        if not global_room.join_code:
            global_room.join_code = "GLOBAL"

    if not db.query(RoomMember).filter(RoomMember.room_id == global_room.id, RoomMember.user_id == admin.id).first():
        db.add(RoomMember(room_id=global_room.id, user_id=admin.id, nickname_color=_pastel_from_seed(global_room.id, admin.id)))

    stale_members = db.query(RoomMember).filter((RoomMember.nickname_color.is_(None)) | (RoomMember.nickname_color == "#9fc5ff")).all()
    for member in stale_members:
        member.nickname_color = _pastel_from_seed(member.room_id, member.user_id)


    if not db.query(Boss).first():
        db.add(Boss(name="Goblin King", hp=2000, max_hp=2000, attack=40, defense=12, abilities=["smash"], is_active=True))
    if not db.query(Item).first():
        db.add_all([
            Item(name="Rusty Sword", rarity="common", attack_bonus=2, defense_bonus=0, drop_chance=0.5),
            Item(name="Night Shield", rarity="rare", attack_bonus=0, defense_bonus=5, drop_chance=0.3),
            Item(name="Dragon Fang", rarity="epic", attack_bonus=8, defense_bonus=2, drop_chance=0.1),
        ])
    db.commit()
    db.close()


@app.post("/api/auth/register", response_model=UserOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(400, "Username exists")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role="player")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/api/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if user.is_banned:
        raise HTTPException(403, "Banned user")
    return TokenOut(access_token=create_access_token(user.username))


@app.get("/api/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@app.post("/api/raid/start")
def raid_start(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active_boss = db.query(Boss).filter(Boss.is_active.is_(True)).first()
    if not active_boss:
        raise HTTPException(400, "No active boss")
    if user.role == "boss":
        if not db.query(User).filter(User.id == user.id, User.username == active_boss.name).first() and user.role not in {"master_admin", "admin"}:
            pass
    if user.role not in {"master_admin", "admin", "boss"}:
        raise HTTPException(403, "Only active boss or admin")
    return start_raid(db, active_boss)


@app.post("/api/raid/stop")
def raid_stop(user: User = Depends(require_roles("master_admin", "admin", "boss")), db: Session = Depends(get_db)):
    result = stop_raid(db, "boss")
    if not result:
        raise HTTPException(400, "No raid active")
    return result


@app.get("/api/raid/state")
def raid_state():
    return get_raid_state() or {"active": False}


@app.post("/api/raid/attack", response_model=AttackOut)
def raid_attack(user: User = Depends(require_roles("player", "master_admin", "admin")), db: Session = Depends(get_db)):
    damage, hp = player_attack(db, user)
    if damage == -1:
        raise HTTPException(429, "Attack cooldown")
    if hp == -1:
        raise HTTPException(400, "Raid inactive")
    return AttackOut(damage=damage, boss_hp=hp)


def _room_to_dict(room: Room, user: User | None = None, db: Session | None = None) -> dict:
    can_manage = False
    if user:
        can_manage = user.role == "boss" if room.is_main else room.created_by == user.id

    return {
        "id": room.id,
        "name": room.name,
        "avatar_url": room.avatar_url or "",
        "created_by": room.created_by,
        "is_main": room.is_main,
        "allow_media": room.allow_media,
        "cooldown_enabled": room.cooldown_enabled,
        "cooldown_seconds": room.cooldown_seconds,
        "join_code": room.join_code,
        "can_manage": can_manage,
    }




def _generate_join_code(db: Session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(30):
        code = "".join(__import__("secrets").choice(alphabet) for _ in range(8))
        if not db.query(Room).filter(Room.join_code == code).first():
            return code
    return uuid4().hex[:8].upper()

def _generate_nickname_color() -> str:
    import colorsys
    import secrets

    h = secrets.randbelow(360) / 360.0
    s = 0.32 + (secrets.randbelow(24) / 100.0)
    v = 0.90 + (secrets.randbelow(8) / 100.0)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"

def _pastel_from_seed(room_id: int, user_id: int) -> str:
    import colorsys

    seed = ((room_id * 92821) ^ (user_id * 68917)) % 360
    h = seed / 360.0
    s = 0.36
    v = 0.93
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def _ensure_room_member(db: Session, room_id: int, user_id: int):
    member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
    if not member:
        db.add(RoomMember(room_id=room_id, user_id=user_id, nickname_color=_pastel_from_seed(room_id, user_id)))
        return
    if not member.nickname_color or member.nickname_color == "#9fc5ff":
        member.nickname_color = _pastel_from_seed(room_id, user_id)


def _can_manage_room(user: User, room: Room) -> bool:
    if room.is_main:
        return user.role == "boss"
    return room.created_by == user.id


@app.post("/api/rooms")
def create_room(payload: RoomIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Room name is required")
    if db.query(Room).filter(func.lower(Room.name) == name.lower()).first():
        raise HTTPException(400, "Room already exists")

    room = Room(name=name, avatar_url=payload.avatar_url or "", created_by=user.id, is_main=False, join_code=_generate_join_code(db))
    db.add(room)
    db.flush()
    db.add(RoomMember(room_id=room.id, user_id=user.id, nickname_color=_pastel_from_seed(room.id, user.id)))
    db.commit()
    db.refresh(room)
    return _room_to_dict(room, user)


@app.get("/api/rooms")
def list_rooms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room_ids = [room_id for room_id, in db.query(RoomMember.room_id).filter(RoomMember.user_id == user.id).all()]
    if user.role == "boss":
        room_ids.extend([room_id for room_id, in db.query(Room.id).filter(Room.is_main.is_(True)).all()])
    if not room_ids:
        return []

    rooms = db.query(Room).filter(Room.id.in_(set(room_ids))).all()
    rooms = sorted(rooms, key=lambda room: (0 if room.is_main else 1, room.name.lower()))
    return [_room_to_dict(room, user) for room in rooms]


@app.patch("/api/rooms/{room_id}")
def update_room(room_id: int, payload: RoomUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if not _can_manage_room(user, room):
        raise HTTPException(403, "Insufficient permissions")

    changes = payload.model_dump(exclude_none=True)
    if "name" in changes:
        name = changes["name"].strip()
        if not name:
            raise HTTPException(400, "Room name is required")
        exists = db.query(Room).filter(func.lower(Room.name) == name.lower(), Room.id != room_id).first()
        if exists:
            raise HTTPException(400, "Room already exists")
        room.name = name
    if "avatar_url" in changes:
        room.avatar_url = changes["avatar_url"] or ""
    if "allow_media" in changes:
        room.allow_media = changes["allow_media"]
    if "cooldown_enabled" in changes:
        room.cooldown_enabled = changes["cooldown_enabled"]
    if "cooldown_seconds" in changes:
        cooldown_seconds = max(0, int(changes["cooldown_seconds"] or 0))
        room.cooldown_seconds = cooldown_seconds

    db.commit()
    db.refresh(room)
    return _room_to_dict(room, user)


@app.delete("/api/rooms/{room_id}")
def delete_room(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if room.is_main:
        raise HTTPException(400, "Main room cannot be deleted")
    if room.created_by != user.id:
        raise HTTPException(403, "Only room owner can delete room")

    db.query(RoomInvite).filter(RoomInvite.room_id == room_id).delete(synchronize_session=False)
    db.query(RoomMember).filter(RoomMember.room_id == room_id).delete(synchronize_session=False)
    db.query(RoomUserState).filter(RoomUserState.room_id == room_id).delete(synchronize_session=False)
    db.query(Message).filter(Message.room_id == room_id).delete(synchronize_session=False)
    db.delete(room)
    db.commit()
    return {"ok": True}


@app.get("/api/rooms/{room_id}/join-code")
def get_join_code(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if not _can_manage_room(user, room):
        raise HTTPException(403, "Insufficient permissions")
    if not room.join_code:
        room.join_code = _generate_join_code(db)
        db.commit()
    return {"join_code": room.join_code}


@app.get("/api/rooms/join/{join_code}")
def join_room(join_code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.join_code == join_code.upper()).first()
    if not room:
        raise HTTPException(404, "Room not found")

    _ensure_room_member(db, room.id, user.id)
    db.commit()
    return _room_to_dict(room, user)


@app.get("/api/rooms/{room_id}/members")
def room_members(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    is_member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user.id).first()
    if not is_member and not (room.is_main and user.role == "boss"):
        raise HTTPException(403, "You are not a member of this room")

    rows = (
        db.query(User.id, User.username, User.role, RoomMember.nickname_color)
        .join(RoomMember, RoomMember.user_id == User.id)
        .filter(RoomMember.room_id == room_id)
        .order_by(User.username.asc())
        .all()
    )
    return [
        {
            "id": user_id,
            "username": username,
            "role": role,
            "nickname_color": color or _pastel_from_seed(room_id, user_id),
        }
        for user_id, username, role, color in rows
    ]


@app.post("/api/chat/messages")
def send_message(payload: MessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == payload.room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")

    is_member = db.query(RoomMember).filter(RoomMember.room_id == payload.room_id, RoomMember.user_id == user.id).first()
    if not is_member and room.is_main and user.role == "boss":
        _ensure_room_member(db, room.id, user.id)
        is_member = True
    if not is_member and not (room.is_main and user.role == "boss"):
        raise HTTPException(403, "You are not a member of this room")

    content = (payload.content or "").strip()
    media_url = (payload.media_url or "").strip()
    media_type = (payload.media_type or "").strip()
    if not content and not media_url:
        raise HTTPException(400, "Message is empty")

    if media_url and not room.allow_media:
        raise HTTPException(400, "Media disabled in this room")
    if media_url and media_type and media_type != "image":
        raise HTTPException(400, "Only images are allowed in chat messages")

    if user.role != "boss" and room.cooldown_enabled and room.cooldown_seconds > 0:
        state = db.query(RoomUserState).filter(RoomUserState.room_id == payload.room_id, RoomUserState.user_id == user.id).first()
        if state and state.last_message_at:
            available_at = state.last_message_at + timedelta(seconds=room.cooldown_seconds)
            now = datetime.utcnow()
            if now < available_at:
                retry_after = max(1, int((available_at - now).total_seconds()))
                raise HTTPException(429, {"code": "SLOWMODE", "retry_after_seconds": retry_after, "retry_at": available_at.isoformat() + "Z"})
        if not state:
            state = RoomUserState(room_id=payload.room_id, user_id=user.id)
            db.add(state)
        state.last_message_at = datetime.utcnow()

    msg = Message(room_id=payload.room_id, user_id=user.id, content=content or "", media_url=media_url, media_type=media_type)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    member = db.query(RoomMember).filter(RoomMember.room_id == msg.room_id, RoomMember.user_id == msg.user_id).first()
    return {
        "id": msg.id,
        "room_id": msg.room_id,
        "user_id": msg.user_id,
        "username": user.username,
        "role": user.role,
        "nickname_color": (member.nickname_color if member and member.nickname_color else _pastel_from_seed(msg.room_id, msg.user_id)),
        "content": msg.content,
        "media_url": msg.media_url,
        "media_type": msg.media_type,
        "created_at": msg.created_at,
    }


@app.get("/api/chat/messages/{room_id}")
def room_messages(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    is_member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user.id).first()
    if not is_member and not (room.is_main and user.role == "boss"):
        raise HTTPException(403, "You are not a member of this room")
    rows = (
        db.query(Message, User.username, User.role, RoomMember.nickname_color)
        .join(User, User.id == Message.user_id)
        .outerjoin(RoomMember, (RoomMember.room_id == Message.room_id) & (RoomMember.user_id == Message.user_id))
        .filter(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(50)
        .all()[::-1]
    )
    return [
        {
            "id": msg.id,
            "room_id": msg.room_id,
            "user_id": msg.user_id,
            "username": username,
            "role": role,
            "nickname_color": nickname_color or _pastel_from_seed(msg.room_id, msg.user_id),
            "content": msg.content,
            "media_url": msg.media_url,
            "media_type": msg.media_type,
            "created_at": msg.created_at,
        }
        for msg, username, role, nickname_color in rows
    ]


@app.delete("/api/chat/messages/{message_id}")
def delete_message(message_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(404, "Message not found")
    room = db.query(Room).filter(Room.id == msg.room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")

    allowed = (room.is_main and user.role == "boss") or (not room.is_main and room.created_by == user.id)
    if not allowed:
        raise HTTPException(403, "Insufficient permissions")

    db.delete(msg)
    db.commit()
    return {"ok": True}


@app.post("/api/uploads/media")
def upload_media(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    if not (file.content_type or "").startswith(("image/", "video/")):
        raise HTTPException(400, "Only image/video allowed")

    ext = os.path.splitext(file.filename or "")[1] or ".bin"
    filename = f"{uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as out:
        out.write(file.file.read())

    file_type = "image" if (file.content_type or "").startswith("image/") else "video"
    return {"url": f"/uploads/{filename}", "type": file_type}


@app.get("/api/channels")
def list_channels(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    channels = db.query(Channel).order_by(Channel.created_at.asc()).all()

    unread = dict(
        db.query(Post.channel_id, func.count(Post.id))
        .outerjoin(PostView, (PostView.post_id == Post.id) & (PostView.user_id == user.id))
        .filter(PostView.id.is_(None))
        .group_by(Post.channel_id)
        .all()
    )

    totals = dict(db.query(Post.channel_id, func.count(Post.id)).group_by(Post.channel_id).all())

    return [
        {
            "id": channel.id,
            "name": channel.name,
            "avatar_url": channel.avatar_url,
            "post_count": totals.get(channel.id, 0),
            "unread_count": unread.get(channel.id, 0),
        }
        for channel in channels
    ]


@app.post("/api/channels")
def create_channel(payload: ChannelIn, user: User = Depends(require_roles("boss")), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Channel name is required")

    exists = db.query(Channel).filter(func.lower(Channel.name) == name.lower()).first()
    if exists:
        raise HTTPException(400, "Channel already exists")

    channel = Channel(name=name, avatar_url=payload.avatar_url or "", created_by=user.id)
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return channel




@app.delete("/api/channels/{channel_id}")
def delete_channel(channel_id: int, _: User = Depends(require_roles("boss")), db: Session = Depends(get_db)):
    channel = db.query(Channel).filter(Channel.id == channel_id).first()
    if not channel:
        raise HTTPException(404, "Channel not found")

    post_ids = [post_id for post_id, in db.query(Post.id).filter(Post.channel_id == channel_id).all()]
    if post_ids:
        db.query(PostLike).filter(PostLike.post_id.in_(post_ids)).delete(synchronize_session=False)
        db.query(PostReaction).filter(PostReaction.post_id.in_(post_ids)).delete(synchronize_session=False)
        db.query(PostComment).filter(PostComment.post_id.in_(post_ids)).delete(synchronize_session=False)
        db.query(PostView).filter(PostView.post_id.in_(post_ids)).delete(synchronize_session=False)
        db.query(Post).filter(Post.id.in_(post_ids)).delete(synchronize_session=False)

    db.delete(channel)
    db.commit()
    return {"ok": True}
@app.post("/api/news")
def create_post(payload: PostIn, user: User = Depends(require_roles("boss")), db: Session = Depends(get_db)):
    if payload.channel_id is not None and not db.query(Channel).filter(Channel.id == payload.channel_id).first():
        raise HTTPException(404, "Channel not found")

    post = Post(**payload.model_dump(), created_by=user.id)
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@app.delete("/api/news/{post_id}")
def delete_post(post_id: int, _: User = Depends(require_roles("boss")), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")

    db.query(PostLike).filter(PostLike.post_id == post_id).delete()
    db.query(PostReaction).filter(PostReaction.post_id == post_id).delete()
    db.query(PostComment).filter(PostComment.post_id == post_id).delete()
    db.query(PostView).filter(PostView.post_id == post_id).delete()
    db.delete(post)
    db.commit()
    return {"ok": True}


@app.get("/api/news/last-read")
def last_read_news(user: User = Depends(get_current_user)):
    return {"last_read_post_id": user.last_read_post_id}


@app.post("/api/news/{post_id}/read")
def mark_read(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")

    exists = db.query(PostView).filter(PostView.post_id == post_id, PostView.user_id == user.id).first()
    if not exists:
        db.add(PostView(post_id=post_id, user_id=user.id))

    user.last_read_post_id = post_id
    db.commit()
    return {"ok": True}


@app.post("/api/news/{post_id}/reactions")
def react_post(post_id: int, payload: PostReactionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")

    reaction = db.query(PostReaction).filter(PostReaction.post_id == post_id, PostReaction.user_id == user.id).first()
    if reaction:
        reaction.emoji = payload.emoji
    else:
        db.add(PostReaction(post_id=post_id, user_id=user.id, emoji=payload.emoji))
    db.commit()
    return {"ok": True}


@app.post("/api/news/{post_id}/comments")
def add_comment(post_id: int, payload: PostCommentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")
    comment = PostComment(post_id=post_id, user_id=user.id, content=payload.content)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@app.get("/api/news/{post_id}/comments")
def list_comments(post_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PostComment, User.username)
        .join(User, User.id == PostComment.user_id)
        .filter(PostComment.post_id == post_id)
        .order_by(PostComment.created_at.asc())
        .all()
    )
    return [{"id": c.id, "content": c.content, "user_id": c.user_id, "username": username, "created_at": c.created_at} for c, username in rows]


@app.get("/api/news")
def list_posts(channel_id: int | None = Query(default=None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    likes = db.query(PostLike.post_id, func.count(PostLike.id).label("likes")).group_by(PostLike.post_id).subquery()
    comments = db.query(PostComment.post_id, func.count(PostComment.id).label("comments")).group_by(PostComment.post_id).subquery()
    views = db.query(PostView.post_id, func.count(distinct(PostView.user_id)).label("views")).group_by(PostView.post_id).subquery()
    base_query = (
        db.query(Post, likes.c.likes, comments.c.comments, views.c.views, User.username)
        .join(User, User.id == Post.created_by)
        .outerjoin(likes, likes.c.post_id == Post.id)
        .outerjoin(comments, comments.c.post_id == Post.id)
        .outerjoin(views, views.c.post_id == Post.id)
        .filter(User.role == "boss")
    )
    if channel_id is not None:
        base_query = base_query.filter(Post.channel_id == channel_id)

    rows = base_query.order_by(Post.created_at.desc()).all()

    reactions_rows = db.query(PostReaction.post_id, PostReaction.emoji, func.count(PostReaction.id)).group_by(PostReaction.post_id, PostReaction.emoji).all()
    reactions_map = {}
    for post_id, emoji, count in reactions_rows:
        reactions_map.setdefault(post_id, {})[emoji] = count

    my_reactions_rows = db.query(PostReaction.post_id, PostReaction.emoji).filter(PostReaction.user_id == user.id).all()
    my_reactions = {post_id: emoji for post_id, emoji in my_reactions_rows}

    return [
        {
            "id": p.id,
            "title": p.title,
            "content": p.content,
            "image_url": p.image_url,
            "video_url": p.video_url,
            "audio_url": p.audio_url,
            "channel_id": p.channel_id,
            "author": username,
            "created_at": p.created_at,
            "likes": l or 0,
            "comment_count": c or 0,
            "views": v or 0,
            "reactions": reactions_map.get(p.id, {}),
            "my_reaction": my_reactions.get(p.id),
            "is_last_read": user.last_read_post_id == p.id,
        }
        for p, l, c, v, username in rows
    ]


@app.post("/api/news/{post_id}/like")
def like_post(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    exists = db.query(PostLike).filter(PostLike.post_id == post_id, PostLike.user_id == user.id).first()
    if not exists:
        db.add(PostLike(post_id=post_id, user_id=user.id))
        db.commit()
    return {"ok": True}


@app.get("/api/master-admin/users")
def admin_users(user: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    return db.query(User).all()


@app.patch("/api/master-admin/users/{user_id}/role")
def admin_role(user_id: int, payload: RoleUpdateIn, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.role = payload.role
    db.commit()
    return user


@app.patch("/api/master-admin/users/{user_id}/ban")
def admin_ban(user_id: int, payload: BanIn, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_banned = payload.is_banned
    db.commit()
    return user


@app.patch("/api/master-admin/users/{user_id}/stats")
def admin_stats(user_id: int, payload: StatUpdateIn, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    return user


@app.patch("/api/master-admin/users/{user_id}/password")
def admin_change_password(user_id: int, payload: PasswordUpdateIn, admin: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if len(payload.password) < 6:
        raise HTTPException(400, "Password too short")
    user.password_hash = hash_password(payload.password)
    db.commit()
    return {"ok": True}


@app.delete("/api/master-admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    if admin.id == user_id:
        raise HTTPException(400, "You cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    db.query(Message).filter(Message.user_id == user_id).delete(synchronize_session=False)
    db.query(RoomInvite).filter((RoomInvite.invited_user_id == user_id) | (RoomInvite.invited_by == user_id)).delete(synchronize_session=False)
    db.query(RoomMember).filter(RoomMember.user_id == user_id).delete(synchronize_session=False)
    db.query(RoomUserState).filter(RoomUserState.user_id == user_id).delete(synchronize_session=False)
    db.query(PostLike).filter(PostLike.user_id == user_id).delete(synchronize_session=False)
    db.query(PostReaction).filter(PostReaction.user_id == user_id).delete(synchronize_session=False)
    db.query(PostComment).filter(PostComment.user_id == user_id).delete(synchronize_session=False)
    db.query(PostView).filter(PostView.user_id == user_id).delete(synchronize_session=False)
    db.query(Inventory).filter(Inventory.player_id == user_id).delete(synchronize_session=False)

    room_ids = [room.id for room in db.query(Room.id).filter(Room.created_by == user_id, Room.is_main.is_(False)).all()]
    if room_ids:
        db.query(Message).filter(Message.room_id.in_(room_ids)).delete(synchronize_session=False)
        db.query(RoomInvite).filter(RoomInvite.room_id.in_(room_ids)).delete(synchronize_session=False)
        db.query(RoomMember).filter(RoomMember.room_id.in_(room_ids)).delete(synchronize_session=False)
        db.query(RoomUserState).filter(RoomUserState.room_id.in_(room_ids)).delete(synchronize_session=False)
        db.query(Room).filter(Room.id.in_(room_ids)).delete(synchronize_session=False)

    user_post_ids = [post.id for post in db.query(Post.id).filter(Post.created_by == user_id).all()]
    if user_post_ids:
        db.query(PostLike).filter(PostLike.post_id.in_(user_post_ids)).delete(synchronize_session=False)
        db.query(PostReaction).filter(PostReaction.post_id.in_(user_post_ids)).delete(synchronize_session=False)
        db.query(PostComment).filter(PostComment.post_id.in_(user_post_ids)).delete(synchronize_session=False)
        db.query(PostView).filter(PostView.post_id.in_(user_post_ids)).delete(synchronize_session=False)
    db.query(Post).filter(Post.created_by == user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"ok": True}


@app.post("/api/master-admin/bosses")
def create_boss(payload: BossIn, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    boss = Boss(name=payload.name, hp=payload.hp, max_hp=payload.hp, attack=payload.attack, defense=payload.defense, abilities=payload.abilities)
    db.add(boss)
    db.commit()
    db.refresh(boss)
    return boss


@app.post("/api/master-admin/bosses/{boss_id}/activate")
def activate_boss(boss_id: int, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    db.query(Boss).update({Boss.is_active: False})
    boss = db.query(Boss).filter(Boss.id == boss_id).first()
    if not boss:
        raise HTTPException(404, "Boss not found")
    boss.is_active = True
    db.commit()
    return boss


@app.patch("/api/master-admin/items/{item_id}")
def update_loot(item_id: int, payload: LootUpdateIn, _: User = Depends(require_roles("master_admin", "admin")), db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    item.drop_chance = payload.drop_chance
    db.commit()
    return item


@app.get("/api/items")
def list_items(db: Session = Depends(get_db)):
    return db.query(Item).all()


@app.get("/api/inventory")
def inventory(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Inventory, Item)
        .join(Item, Item.id == Inventory.item_id)
        .filter(Inventory.player_id == user.id)
        .all()
    )
    return [
        {
            "id": item.id,
            "name": item.name,
            "rarity": item.rarity,
            "attack_bonus": item.attack_bonus,
            "defense_bonus": item.defense_bonus,
            "equipped": inv.equipped,
        }
        for inv, item in rows
    ]


@app.websocket("/ws/{room}")
async def websocket_room(ws: WebSocket, room: str):
    await ws_manager.connect(room, ws)
    try:
        while True:
            data = await ws.receive_json()
            await ws_manager.broadcast(room, data)
    except Exception:
        ws_manager.disconnect(room, ws)


@app.post("/api/system/boss-auto-attack")
def manual_auto_attack(_: User = Depends(require_roles("master_admin", "admin", "boss")), db: Session = Depends(get_db)):
    boss_auto_attack(db)
    return {"ok": True}
