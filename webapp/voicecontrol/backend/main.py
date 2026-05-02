"""
BrowserMind — FastAPI backend with bidi WebSocket streaming.

Architecture follows fashionmind: LiveRequestQueue + runner.run_live()
for Gemini Live API bidi audio, with browser-harness tools for browser control.
"""

import asyncio
import base64
import json
import logging
import os
import struct
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google.adk.runners import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai import types

from agent import runner, session_service, root_agent
from browser_tools import (
    capture_screenshot,
    page_info,
    ensure_daemon,
    _screenshot_b64,
)

logger = logging.getLogger("browsermind")
logging.basicConfig(level=logging.INFO)


# ---------- Lifespan ----------

def _autodiscover_cdp_ws():
    """If Chrome is running with --remote-debugging-port, query it for the live
    webSocketDebuggerUrl and set BU_CDP_WS. Lets the harness skip its hardcoded
    profile-dir discovery, which doesn't know about custom --user-data-dir paths."""
    if os.environ.get("BU_CDP_WS"):
        return
    import urllib.request
    port = os.environ.get("BU_CDP_PORT", "9222")
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2) as r:
            ws_url = json.loads(r.read())["webSocketDebuggerUrl"]
        os.environ["BU_CDP_WS"] = ws_url
        logger.info(f"Discovered Chrome CDP at {ws_url}")
    except Exception as e:
        logger.warning(f"Chrome CDP not reachable on port {port} ({e}); ensure Chrome is running with --remote-debugging-port={port}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure browser-harness daemon is running at startup
    _autodiscover_cdp_ws()
    try:
        ensure_daemon()
        logger.info("Browser-harness daemon is running")
    except Exception as e:
        logger.warning(f"Browser-harness daemon not available: {e}")
        logger.warning("Start Chrome with --remote-debugging-port=9222 and retry")
    yield


app = FastAPI(title="BrowserMind API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "ok", "service": "browsermind"}


# ---------- Session endpoint ----------

@app.post("/api/sessions")
async def create_session():
    session_id = f"session-{int(time.time())}"
    session = await session_service.create_session(
        app_name="browsermind",
        user_id="user",
        session_id=session_id,
    )
    return {"session_id": session.id}


# ---------- Screenshot endpoint (for polling fallback) ----------

@app.get("/api/screenshot")
async def get_screenshot():
    try:
        b64 = _screenshot_b64()
        info = page_info()
        return {
            "data": b64,
            "url": info.get("url", ""),
            "title": info.get("title", ""),
        }
    except Exception as e:
        return {"error": str(e)}


# ---------- WebSocket bidi streaming ----------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")

    user_id = "user"

    # RunConfig for bidi audio streaming
    model_name = root_agent.model or "gemini-2.5-flash-native-audio-preview-12-2025"
    use_audio = "live" in model_name or "native-audio" in model_name

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"] if use_audio else ["TEXT"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    # Ensure session exists
    session = await session_service.get_session(
        app_name="browsermind", user_id=user_id, session_id=session_id
    )
    if not session:
        try:
            session = await session_service.create_session(
                app_name="browsermind",
                user_id=user_id,
                session_id=session_id,
            )
        except ValueError:
            logger.error(f"Session {session_id} not found and cannot be created")
            await websocket.close(code=1011, reason="Session not found")
            return

    from google.adk.agents import LiveRequestQueue
    live_request_queue = LiveRequestQueue()

    ws_closed = asyncio.Event()
    ui_queue = asyncio.Queue()

    # ---------- Prepare startup context ----------
    async def _prepare_startup_context():
        """Inject browser state into agent context before audio starts."""
        context_blocks = [
            "[Runtime] You are BrowserMind, controlling the user's browser via voice.",
            (
                "[Runtime] This section is setup context only. Do not speak until the user "
                "speaks, types, or sends a command. When you first reply, greet the user "
                "briefly and ask what they'd like to do."
            ),
        ]

        # Inject current browser state
        try:
            info = page_info()
            context_blocks.append(
                f"[Browser State] Current page: {info.get('url', 'unknown')} — "
                f"Title: {info.get('title', 'unknown')} — "
                f"Viewport: {info.get('w', 0)}x{info.get('h', 0)}"
            )
        except Exception:
            context_blocks.append("[Browser State] Browser not yet connected.")

        # Phase 4: Inject current tabs for browsing context
        try:
            from browser_tools import list_tabs
            tabs = list_tabs(include_chrome=False)
            if tabs:
                tab_lines = [f"  - {t.get('title', 'untitled')} ({t.get('url', '')})" for t in tabs[:10]]
                context_blocks.append(
                    f"[Open Tabs] {len(tabs)} tab(s) open:\n" + "\n".join(tab_lines)
                )
        except Exception:
            pass

        session.state["startup_context"] = "\n\n".join(context_blocks)

    await _prepare_startup_context()

    # Send initial screenshot to UI
    try:
        b64 = _screenshot_b64()
        info = page_info()
        ui_queue.put_nowait(json.dumps({
            "type": "browser_screenshot",
            "data": b64,
            "url": info.get("url", ""),
            "title": info.get("title", ""),
        }))
    except Exception as e:
        logger.warning(f"Initial screenshot failed: {e}")

    # Notify frontend session is ready
    ui_queue.put_nowait(json.dumps({
        "type": "session_ready",
    }))

    # ---------- UI sender ----------
    async def ui_sender_task():
        while not ws_closed.is_set():
            try:
                msg = await asyncio.wait_for(ui_queue.get(), timeout=1.0)
                if msg is None:
                    break
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                continue
            except Exception:
                ws_closed.set()
                break

    # ---------- Screenshot loop ----------
    async def screenshot_loop():
        """Periodically capture browser screenshots and push to the frontend viewport.

        We do NOT inject screenshots into the live_request_queue here — doing so
        would send an image every 2s as a "user" turn, disrupting the Gemini Live
        audio session and causing connect/disconnect oscillation.

        The agent can call browser_screenshot() as a tool to get a fresh screenshot
        whenever it needs to verify an action. The viewport still updates live for
        the human operator.
        """
        while not ws_closed.is_set():
            try:
                await asyncio.sleep(2.0)
                if ws_closed.is_set():
                    break

                b64 = await asyncio.get_event_loop().run_in_executor(
                    None, _screenshot_b64
                )
                info = await asyncio.get_event_loop().run_in_executor(
                    None, page_info
                )

                # Push to frontend viewport only
                ui_queue.put_nowait(json.dumps({
                    "type": "browser_screenshot",
                    "data": b64,
                    "url": info.get("url", ""),
                    "title": info.get("title", ""),
                }))

            except Exception as e:
                if not ws_closed.is_set():
                    logger.debug(f"Screenshot loop error: {e}")

    # ---------- Keepalive ----------
    async def ws_keepalive():
        while not ws_closed.is_set():
            try:
                await asyncio.sleep(15)
                if not ws_closed.is_set():
                    await websocket.send_json({"type": "ping"})
            except Exception:
                break

    # ---------- Upstream: client → agent ----------
    async def upstream_task():
        try:
            audio_chunk_count = 0
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    raw = message["bytes"]
                    if len(raw) % 2 != 0:
                        continue
                    audio_chunk_count += 1
                    if audio_chunk_count <= 3 or audio_chunk_count % 100 == 0:
                        try:
                            int16_samples = struct.unpack(f"<{len(raw)//2}h", raw)
                            rms = (sum(s*s for s in int16_samples) / len(int16_samples)) ** 0.5
                            logger.info(
                                f"[audio] chunk #{audio_chunk_count}: "
                                f"{len(raw)} bytes, rms={rms:.4f}"
                            )
                        except Exception:
                            pass
                    # PCM audio from mic
                    live_request_queue.send_realtime(
                        types.Blob(
                            mime_type="audio/pcm;rate=16000",
                            data=raw,
                        )
                    )

                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type", "")

                    if msg_type == "text":
                        live_request_queue.send_content(
                            types.Content(parts=[types.Part(text=data["text"])])
                        )

                    elif msg_type == "navigate":
                        # Manual URL navigation from the UI URL bar
                        url = data.get("url", "")
                        if url:
                            live_request_queue.send_content(
                                types.Content(
                                    parts=[types.Part(text=f"Navigate to {url}")]
                                )
                            )

                    elif msg_type == "viewport_click":
                        # Phase 4: User click passthrough — execute click and inform agent
                        vx = data.get("x", 0)
                        vy = data.get("y", 0)
                        logger.info(f"[viewport-click] User clicked at ({vx}, {vy})")
                        try:
                            from browser_tools import click_at_xy, wait
                            await asyncio.get_event_loop().run_in_executor(
                                None, lambda: (click_at_xy(vx, vy), wait(0.5))
                            )
                            # Push action event to UI
                            ui_queue.put_nowait(json.dumps({
                                "type": "tool_called",
                                "tool": "browser_click",
                                "args": {"x": vx, "y": vy, "reason": "user clicked on viewport"},
                            }))
                            # Take a fresh screenshot after click
                            b64 = await asyncio.get_event_loop().run_in_executor(
                                None, _screenshot_b64
                            )
                            info = await asyncio.get_event_loop().run_in_executor(
                                None, page_info
                            )
                            ui_queue.put_nowait(json.dumps({
                                "type": "browser_screenshot",
                                "data": b64,
                                "url": info.get("url", ""),
                                "title": info.get("title", ""),
                            }))
                        except Exception as e:
                            logger.error(f"Viewport click error: {e}")
                        # Also tell the agent what the user did
                        live_request_queue.send_content(
                            types.Content(
                                parts=[types.Part(text=f"The user just clicked at coordinates ({vx}, {vy}) on the browser viewport.")]
                            )
                        )

                    elif msg_type == "end_turn":
                        live_request_queue.send_activity_end()
                        logger.info("Activity end signalled")

                    elif msg_type == "init":
                        logger.info("Init received")

        except WebSocketDisconnect:
            ws_closed.set()
            raise
        except Exception as e:
            ws_closed.set()
            logger.error(f"Upstream error: {e}")

    # ---------- Downstream: agent → client ----------
    async def downstream_task():
        try:
            async for event in runner.run_live(
                session=session,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                if event is None:
                    continue
                if ws_closed.is_set():
                    break

                # Transcription logging
                input_tx = getattr(event, "input_transcription", None)
                if input_tx and input_tx.finished and input_tx.text:
                    logger.info(f"USER: {input_tx.text}")

                output_tx = getattr(event, "output_transcription", None)
                if output_tx and output_tx.finished and output_tx.text:
                    logger.info(f"AGENT: {output_tx.text}")

                # Forward event to frontend
                try:
                    await websocket.send_text(
                        event.model_dump_json(exclude_none=True, by_alias=True)
                    )
                except Exception:
                    break

                # Log tool calls and push action events to frontend
                _content = getattr(event, "content", None)
                for _part in (getattr(_content, "parts", None) or []):
                    _fn = getattr(_part, "function_call", None)
                    if _fn:
                        _fn_name = getattr(_fn, "name", "?")
                        _fn_args = dict(getattr(_fn, "args", {}) or {})
                        logger.info(f"[tool-call] {_fn_name}({_fn_args})")

                        if not ws_closed.is_set():
                            try:
                                ui_queue.put_nowait(json.dumps({
                                    "type": "tool_called",
                                    "tool": _fn_name,
                                    "args": _fn_args,
                                }))
                            except Exception:
                                pass

                        # After action tools, capture a fresh screenshot for the UI.
                        # Wait 2.5s: background tool (nav) takes ~1-2s to complete.
                        if _fn_name in (
                            "browser_navigate", "browser_click",
                            "browser_type", "browser_press_key",
                            "browser_scroll", "browser_new_tab",
                        ):
                            try:
                                await asyncio.sleep(2.5)
                                loop = asyncio.get_running_loop()
                                b64 = await loop.run_in_executor(None, _screenshot_b64)
                                info = await loop.run_in_executor(None, page_info)
                                logger.info(f"[screenshot] pushing after {_fn_name}, url={info.get('url', '')}")
                                ui_queue.put_nowait(json.dumps({
                                    "type": "browser_screenshot",
                                    "data": b64,
                                    "url": info.get("url", ""),
                                    "title": info.get("title", ""),
                                }))
                            except Exception as e:
                                logger.warning(f"[screenshot] post-tool capture failed: {e}")
        except Exception as e:
            msg = str(e)
            # The Live API rejects explicit activity_start/end when its
            # default automatic VAD is on. The frontend's end-turn button
            # triggers this. Don't kill the session — log + notify the UI.
            if "1007" in msg and "activity" in msg.lower():
                logger.warning(f"Live API rejected explicit activity control: {e}")
                try:
                    ui_queue.put_nowait(json.dumps({
                        "type": "error",
                        "message": "End-turn button isn't supported with automatic VAD; just keep talking.",
                    }))
                except Exception:
                    pass
            else:
                raise

    # ---------- Run all concurrently ----------
    ui_sender = asyncio.create_task(ui_sender_task())
    keepalive = asyncio.create_task(ws_keepalive())
    screenshot_task = asyncio.create_task(screenshot_loop())
    stream_tasks = []

    try:
        stream_tasks = [
            asyncio.create_task(upstream_task()),
            asyncio.create_task(downstream_task()),
        ]
        done, pending = await asyncio.wait(
            stream_tasks,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                raise exc
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        ws_closed.set()
        keepalive.cancel()
        screenshot_task.cancel()
        for task in stream_tasks:
            if not task.done():
                task.cancel()
        live_request_queue.close()
        try:
            ui_queue.put_nowait(None)
        except Exception:
            pass
        try:
            await ui_sender
        except Exception:
            pass
        logger.info(f"Session closed: {session_id}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        reload=False,
    )
