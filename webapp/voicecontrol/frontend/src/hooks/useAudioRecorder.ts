import { useRef, useState, useCallback } from "react";

const SILENCE_RMS_THRESHOLD = 0.012;

interface UseAudioRecorderOptions {
  onSpeechStart?: () => void;
  onTurnEnd?: () => void;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownedCtxRef = useRef<AudioContext | null>(null);
  const wsRefInternal = useRef<{ current: WebSocket | null } | null>(null);
  const speechActiveRef = useRef(false);
  const onSpeechStartRef = useRef(options.onSpeechStart);
  onSpeechStartRef.current = options.onSpeechStart;

  const stopRecording = useCallback(() => {
    workletNodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    workletNodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    wsRefInternal.current = null;
    speechActiveRef.current = false;
    const ownedCtx = ownedCtxRef.current;
    ownedCtxRef.current = null;
    if (ownedCtx && ownedCtx.state !== "closed") {
      void ownedCtx.close();
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async (
    wsRefOrSocket: React.RefObject<WebSocket | null> | WebSocket,
    sharedCtx?: AudioContext,
  ) => {
    if (isRecording) return;

    wsRefInternal.current =
      "current" in wsRefOrSocket ? wsRefOrSocket : { current: wsRefOrSocket };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      let ctx = sharedCtx;
      if (!ctx) {
        const AudioContextCtor =
          window.AudioContext ||
          ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
        if (!AudioContextCtor) throw new Error("AudioContext not supported");
        ctx = new AudioContextCtor({ sampleRate: 24000 });
        ownedCtxRef.current = ctx;
      }
      if (ctx.state === "suspended") await ctx.resume();
      const nativeRate = ctx.sampleRate;

      await ctx.audioWorklet.addModule("/pcm-processor.js");

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const workletNode = new AudioWorkletNode(ctx, "pcm-processor", {
        processorOptions: { inputSampleRate: nativeRate },
      });
      workletNodeRef.current = workletNode;
      speechActiveRef.current = false;

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const ws = wsRefInternal.current?.current;
        // If WS isn't open, just drop the audio chunk.
        // App.tsx effect handles stopRecording() when connectionStatus changes.
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const buffer = e.data;
        ws.send(buffer);

        // RMS for barge-in detection
        const int16 = new Int16Array(buffer);
        let sumSquares = 0;
        for (let i = 0; i < int16.length; i++) {
          const sample = int16[i] / 32768;
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / int16.length);

        const isSpeech = rms >= SILENCE_RMS_THRESHOLD;
        if (isSpeech && !speechActiveRef.current) {
          speechActiveRef.current = true;
          onSpeechStartRef.current?.();
        } else if (!isSpeech && speechActiveRef.current) {
          speechActiveRef.current = false;
        }
      };

      workletNode.onprocessorerror = () => stopRecording();
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => stopRecording();
      });

      source.connect(workletNode);
      workletNode.connect(ctx.destination);

      setIsRecording(true);
    } catch (err) {
      console.error("[recorder] Microphone access error:", err);
    }
  }, [isRecording, stopRecording]);

  return { startRecording, stopRecording, isRecording };
}
