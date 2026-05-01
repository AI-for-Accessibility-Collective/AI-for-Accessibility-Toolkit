# BrowserMind Text

A text-based browser automation agent powered by **Gemini** via the `google-genai` SDK.  
Type natural language commands → agent controls your Chrome browser.

## Architecture

- **Backend**: FastAPI + `google-genai` SDK Chat API (multi-turn, full visual history)
- **Frontend**: Vanilla HTML/CSS/JS — 3-panel layout (chat | browser viewport | activity log)
- **Browser control**: `browser-harness` CDP tool (navigate, click, type, scroll, JS)
- **Self-healing**: Every screenshot is added as `inline_data` — Gemini sees real images in context
- **Skill loading**: Lazy domain/interaction skill loading mirrors Gemini CLI pattern

## Prerequisites

1. **Chrome** running with remote debugging:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```

2. **browser-harness** daemon reachable at `../../browser-harness` (or set `BROWSER_HARNESS_DIR`)

3. **Google credentials** — either Vertex AI or a Gemini API key

## Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your project/API key

uv venv && uv pip install -e .
uv run uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

Then open **http://localhost:8080** in your browser.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_VERTEX_AI` | Use Vertex AI instead of Gemini API | `true` |
| `VERTEX_PROJECT` | GCP project ID | required if Vertex |
| `VERTEX_LOCATION` | Vertex AI region | `global` |
| `GEMINI_API_KEY` | Gemini API key | required if not Vertex |
| `AGENT_MODEL` | Model to use | `gemini-2.5-flash` |
| `BROWSER_HARNESS_DIR` | Path to browser-harness checkout | `../../browser-harness` |

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `user_message` | Client → Server | User's text command |
| `thinking` | Server → Client | Agent started reasoning |
| `text_chunk` | Server → Client | Streaming agent response |
| `tool_called` | Server → Client | Browser tool being executed |
| `tool_done` | Server → Client | Tool finished (success/error) |
| `skill_loaded` | Server → Client | Domain/interaction skill read |
| `browser_screenshot` | Server → Client | Screenshot after action |
| `task_done` | Server → Client | Task completed |
| `max_steps_reached` | Server → Client | Step limit hit |
| `error` | Server → Client | Agent error |
| `new_session` | Client → Server | Reset conversation |
| `ping` / `pong` | Both | Keepalive |

## How Self-Healing Works

1. After every browser action, a screenshot is taken as raw PNG bytes
2. The screenshot is added to the conversation as a `types.Part(inline_data=...)` — Gemini sees it as an actual image
3. The full screenshot history is in every LLM call
4. Gemini can visually compare before/after states and reason about failures
5. If a click missed, Gemini sees both screenshots and adjusts coordinates
