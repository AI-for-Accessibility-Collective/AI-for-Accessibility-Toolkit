import { useState, useRef, useCallback, useEffect } from "react";
import type { Message, ToolCallEvent, BrowserScreenshot } from "../api/client";
import { useAudioPlayer } from "./useAudioPlayer";

const WS_BASE =
  import.meta.env.VITE_WS_BASE_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
// No auto-reconnect: each session_id is unique and bound to a single ADK run.
// Reconnecting to the same session_id after a close just causes a new disconnected loop.
const MAX_RETRIES = 0;

function extractAudioParts(event: any): Array<{ data: string; mimeType: string }> {
  const parts = [
    ...(Array.isArray(event?.content?.parts) ? event.content.parts : []),
    ...(Array.isArray(event?.serverContent?.modelTurn?.parts) ? event.serverContent.modelTurn.parts : []),
  ];
  return parts
    .map((p) => p?.inlineData ?? p?.inline_data ?? null)
    .filter((d): d is { data: string; mimeType?: string; mime_type?: string } => Boolean(d?.data))
    .map((d) => ({ data: d.data, mimeType: d.mimeType ?? d.mime_type ?? "" }))
    .filter((d) => d.mimeType.startsWith("audio/"));
}

export function useBrowserMindWebSocket(sessionId: string) {
  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "live" | "error">("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCallLog, setToolCallLog] = useState<ToolCallEvent[]>([]);
  const [screenshot, setScreenshot] = useState<BrowserScreenshot | null>(null);
  const [clickOverlay, setClickOverlay] = useState<{ x: number; y: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const { enqueueAudioChunk, warmUp: warmUpAudio, stopPlayback, analyserRef, isPlaying: isAudioPlaying, getAudioContext } = useAudioPlayer();

  const appendMessage = useCallback((role: "user" | "agent", text: string) => {
    setMessages((prev) => [...prev, { role, text, ts: new Date() }]);
  }, []);

  useEffect(() => { setMessages([]); setToolCallLog([]); setScreenshot(null); }, [sessionId]);

  const connect = useCallback(() => {
    if (!sessionId) return;
    shouldReconnectRef.current = true;
    setConnectionStatus("connecting");
    const ws = new WebSocket(`${WS_BASE}/ws/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) { ws.close(); return; }
      setConnectionStatus("connecting");
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: "init" }));
    };

    ws.onmessage = (evt) => {
      if (wsRef.current !== ws) return;
      try {
        const event = JSON.parse(evt.data);
        if (event.type === "session_ready") { setConnectionStatus("live"); return; }
        if (event.type === "ping") return;
        if (event.type === "browser_screenshot") {
          setScreenshot({ data: event.data, url: event.url ?? "", title: event.title ?? "" });
          return;
        }
        if (event.type === "tool_called") {
          setToolCallLog((prev) => [...prev, { tool: event.tool, args: event.args ?? {}, ts: new Date() }]);
          if (event.tool === "browser_click" && event.args?.x !== undefined) {
            setClickOverlay({ x: event.args.x as number, y: event.args.y as number });
            setTimeout(() => setClickOverlay(null), 800);
          }
          return;
        }
        // Handle tool results with screenshots
        if (event.type === "tool_result_screenshot") {
          setScreenshot({ data: event.data, url: event.url ?? "", title: event.title ?? "" });
          return;
        }
        extractAudioParts(event).forEach((part) => { enqueueAudioChunk(part.data, part.mimeType).catch(() => {}); });
        const inputTx = event.inputTranscription;
        if (inputTx?.text && inputTx?.finished) appendMessage("user", inputTx.text);
        const outputTx = event.outputTranscription;
        if (outputTx?.text && outputTx?.finished) appendMessage("agent", outputTx.text);
      } catch (e) { console.error("[ws] parse error:", e); }
    };

    ws.onerror = (e) => {
      console.error("[ws] error:", e);
      if (wsRef.current === ws) setConnectionStatus("error");
    };
    ws.onclose = (evt) => {
      // Skip stale close events from a previous WS instance
      if (wsRef.current !== ws && wsRef.current !== null) return;
      if (wsRef.current === ws) wsRef.current = null;
      console.log(`[ws] closed: code=${evt.code} reason=${evt.reason}`);
      setConnectionStatus("disconnected");
      // Only retry on unexpected close (not normal 1000/1001) and if retries remain
      const isAbnormalClose = evt.code !== 1000 && evt.code !== 1001;
      if (shouldReconnectRef.current && isAbnormalClose && retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        console.log(`[ws] reconnecting (attempt ${retriesRef.current}/${MAX_RETRIES})...`);
        setTimeout(() => { if (shouldReconnectRef.current) connect(); }, 2000);
      }
    };
  }, [sessionId, enqueueAudioChunk, appendMessage]);

  useEffect(() => {
    if (sessionId) connect();
    return () => {
      shouldReconnectRef.current = false;
      if (wsRef.current) { const ws = wsRef.current; wsRef.current = null; ws.close(); }
    };
  }, [connect, sessionId]);

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "text", text }));
  }, []);
  const sendNavigate = useCallback((url: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "navigate", url }));
  }, []);
  // Phase 4: User click passthrough — click on viewport sends coordinates to the agent
  const sendClick = useCallback((x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "viewport_click", x, y }));
      // Show temporary click overlay
      setClickOverlay({ x, y });
      setTimeout(() => setClickOverlay(null), 800);
    }
  }, []);
  const signalTurnEnd = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "end_turn" }));
  }, []);
  const stopAudioPlayback = useCallback(() => stopPlayback(), [stopPlayback]);

  return { connectionStatus, messages, toolCallLog, screenshot, clickOverlay, sendText, sendNavigate, sendClick, signalTurnEnd, warmUpAudio, stopAudioPlayback, wsRef, analyserRef, isAudioPlaying, getAudioContext };
}
