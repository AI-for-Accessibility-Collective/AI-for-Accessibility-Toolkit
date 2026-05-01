import { useRef, useState, useCallback } from "react";

export function useAudioPlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const pendingChunksRef = useRef<Array<{ data: string; mimeType?: string }>>([]);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);

  const normalizeBase64 = useCallback((value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    if (!padding) return normalized;
    return normalized.padEnd(normalized.length + (4 - padding), "=");
  }, []);

  const getSampleRate = useCallback((mimeType?: string) => {
    const match = mimeType?.match(/rate=(\d+)/i);
    return match ? Number(match[1]) : 24000;
  }, []);

  const getAudioContext = useCallback(async () => {
    const AudioContextCtor =
      window.AudioContext ||
      ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);

    if (!AudioContextCtor) throw new Error("AudioContext not supported");

    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContextCtor({ sampleRate: 24000 });
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      analyser.connect(audioCtxRef.current.destination);
      analyserRef.current = analyser;
    }

    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  const playChunk = useCallback((ctx: AudioContext, base64PcmData: string, mimeType?: string) => {
    if (ctx.state === "closed") return;

    const raw = atob(normalizeBase64(base64PcmData));
    const byteLen = raw.length - (raw.length % 2);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) bytes[i] = raw.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, getSampleRate(mimeType));
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserRef.current ?? ctx.destination);
    activeSourcesRef.current.add(source);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;

    setIsPlaying(true);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (nextPlayTimeRef.current <= ctx.currentTime) setIsPlaying(false);
    };
  }, [getSampleRate, normalizeBase64]);

  const stopPlayback = useCallback(() => {
    pendingChunksRef.current = [];
    activeSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch {}
      source.disconnect();
    });
    activeSourcesRef.current.clear();
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") {
      nextPlayTimeRef.current = ctx.currentTime;
    } else {
      nextPlayTimeRef.current = 0;
    }
    setIsPlaying(false);
  }, []);

  const warmUp = useCallback(async () => {
    const ctx = await getAudioContext();
    nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, ctx.currentTime);
    const unlockBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const unlockSource = ctx.createBufferSource();
    unlockSource.buffer = unlockBuffer;
    unlockSource.connect(ctx.destination);
    unlockSource.start();

    if (pendingChunksRef.current.length) {
      const pending = [...pendingChunksRef.current];
      pendingChunksRef.current = [];
      pending.forEach(({ data, mimeType }) => playChunk(ctx, data, mimeType));
    }
  }, [getAudioContext, playChunk]);

  const enqueueAudioChunk = useCallback(async (base64PcmData: string, mimeType?: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      pendingChunksRef.current.push({ data: base64PcmData, mimeType });
      return;
    }
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {
        pendingChunksRef.current.push({ data: base64PcmData, mimeType });
        return;
      }
    }
    playChunk(ctx, base64PcmData, mimeType);
  }, [playChunk]);

  return { enqueueAudioChunk, isPlaying, warmUp, stopPlayback, analyserRef, getAudioContext };
}
