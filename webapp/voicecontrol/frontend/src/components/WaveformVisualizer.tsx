import React, { useRef, useEffect, useCallback } from "react";

interface Props {
  analyserRef: React.RefObject<AnalyserNode | null>;
  isRecording: boolean;
  isPlaying: boolean;
}

const BAR_COUNT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const CANVAS_HEIGHT = 40;
const CANVAS_WIDTH = (BAR_WIDTH + BAR_GAP) * BAR_COUNT;

export default function WaveformVisualizer({ analyserRef, isRecording, isPlaying }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);

      const step = Math.floor(data.length / BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        const val = data[i * step] / 255;
        const barH = Math.max(2, val * CANVAS_HEIGHT * 0.85);
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = (CANVAS_HEIGHT - barH) / 2;

        const gradient = ctx.createLinearGradient(x, y, x, y + barH);
        if (isPlaying) {
          gradient.addColorStop(0, "rgba(99, 102, 241, 0.9)");
          gradient.addColorStop(1, "rgba(167, 139, 250, 0.6)");
        } else if (isRecording) {
          gradient.addColorStop(0, "rgba(16, 185, 129, 0.9)");
          gradient.addColorStop(1, "rgba(52, 211, 153, 0.6)");
        } else {
          gradient.addColorStop(0, "rgba(100, 116, 139, 0.4)");
          gradient.addColorStop(1, "rgba(100, 116, 139, 0.2)");
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, barH, 1);
        ctx.fill();
      }
    } else {
      // Idle: draw faint static bars
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (BAR_WIDTH + BAR_GAP);
        const barH = 2 + Math.sin(i * 0.5 + Date.now() * 0.001) * 2;
        const y = (CANVAS_HEIGHT - barH) / 2;
        ctx.fillStyle = "rgba(100, 116, 139, 0.2)";
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, barH, 1);
        ctx.fill();
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [analyserRef, isRecording, isPlaying]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div className="waveform-container">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="waveform-canvas"
      />
      <span className="waveform-label">
        {isPlaying ? "Agent speaking" : isRecording ? "Listening..." : "Idle"}
      </span>
    </div>
  );
}
