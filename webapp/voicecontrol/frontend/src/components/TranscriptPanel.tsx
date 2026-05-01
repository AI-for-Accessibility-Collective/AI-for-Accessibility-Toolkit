import React, { useRef, useEffect } from "react";
import type { Message } from "../api/client";

interface Props {
  messages: Message[];
}

export default function TranscriptPanel({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="panel-left">
      <div className="panel-header">
        <span className="panel-header-icon">💬</span>
        <span className="panel-header-title">Transcript</span>
      </div>
      <div className="transcript-list">
        {messages.length === 0 && (
          <div className="transcript-empty">
            <span className="transcript-empty-icon">🎤</span>
            <p className="transcript-empty-text">
              Speak to control the browser.<br />
              Transcript will appear here.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
            <div className={`msg ${msg.role === "user" ? "msg-user" : "msg-agent"}`}>
              {msg.text}
            </div>
            <span className="msg-time">{formatTime(msg.ts)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
