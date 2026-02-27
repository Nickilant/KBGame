import json
import random
import time
from collections import defaultdict

import redis
from sqlalchemy.orm import Session

from .config import settings
from .models import Boss, Inventory, Item, RaidResult, User

redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)

RAID_KEY = "raid:state"
COOLDOWN_PREFIX = "raid:cooldown:"


def start_raid(db: Session, boss: Boss) -> dict:
    state = {
        "active": True,
        "phase": "signup",
        "turn": 0,
        "boss_id": boss.id,
        "boss_name": boss.name,
        "boss_hp": boss.hp,
        "boss_max_hp": boss.max_hp,
        "boss_attack": boss.attack,
        "boss_defense": boss.defense,
        "leaderboard": {},
        "participants": {},
        "started_at": int(time.time()),
        "signup_ends_at": int(time.time()) + 120,
        "last_log": "Рейд начался. Выберите позицию и запишитесь!",
    }
    redis_client.set(RAID_KEY, json.dumps(state))
    return state


def get_raid_state() -> dict | None:
    raw = redis_client.get(RAID_KEY)
    return json.loads(raw) if raw else None


def stop_raid(db: Session, winner: str) -> dict | None:
    state = get_raid_state()
    if not state:
        return None

    leaderboard = state.get("leaderboard", {})
    item_pool = db.query(Item).all()

    for user_id, damage in leaderboard.items():
        user = db.query(User).filter(User.id == int(user_id)).first()
        if not user:
            continue
        user.gold += max(10, int(damage) // 2)
        for item in item_pool:
            if random.random() <= item.drop_chance:
                db.add(Inventory(player_id=user.id, item_id=item.id, equipped=False))
                break

    db.add(RaidResult(boss_id=state["boss_id"], winner=winner, payload=state))
    db.commit()
    redis_client.delete(RAID_KEY)
    return state


def player_attack(db: Session, user: User) -> tuple[int, int]:
    state = get_raid_state()
    if not state or not state.get("active"):
        return 0, -1

    cooldown_key = f"{COOLDOWN_PREFIX}{user.id}"
    if redis_client.exists(cooldown_key):
        return -1, state["boss_hp"]

    damage = max(1, user.attack - state["boss_defense"] // 3 + random.randint(0, 5))
    state["boss_hp"] = max(0, state["boss_hp"] - damage)
    board = defaultdict(int, state.get("leaderboard", {}))
    board[str(user.id)] += damage
    state["leaderboard"] = dict(board)
    redis_client.set(RAID_KEY, json.dumps(state))
    redis_client.setex(cooldown_key, 3, "1")

    if state["boss_hp"] == 0:
        stop_raid(db, "players")
    return damage, state["boss_hp"]


def boss_auto_attack(db: Session):
    state = get_raid_state()
    if not state or not state.get("active"):
        return None
    users = db.query(User).filter(User.role == "player", User.is_banned.is_(False)).all()
    for user in users:
        dmg = max(1, state["boss_attack"] - user.defense // 4)
        user.hp = max(1, user.hp - dmg)
    db.commit()
    return True


POSITIONS = {"defense", "attack", "support"}


def join_raid(db: Session, user: User, position: str) -> dict:
    state = get_raid_state()
    if not state or not state.get("active"):
        raise ValueError("Raid inactive")
    if state.get("phase") != "signup":
        raise ValueError("Signup closed")
    pos = (position or "").strip().lower()
    if pos not in POSITIONS:
        raise ValueError("Invalid position")

    participants = state.setdefault("participants", {})
    participants[str(user.id)] = {
        "user_id": user.id,
        "username": user.username,
        "position": pos,
        "hp": max(1, int(user.hp or 100)),
        "max_hp": max(1, int(user.hp or 100)),
        "alive": True,
        "action": None,
    }
    state["last_log"] = f"{user.username} занял позицию {pos}"
    redis_client.set(RAID_KEY, json.dumps(state))
    return state


def _alive_participants(state: dict) -> list[dict]:
    return [p for p in state.get("participants", {}).values() if p.get("alive") and p.get("hp", 0) > 0]


def submit_action(user: User, action: str) -> dict:
    state = get_raid_state()
    if not state or not state.get("active"):
        raise ValueError("Raid inactive")

    if state.get("phase") == "signup":
        if int(time.time()) >= int(state.get("signup_ends_at", 0)):
            state["phase"] = "players"
        else:
            raise ValueError("Raid still in signup")

    participants = state.get("participants", {})
    p = participants.get(str(user.id))
    if not p or not p.get("alive"):
        raise ValueError("Not in raid")
    if state.get("phase") != "players":
        raise ValueError("Not players turn")
    if action not in {"attack", "defend"}:
        raise ValueError("Invalid action")
    p["action"] = action
    state["last_log"] = f"{user.username} выбрал действие: {action}"
    redis_client.set(RAID_KEY, json.dumps(state))
    return state


def progress_raid_turn(db: Session) -> dict:
    state = get_raid_state()
    if not state or not state.get("active"):
        raise ValueError("Raid inactive")

    if state.get("phase") == "signup":
        if int(time.time()) < int(state.get("signup_ends_at", 0)):
            return state
        state["phase"] = "players"

    participants = state.get("participants", {})
    alive = _alive_participants(state)
    if not alive:
        stop_raid(db, "boss")
        state = get_raid_state() or {"active": False}
        return state

    if state.get("phase") == "players":
        if any(p.get("action") is None for p in alive):
            redis_client.set(RAID_KEY, json.dumps(state))
            return state
        total_damage = 0
        for p in alive:
            if p.get("action") == "attack":
                base = db.query(User.attack).filter(User.id == p["user_id"]).scalar() or 10
                total_damage += max(1, int(base) - int(state.get("boss_defense", 0)) // 4)
        state["boss_hp"] = max(0, int(state.get("boss_hp", 0)) - total_damage)
        board = defaultdict(int, state.get("leaderboard", {}))
        for p in alive:
            if p.get("action") == "attack":
                board[str(p["user_id"])] += max(1, total_damage // max(1, len([x for x in alive if x.get("action") == "attack"])))
        state["leaderboard"] = dict(board)
        state["last_log"] = f"Игроки нанесли {total_damage} урона боссу"
        if state["boss_hp"] <= 0:
            stop_raid(db, "players")
            return get_raid_state() or {"active": False}
        state["phase"] = "boss"

    if state.get("phase") == "boss":
        alive = _alive_participants(state)
        groups = {
            "defense": [p for p in alive if p.get("position") == "defense"],
            "attack": [p for p in alive if p.get("position") == "attack"],
            "support": [p for p in alive if p.get("position") == "support"],
        }
        total = max(1, int(state.get("boss_attack", 1)))
        buckets = {"defense": int(total * 0.6), "attack": int(total * 0.3), "support": max(0, total - int(total * 0.6) - int(total * 0.3))}
        for key, members in groups.items():
            if not members:
                continue
            per_member = max(1, buckets[key] // len(members))
            for p in members:
                reduced = per_member // 2 if p.get("action") == "defend" else per_member
                p["hp"] = max(0, int(p.get("hp", 0)) - reduced)
                p["alive"] = p["hp"] > 0
                p["action"] = None
        state["turn"] = int(state.get("turn", 0)) + 1
        state["phase"] = "players"
        state["last_log"] = "Босс атаковал: 60% по обороне, 30% по атаке, 10% по поддержке"

        if not _alive_participants(state):
            stop_raid(db, "boss")
            return get_raid_state() or {"active": False}

    redis_client.set(RAID_KEY, json.dumps(state))
    return state
