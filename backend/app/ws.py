from collections import defaultdict

from fastapi import WebSocket


class WSManager:
    def __init__(self):
        self.room_connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        self.room_connections[room].add(ws)

    def disconnect(self, room: str, ws: WebSocket):
        self.room_connections[room].discard(ws)

    async def broadcast(self, room: str, payload: dict):
        dead = []
        for ws in self.room_connections[room]:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)


ws_manager = WSManager()
