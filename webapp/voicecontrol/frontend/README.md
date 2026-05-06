# BrowserMind Voice — Frontend

React + TypeScript frontend for the voice-controlled browser agent.

## Layout

Three-panel UI:
- **Transcript** — live conversation between you and the agent
- **Browser Viewport** — streaming screenshots of the controlled Chrome window
- **Action Log** — agent tool calls (navigate, click, type, scroll)

## Setup

```bash
npm install
npm run dev
```

Opens on http://localhost:3000. Requires the backend running on port 8080.

## Key Components

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app shell + session state |
| `src/components/TranscriptPanel.tsx` | Live conversation transcript |
| `src/components/BrowserViewport.tsx` | Browser screenshot stream |
| `src/components/ActionLog.tsx` | Agent tool call log |
| `src/components/WaveformVisualizer.tsx` | Mic input waveform |
| `src/hooks/useBrowserMindWebSocket.ts` | WebSocket session management |
| `src/hooks/useAudioRecorder.ts` | Mic capture + PCM streaming |
| `src/hooks/useAudioPlayer.ts` | Agent audio playback |
| `public/pcm-processor.js` | AudioWorklet for PCM processing |

## How Audio Works

1. `useAudioRecorder` captures mic input via an `AudioWorklet` (`pcm-processor.js`)
2. PCM chunks are streamed over WebSocket to the FastAPI backend
3. Backend forwards audio to the Gemini Live API
4. Agent audio responses stream back and are played via `useAudioPlayer`
