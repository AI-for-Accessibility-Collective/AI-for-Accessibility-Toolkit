import React, { useEffect, useState, useCallback, useRef } from "react";
import { createSession } from "./api/client";
import { useBrowserMindWebSocket } from "./hooks/useBrowserMindWebSocket";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import TranscriptPanel from "./components/TranscriptPanel";
import BrowserViewport from "./components/BrowserViewport";
import ActionLog from "./components/ActionLog";
import WaveformVisualizer from "./components/WaveformVisualizer";
import ErrorToast from "./components/ErrorToast";

type AppMode = "start" | "connecting" | "live";

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("start");
  const [sessionId, setSessionId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Guard: only start the mic once per session (prevents double-start from effect deps re-firing)
  const micStartedRef = useRef(false);

  const handleStart = useCallback(async () => {
    setAppMode("connecting");
    setErrorMsg(null);
    micStartedRef.current = false;
    try {
      const res = await createSession();
      setSessionId(res.session_id);
    } catch (e: any) {
      console.error("Failed to create session:", e);
      setErrorMsg(
        e?.message?.includes("fetch")
          ? "Cannot reach backend — is the server running on port 8080?"
          : `Session error: ${e?.message || "Unknown error"}`
      );
      setAppMode("start");
    }
  }, []);

  const {
    connectionStatus, messages, toolCallLog, screenshot, clickOverlay,
    sendText, sendNavigate, sendClick, signalTurnEnd,
    warmUpAudio, stopAudioPlayback,
    wsRef, analyserRef, getAudioContext, isAudioPlaying,
  } = useBrowserMindWebSocket(sessionId);

  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
    onSpeechStart: stopAudioPlayback,
    onTurnEnd: signalTurnEnd,
  });

  // Transition: connecting → live
  useEffect(() => {
    if (appMode === "connecting" && connectionStatus === "live") {
      setAppMode("live");
    }
  }, [appMode, connectionStatus]);

  // Handle connection errors
  useEffect(() => {
    if (connectionStatus === "error" && appMode === "connecting") {
      setErrorMsg("WebSocket connection failed — check backend logs.");
      setAppMode("start");
      setSessionId("");
    }
  }, [connectionStatus, appMode]);

  // Auto-start mic when live — guarded by micStartedRef to prevent double-start
  useEffect(() => {
    if (connectionStatus === "live" && wsRef.current && !isRecording && !micStartedRef.current) {
      micStartedRef.current = true;
      void warmUpAudio();
      void (async () => {
        const ctx = await getAudioContext();
        void startRecording(wsRef, ctx);
      })();
    }
  }, [connectionStatus, wsRef, isRecording, warmUpAudio, startRecording, getAudioContext]);

  useEffect(() => {
    if (connectionStatus !== "live" && isRecording) stopRecording();
  }, [connectionStatus, isRecording, stopRecording]);

  const toggleMic = () => {
    if (isRecording) { stopRecording(); signalTurnEnd(); return; }
    if (!wsRef.current || connectionStatus !== "live") return;
    void warmUpAudio();
    void (async () => {
      const ctx = await getAudioContext();
      void startRecording(wsRef, ctx);
    })();
  };

  const handleEnd = useCallback(() => {
    stopRecording();
    micStartedRef.current = false;
    setAppMode("start");
    setSessionId("");
  }, [stopRecording]);

  const [textInput, setTextInput] = useState("");
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput("");
  };

  // Phase 4: User click passthrough — click on viewport to send coordinates to agent
  const handleViewportClick = useCallback((x: number, y: number) => {
    sendClick(x, y);
  }, [sendClick]);

  // ---------- Start screen ----------
  if (appMode === "start") {
    return (
      <div className="start-screen">
        <ErrorToast message={errorMsg} onDismiss={() => setErrorMsg(null)} />
        <div className="start-hero">
          <div className="start-glow" />
          <div className="start-logo">⚡ BrowserMind</div>
          <p className="start-subtitle">
            Voice-controlled browser agent powered by Gemini Live API.
            Speak naturally to navigate, search, and interact with any website.
          </p>
          <button
            id="start-session-btn"
            className="btn btn-primary btn-lg"
            onClick={handleStart}
          >
            <span className="btn-icon-inner">🚀</span>
            Start Session
          </button>
          <div className="start-features">
            <div className="start-feature">
              <span className="start-feature-icon">🎤</span>
              <span>Voice Control</span>
            </div>
            <div className="start-feature">
              <span className="start-feature-icon">👁️</span>
              <span>Visual Understanding</span>
            </div>
            <div className="start-feature">
              <span className="start-feature-icon">🖱️</span>
              <span>Click & Type</span>
            </div>
          </div>
          <p className="start-hint">
            Make sure Chrome is running with remote debugging enabled
            and browser-harness daemon is active
          </p>
        </div>
      </div>
    );
  }

  // ---------- Connecting ----------
  if (appMode === "connecting") {
    return (
      <div className="connecting-overlay">
        <div className="connecting-spinner" />
        <p className="connecting-text">Connecting to browser agent...</p>
        <p className="connecting-subtext">Starting ADK runner and browser-harness daemon</p>
        <button className="btn" onClick={handleEnd} style={{ marginTop: 16 }}>Cancel</button>
      </div>
    );
  }

  // ---------- Live session ----------
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <ErrorToast message={errorMsg} onDismiss={() => setErrorMsg(null)} />

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="header-brand">⚡ BrowserMind</span>
          <span className="header-divider">·</span>
          <span className="header-subtitle">Browser Agent</span>
          <div className="status-badge" style={{ marginLeft: 8 }}>
            <span className={`status-dot ${connectionStatus}`} />
            <span className={`status-text ${connectionStatus}`}>{connectionStatus}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <WaveformVisualizer
            analyserRef={analyserRef}
            isRecording={isRecording}
            isPlaying={isAudioPlaying}
          />
          <button className="btn btn-danger" onClick={handleEnd}>End Session</button>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="main-layout">
        {/* Left: Transcript + controls */}
        <div className="panel-left-container">
          <TranscriptPanel messages={messages} />

          {/* Text input */}
          <form onSubmit={handleTextSubmit} className="text-input-form">
            <input
              id="text-command-input"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type a command..."
              className="url-input"
              style={{ flex: 1, fontSize: 12 }}
            />
            <button type="submit" className="btn" style={{ padding: "4px 12px", fontSize: 11 }}>Send</button>
          </form>

          {/* Voice controls */}
          <div className="controls-bar">
            <button
              id="mic-toggle-btn"
              className={`btn btn-icon ${isRecording ? "recording" : ""}`}
              onClick={toggleMic}
              title={isRecording ? "Stop mic" : "Start mic"}
            >
              🎤
            </button>
            <div className={`speaker-indicator ${isAudioPlaying ? "playing" : ""}`}>
              🔊
            </div>
          </div>
        </div>

        {/* Center: Browser viewport */}
        <BrowserViewport
          screenshot={screenshot}
          clickOverlay={clickOverlay}
          onNavigate={sendNavigate}
          onViewportClick={handleViewportClick}
        />

        {/* Right: Action log */}
        <ActionLog
          toolCallLog={toolCallLog}
          connectionStatus={connectionStatus}
          isAudioPlaying={isAudioPlaying}
        />
      </div>
    </div>
  );
}
