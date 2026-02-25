from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(32), default="player", nullable=False)
    is_banned = Column(Boolean, default=False)
    hp = Column(Integer, default=100)
    attack = Column(Integer, default=10)
    defense = Column(Integer, default=5)
    level = Column(Integer, default=1)
    gold = Column(Integer, default=0)
    last_read_post_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Boss(Base):
    __tablename__ = "bosses"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False)
    hp = Column(Integer, nullable=False)
    max_hp = Column(Integer, nullable=False)
    attack = Column(Integer, nullable=False)
    defense = Column(Integer, nullable=False)
    abilities = Column(JSON, default=list)
    is_active = Column(Boolean, default=False)


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    rarity = Column(String(32), nullable=False)
    attack_bonus = Column(Integer, default=0)
    defense_bonus = Column(Integer, default=0)
    image_url = Column(String(255), default="")
    drop_chance = Column(Float, default=0.1)


class Inventory(Base):
    __tablename__ = "inventories"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("users.id"), index=True)
    item_id = Column(Integer, ForeignKey("items.id"), index=True)
    equipped = Column(Boolean, default=False)


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True)
    avatar_url = Column(String(255), default="")
    created_by = Column(Integer, ForeignKey("users.id"))
    is_main = Column(Boolean, default=False)
    allow_media = Column(Boolean, default=True)
    cooldown_enabled = Column(Boolean, default=False)
    cooldown_seconds = Column(Integer, default=0)
    join_code = Column(String(24), unique=True, nullable=True, index=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    content = Column(Text, nullable=False)
    media_url = Column(String(255), default="")
    media_type = Column(String(32), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_member"),)

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)
    nickname_color = Column(String(16), default="#9fc5ff", nullable=False)


class RoomInvite(Base):
    __tablename__ = "room_invites"
    __table_args__ = (UniqueConstraint("room_id", "invited_user_id", name="uq_room_invite"),)

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), index=True, nullable=False)
    invited_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(16), default="pending", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class RoomUserRule(Base):
    __tablename__ = "room_user_rules"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_user_rule"),)

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    cooldown_seconds = Column(Integer, default=0, nullable=False)
    can_attach_media = Column(Boolean, default=True, nullable=False)


class RoomUserState(Base):
    __tablename__ = "room_user_states"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_user_state"),)

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    last_message_at = Column(DateTime, nullable=True)


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True)
    title = Column(String(128), nullable=False)
    content = Column(Text, nullable=False)
    image_url = Column(String(255), default="")
    video_url = Column(String(255), default="")
    audio_url = Column(String(255), default="")
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    avatar_url = Column(String(255), default="")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class PostLike(Base):
    __tablename__ = "post_likes"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)


class PostReaction(Base):
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_reaction_user"),)

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    emoji = Column(String(16), nullable=False)


class PostComment(Base):
    __tablename__ = "post_comments"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class PostView(Base):
    __tablename__ = "post_views"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_view_user"),)

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class RaidResult(Base):
    __tablename__ = "raid_results"

    id = Column(Integer, primary_key=True)
    boss_id = Column(Integer, ForeignKey("bosses.id"))
    winner = Column(String(16), nullable=False)
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
