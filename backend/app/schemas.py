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
    content: str = ""
    media_url: str = ""
    media_type: str = ""


class PostIn(BaseModel):
    title: str
    content: str
    image_url: str = ""
    video_url: str = ""
    audio_url: str = ""
    channel_id: int | None = None


class PostCommentIn(BaseModel):
    content: str


class PostReactionIn(BaseModel):
    emoji: str


class RoomIn(BaseModel):
    name: str
    avatar_url: str = ""


class RoomUpdateIn(BaseModel):
    name: str | None = None
    avatar_url: str | None = None
    allow_media: bool | None = None
    cooldown_enabled: bool | None = None
    cooldown_seconds: int | None = None


class RoomInviteDecisionIn(BaseModel):
    action: str


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


class PasswordUpdateIn(BaseModel):
    password: str


class ChannelIn(BaseModel):
    name: str
    avatar_url: str = ""
