"""
main.py — BrowserMind Text FastAPI server (genai SDK, text chatbot mode).

WebSocket endpoint streams agent events to the frontend:
  - text_chunk: streaming agent response text
  - tool_called / tool_done: browser tool activity
  - skill_loaded: domain/interaction skill was read
  - browser_screenshot: latest screenshot after action (for activity log)
  - thinking / task_done / error / max_steps_reached
"""

import asyncio
import logging
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

# Add browser-harness to sys.path
_harness_dir = os.environ.get(
    "BROWSER_HARNESS_DIR",
    str(Path(__file__).resolve().parents[2] / "browser-harness"),
)
if _harness_dir not in sys.path:
    sys.path.insert(0, _harness_dir)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from admin import ensure_daemon  # browser-harness daemon

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("browsermind_text.main")

app = FastAPI(title="BrowserMind Text", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Session store ──────────────────────────────────────────────────────────────
# One BrowserAgentSession per WebSocket connection (= per user).
# Imported lazily to allow env vars to load first.

_sessions: dict[str, "BrowserAgentSession"] = {}


def _get_session(session_id: str):
    from agent import BrowserAgentSession
    if session_id not in _sessions:
        logger.info(f"Creating new session: {session_id}")
        _sessions[session_id] = BrowserAgentSession(session_id)
    return _sessions[session_id]


def _clear_session(session_id: str):
    from agent import BrowserAgentSession
    _sessions.pop(session_id, None)
    logger.info(f"Cleared session: {session_id}")
    return BrowserAgentSession(session_id)


# ── WebSocket handler ──────────────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")

    session = _get_session(session_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "user_message":
                user_text = data.get("text", "").strip()
                if not user_text:
                    continue
                logger.info(f"[{session_id}] User: {user_text[:80]}")

                try:
                    result = await session.run_turn(user_text, websocket)
                    logger.info(f"[{session_id}] Turn complete: {str(result)[:80]}")
                    # Always send turn_complete so the frontend unlocks input.
                    # task_done is sent by run_turn when TASK_COMPLETE: appears;
                    # this covers pure-text replies and any other exit path.
                    await websocket.send_json({"type": "turn_complete", "result": str(result)[:200]})
                except Exception as e:
                    logger.error(f"[{session_id}] run_turn error: {e}", exc_info=True)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Agent error: {str(e)}",
                    })

            elif msg_type == "new_session":
                # Reset chat history — creates a fresh Chat object
                new_session = _clear_session(session_id)
                _sessions[session_id] = new_session
                await websocket.send_json({"type": "session_cleared"})
                logger.info(f"[{session_id}] Session reset by user")

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
        # Session persists in _sessions for reconnection


# ── Health check ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    from agent import MODEL, _USE_VERTEX
    return {
        "status": "ok",
        "model": MODEL,
        "vertex_ai": _USE_VERTEX,
        "sessions": len(_sessions),
    }


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("BrowserMind Text starting up...")
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, ensure_daemon)
        logger.info("browser-harness daemon ready")
    except Exception as e:
        logger.warning(f"browser-harness daemon start failed (will retry on first request): {e}")


# ── Static files (frontend) ────────────────────────────────────────────────────

_frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
_frontend_src  = Path(__file__).resolve().parents[1] / "frontend"

if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
elif _frontend_src.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_src), html=True), name="frontend")
