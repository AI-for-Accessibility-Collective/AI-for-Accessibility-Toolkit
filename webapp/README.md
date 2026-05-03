# webapp/

Web applications for specialized accessibility use cases.

## Projects

### [voicecontrol/](voicecontrol/)

**BrowserMind** — Voice-controlled browser agent powered by the Gemini Live API.

Talk to your browser; it navigates, clicks, types, and scrolls autonomously while narrating actions.

- **Frontend:** Vite + React 19 + TypeScript
- **Backend:** FastAPI + Google ADK + Gemini Live API
- **Browser:** Chrome via CDP (browser-harness daemon)

See [voicecontrol/README.md](voicecontrol/README.md) for setup.

### [browser-harness/](browser-harness/)

CDP daemon for browser control. Used internally by voicecontrol; bundled from [browser-use/browser-harness](https://github.com/browser-use/browser-harness).

## Running

Each webapp has its own setup. See individual READMEs.
