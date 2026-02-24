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
        "boss_id": boss.id,
        "boss_name": boss.name,
        "boss_hp": boss.hp,
        "boss_attack": boss.attack,
        "boss_defense": boss.defense,
        "leaderboard": {},
        "started_at": int(time.time()),
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
