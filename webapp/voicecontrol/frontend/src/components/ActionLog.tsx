import React, { useRef, useEffect } from "react";
import type { ToolCallEvent } from "../api/client";

interface Props {
  toolCallLog: ToolCallEvent[];
  connectionStatus: string;
  isAudioPlaying: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  browser_navigate: "🧭",
  browser_click: "👆",
  browser_type: "⌨️",
  browser_press_key: "⏎",
  browser_scroll: "📜",
  browser_screenshot: "📸",
  browser_read_page: "📖",
  browser_new_tab: "➕",
  browser_list_tabs: "📑",
  browser_js: "⚡",
};

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([k]) => k !== "reason");
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}

export default function ActionLog({ toolCallLog, connectionStatus, isAudioPlaying }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [toolCallLog]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="panel-right">
      <div className="panel-header">
        <span className="panel-header-icon">📋</span>
        <span className="panel-header-title">Actions</span>
      </div>

      <div className="action-list">
        {toolCallLog.length === 0 && (
          <div className="transcript-empty">
            <span className="transcript-empty-icon">🤖</span>
            <p className="transcript-empty-text">
              Agent actions will<br />appear here
            </p>
          </div>
        )}
        {toolCallLog.map((action, i) => (
          <div key={i} className="action-item">
            <span className="action-icon">
              {TOOL_ICONS[action.tool] ?? "🔧"}
            </span>
            <div className="action-body">
              <div className="action-name">{action.tool.replace("browser_", "")}</div>
              {formatArgs(action.args) && (
                <div className="action-args">{formatArgs(action.args)}</div>
              )}
              {(action.args as any).reason && (
                <div className="action-args" style={{ color: "var(--text-secondary)" }}>
                  {(action.args as any).reason}
                </div>
              )}
            </div>
            <span className="action-time">{formatTime(action.ts)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="agent-status">
        <div className="agent-status-card">
          <div className="agent-status-row">
            <span className="agent-status-label">Status</span>
            <span className="agent-status-value">
              <span className={`status-dot ${connectionStatus}`} style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 6 }} />
              {connectionStatus === "live" ? (isAudioPlaying ? "Speaking" : "Listening") : connectionStatus}
            </span>
          </div>
          <div className="agent-status-row">
            <span className="agent-status-label">Steps</span>
            <span className="agent-status-value">{toolCallLog.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
