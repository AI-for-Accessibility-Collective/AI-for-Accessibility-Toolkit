# webapp/

Web applications for specialized accessibility use cases.

## Projects

### [textcontrol/](textcontrol/)

**BrowserMind Text** — Type natural language commands to control the browser. Uses Gemini 2.5 Flash.

- **Frontend:** Vanilla HTML/CSS/JS — 3-panel layout (chat | browser viewport | activity log)
- **Backend:** FastAPI + `google-genai` SDK
- **Browser:** Chrome via CDP (browser-harness daemon)

See [textcontrol/README.md](textcontrol/README.md) for setup.

### [voicecontrol/](voicecontrol/)

**BrowserMind** — Voice-controlled browser agent powered by the Gemini Live API.

Talk to your browser; it navigates, clicks, types, and scrolls autonomously while narrating actions.

- **Frontend:** Vite + React 19 + TypeScript
- **Backend:** FastAPI + Google ADK + Gemini Live API
- **Browser:** Chrome via CDP (browser-harness daemon)

See [voicecontrol/README.md](voicecontrol/README.md) for setup.

### [browser-harness/](browser-harness/)

CDP daemon for browser control. Used internally by textcontrol and voicecontrol; bundled from [browser-use/browser-harness](https://github.com/browser-use/browser-harness).

## Why two separate backends?

`textcontrol` and `voicecontrol` deliberately **do not** share an agent
implementation. They target different modalities and use different Google
frameworks: textcontrol runs a turn-based `google-genai` chat loop, while
voicecontrol runs `google-adk` with the Gemini **Live** API for streaming
bidirectional audio. Their `agent.py` / `browser_tools.py` look similar but
diverge intentionally (e.g. tool return conventions differ). Only the
`browser-harness` daemon underneath is shared. Don't "deduplicate" them into
one module — the divergence is by design.

## Running

Each webapp has its own setup. See individual READMEs.
