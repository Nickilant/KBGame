from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RegisterIn(BaseModel):
    username: str
    password: str


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_banned: bool
    hp: int
    attack: int
    defense: int
    level: int
    gold: int

    class Config:
        from_attributes = True


class BossIn(BaseModel):
    name: str
    hp: int
    attack: int
    defense: int
    abilities: list[Any] = []


class AttackOut(BaseModel):
    damage: int
    boss_hp: int


class MessageIn(BaseModel):
    room_id: int
    content: str


class PostIn(BaseModel):
    title: str
    content: str
    image_url: str = ""
    video_url: str = ""


class RoomIn(BaseModel):
    name: str


class StatUpdateIn(BaseModel):
    hp: int | None = None
    attack: int | None = None
    defense: int | None = None
    level: int | None = None
    gold: int | None = None


class RoleUpdateIn(BaseModel):
    role: str


class BanIn(BaseModel):
    is_banned: bool


class LootUpdateIn(BaseModel):
    drop_chance: float
