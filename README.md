# KBGame - Browser Multiplayer Raid Game

FastAPI + PostgreSQL + Redis + React (Vite) raid game with websocket raid/chat updates.

## Features
- Role system: `player`, `boss`, `master_admin`
- Single active boss and single active raid
- Server-authoritative combat (3s player cooldown)
- Redis raid state + leaderboard + cooldown tracking
- Boss auto attack endpoint (5s scheduler hook ready)
- Websocket chat rooms with persistent messages
- Telegram-like news feed with likes
- Inventory + loot drops after raid
- Master admin panel endpoint set for full control

## Project Structure
- `backend/` FastAPI app
- `frontend/` React app (Vite)
- `docker-compose.yml` all services

## Quick Start
1. Build and run:
   ```bash
   docker compose up --build
   ```
2. Open:
   - Frontend: http://localhost:5173
   - Backend docs: http://localhost:8000/docs
3. Default admin:
   - Username: `admin`
   - Password: `admin123`

## Important API Routes
- Auth: `/api/auth/register`, `/api/auth/login`
- Raid: `/api/raid/start`, `/api/raid/attack`, `/api/raid/state`, `/api/raid/stop`
- Chat REST: `/api/rooms`, `/api/chat/messages/{room_id}`
- Chat websocket: `/ws/{room}`
- News: `/api/news`, `/api/news/{post_id}/like`
- Master admin endpoints: `/api/master-admin/*`

## Environment Variables
Backend supports:
- `DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `TOKEN_EXPIRE_MINUTES`

Frontend supports:
- `VITE_API_URL`
- `VITE_WS_URL`

## Notes
- To run boss auto-attack every 5 seconds, attach a scheduler or worker that calls `/api/system/boss-auto-attack`.
- Role-based checks are enforced on backend dependencies.
- Banned users are rejected by auth middleware.
