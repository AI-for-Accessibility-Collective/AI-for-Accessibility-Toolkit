import React from "react";
import type { BrowserScreenshot } from "../api/client";

interface Props {
  screenshot: BrowserScreenshot | null;
  clickOverlay: { x: number; y: number } | null;
  onNavigate: (url: string) => void;
  onViewportClick?: (x: number, y: number) => void;
}

export default function BrowserViewport({ screenshot, clickOverlay, onNavigate, onViewportClick }: Props) {
  const [urlInput, setUrlInput] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    onNavigate(url);
    setEditing(false);
  };

  // Phase 4: User click passthrough — click on screenshot sends coordinates to agent
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onViewportClick || !imgRef.current) return;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();

    // Calculate CSS-pixel coordinates in the original browser viewport
    const dpr = window.devicePixelRatio || 1;
    const scaleX = (img.naturalWidth / dpr) / rect.width;
    const scaleY = (img.naturalHeight / dpr) / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    onViewportClick(x, y);
  };

  // Calculate click position relative to displayed image
  const getOverlayStyle = (): React.CSSProperties | null => {
    if (!clickOverlay || !imgRef.current || !containerRef.current) return null;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scaleX = rect.width / (img.naturalWidth / dpr);
    const scaleY = rect.height / (img.naturalHeight / dpr);
    return {
      left: rect.left - containerRect.left + clickOverlay.x * scaleX,
      top: rect.top - containerRect.top + clickOverlay.y * scaleY,
    };
  };

  const overlayStyle = getOverlayStyle();

  return (
    <div className="panel-center">
      <div className="viewport-container" ref={containerRef}>
      {screenshot?.data ? (
          <>
            <img
              ref={imgRef}
              src={`data:image/png;base64,${screenshot.data}`}
              alt="Browser viewport"
              className="viewport-img"
              onClick={handleImageClick}
              style={{ cursor: onViewportClick ? "crosshair" : "default" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              onLoad={(e) => { (e.target as HTMLImageElement).style.display = ""; }}
            />
            {clickOverlay && overlayStyle && (
              <div className="click-overlay" style={overlayStyle}>
                <div className="click-crosshair-h" />
                <div className="click-crosshair-v" />
                <div className="click-ring" />
              </div>
            )}
          </>
        ) : (
          <div className="viewport-empty">
            <div className="viewport-empty-pulse" />
            <span className="viewport-empty-icon">🌐</span>
            <p className="viewport-empty-text">
              {screenshot ? "Capturing browser screenshot..." : "Waiting for browser connection..."}
            </p>
          </div>
        )}
      </div>

      <div className="url-bar">
        <span className="url-icon">🌐</span>
        {editing ? (
          <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex", gap: "8px" }}>
            <input
              id="url-nav-input"
              className="url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter URL..."
              autoFocus
              onBlur={() => setEditing(false)}
            />
          </form>
        ) : (
          <>
            <span
              className="url-display"
              onClick={() => {
                setUrlInput(screenshot?.url ?? "");
                setEditing(true);
              }}
              style={{ cursor: "text" }}
            >
              {screenshot?.url || "about:blank"}
            </span>
            {screenshot?.title && (
              <span className="url-title">— {screenshot.title}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
