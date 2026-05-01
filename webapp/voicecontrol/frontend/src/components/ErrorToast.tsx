import React, { useEffect, useState } from "react";

interface Props {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
}

export default function ErrorToast({ message, onDismiss, duration = 5000 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, duration);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div className={`error-toast ${visible ? "visible" : ""}`}>
      <span className="error-toast-icon">⚠️</span>
      <span className="error-toast-msg">{message}</span>
      <button className="error-toast-close" onClick={() => { setVisible(false); onDismiss(); }}>✕</button>
    </div>
  );
}
