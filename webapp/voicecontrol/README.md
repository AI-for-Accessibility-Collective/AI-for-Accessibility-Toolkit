# BrowserMind 🧠🌐

> Voice-controlled browser agent powered by the **Gemini Live API**, **Google ADK**, and **browser-harness**.

Talk to your browser. BrowserMind listens to your voice, sees the live browser viewport, and autonomously navigates, clicks, types, and scrolls — narrating every action out loud.

---

## Architecture

```
User Voice  ──►  FastAPI WebSocket  ──►  ADK LiveRequestQueue  ──►  Gemini Live API
                                                                          │
Browser Screenshots ◄── browser-harness daemon ◄── CDP ◄── Chrome :9222  │
         └──────────────────────────────────────────────────────────────►┘
```

| Layer | Stack |
|---|---|
| **Frontend** | Vite + React 19 + TypeScript — three-panel UI (transcript \| browser viewport \| action log) |
| **Backend** | FastAPI + bidirectional WebSocket streaming via ADK `run_live()` |
| **Agent** | Google ADK with Gemini Live API (audio + vision) |
| **Browser** | `browser-harness` daemon connects to Chrome via CDP on port 9222 |

---

## Prerequisites

### 1. Chrome with Remote Debugging

Launch Chrome with the remote debugging port open:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug
```

> **Tip:** You can also create a shell alias or a launcher script to do this automatically.

### 2. browser-harness

`browser-harness` is bundled at `../browser-harness/` in this repo and installed below via `uv pip install -e ../../browser-harness`. Only clone it yourself if `webapp/browser-harness/` is missing:

```bash
cd webapp && git clone https://github.com/browser-use/browser-harness.git
```

### 3. UV (Python package manager)

Install `uv` if you don't have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 4. Node.js & npm

Required for the frontend. Node 18+ recommended.

### 5. Gemini API Key

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

---

## Setup & Running

### Step 1 — Clone the repo

```bash
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit/webapp/voicecontrol
```

### Step 2 — Backend

```bash
cd backend

# Copy the env template and add your API key
cp .env.example .env
# Open .env and set:
#   GEMINI_API_KEY=your-gemini-api-key
#   DEMO_AGENT_MODEL=gemini-live-2.5-flash-native-audio   # optional override

# Run the backend with uv (installs dependencies automatically)
uv run python main.py
```

The backend starts on **`http://localhost:8080`**.

> `uv run` automatically creates a virtual environment and installs all dependencies from `pyproject.toml` on first run — no manual `pip install` needed.

### Step 3 — Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend starts on **`http://localhost:3000`**.

### Step 4 — Start a session

1. Make sure Chrome is running with `--remote-debugging-port=9222`
2. The backend auto-spawns the `browser-harness` daemon on startup — no separate launch needed
3. Open `http://localhost:3000`
4. Click **Start Session** and allow microphone access
5. Start talking — the agent will respond and control the browser

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in your values:

```env
# Required
GEMINI_API_KEY=your-gemini-api-key-here

# Optional — override the default model
# DEMO_AGENT_MODEL=gemini-live-2.5-flash-native-audio
```

> ⚠️ **Never commit `.env`** — it is listed in `.gitignore`.

---

## Project Structure

```
browsermind/
├── backend/
│   ├── main.py            # FastAPI app + WebSocket session handler
│   ├── agent.py           # ADK agent definition + Gemini Live setup
│   ├── browser_tools.py   # browser-harness tool wrappers (navigate, click, type…)
│   ├── pyproject.toml     # Python dependencies (used by uv)
│   ├── requirements.txt   # pip-compatible dependency list
│   ├── .env.example       # Environment variable template
│   └── uv.lock            # Locked dependency versions
└── frontend/
    ├── src/
    │   ├── App.tsx                          # Main app shell + session state
    │   ├── components/
    │   │   ├── TranscriptPanel.tsx          # Live conversation transcript
    │   │   ├── BrowserViewport.tsx          # Live browser screenshot stream
    │   │   ├── ActionLog.tsx                # Agent tool call log
    │   │   ├── WaveformVisualizer.tsx       # Mic input waveform
    │   │   └── ErrorToast.tsx              # Error notifications
    │   ├── hooks/
    │   │   ├── useBrowserMindWebSocket.ts   # WebSocket session management
    │   │   ├── useAudioRecorder.ts          # Mic capture + PCM streaming
    │   │   └── useAudioPlayer.ts            # Agent audio playback
    │   └── api/
    │       └── client.ts                    # REST/WS API client
    ├── public/
    │   └── pcm-processor.js                 # AudioWorklet for PCM processing
    ├── package.json
    └── vite.config.ts
```

---

## How It Works

1. **You speak** — your mic audio is captured as PCM via an `AudioWorklet` and streamed over WebSocket to the backend
2. **Backend relays** — the FastAPI server forwards audio chunks into the ADK `LiveRequestQueue`
3. **Gemini sees + hears** — the agent receives your speech and periodic browser screenshots simultaneously
4. **Agent acts** — Gemini decides which browser tool to call (`navigate`, `click`, `type`, `scroll`, `screenshot`)
5. **browser-harness executes** — the CDP daemon performs the action in the live Chrome window
6. **Screenshot updates** — a fresh screenshot is captured after each action and streamed to both the UI viewport and the agent's vision context
7. **Agent speaks back** — audio responses are streamed back and played in real time

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Connection refused` on Start Session | Make sure `uv run python main.py` is running on port 8080 |
| `browser-harness: not connected` or `[Errno 2] No such file or directory` on tool calls | Ensure Chrome was launched with `--remote-debugging-port=9222`. The backend auto-discovers Chrome via `http://localhost:9222/json/version` on startup — override the port with `BU_CDP_PORT`, or set `BU_CDP_WS` directly to skip discovery |
| No audio input | Grant microphone permission in the browser; check browser console for `AudioContext` errors |
| `GEMINI_API_KEY` not found | Confirm `backend/.env` exists and has the correct key (not the example placeholder) |
| Blank viewport | Chrome must be open with a visible page; the agent needs an active tab to screenshot |

---

## License

Apache 2.0 — see [LICENSE](../../LICENSE).
