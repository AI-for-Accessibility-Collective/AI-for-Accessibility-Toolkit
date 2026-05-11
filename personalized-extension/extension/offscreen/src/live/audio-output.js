// Sequenced playback for Gemini Live's 24 kHz Int16 mono PCM stream.
// Each chunk arrives base64-encoded; we decode, convert to Float32, and
// schedule a fresh AudioBufferSourceNode at nextPlayTime so playback is
// gapless. flush() is called on barge-in (mic detected speech) and on the
// server's interrupted=true signal -- both must take effect immediately
// or the model talks over the user.

export function createAudioPlayer({ sampleRate = 24000 } = {}) {
  let ctx = null;
  let nextPlayTime = 0;
  const activeSources = new Set();
  // Fires once when the queue drains. Used by offscreen/index.js to
  // flip voiceState.speaking false -- without this hook, a turnComplete
  // that arrives while audio is still playing leaves the flag stuck
  // true, which blocks the event-router from injecting [Browser update]
  // messages (the router defers while the model is "speaking").
  let onIdle = null;

  async function ensureCtx() {
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate });
      nextPlayTime = ctx.currentTime;
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    return ctx;
  }

  function _b64ToBytes(b64) {
    // The Live API uses standard base64; defensive replace handles the
    // url-safe variant just in case.
    const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm.length % 4 ? norm.padEnd(norm.length + (4 - (norm.length % 4)), '=') : norm;
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function enqueue(base64Pcm, mimeRate) {
    const c = await ensureCtx();
    const bytes = _b64ToBytes(base64Pcm);
    const byteLen = bytes.length - (bytes.length % 2);
    if (!byteLen) return;
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, byteLen / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const rate = Number(mimeRate) || sampleRate;
    const buffer = c.createBuffer(1, float32.length, rate);
    buffer.copyToChannel(float32, 0);

    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    activeSources.add(src);
    src.onended = () => {
      activeSources.delete(src);
      // Fire idle when the LAST source finishes. Defer one task so a
      // racing enqueue() can register before we declare the queue
      // empty (avoids spurious "speaking=false" mid-turn).
      if (activeSources.size === 0 && onIdle) {
        const cb = onIdle;
        setTimeout(() => {
          if (activeSources.size === 0) cb();
        }, 0);
      }
    };

    const startAt = Math.max(nextPlayTime, c.currentTime);
    src.start(startAt);
    nextPlayTime = startAt + buffer.duration;
  }

  function flush() {
    for (const s of activeSources) {
      try { s.stop(); } catch {}
      try { s.disconnect(); } catch {}
    }
    activeSources.clear();
    if (ctx && ctx.state !== 'closed') nextPlayTime = ctx.currentTime;
    // flush() is called on barge-in / interrupted -- the model is no
    // longer speaking even though source.onended won't fire for sources
    // we manually .stop()-ed. Notify the idle callback synchronously.
    if (onIdle) onIdle();
  }

  function close() {
    flush();
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    ctx = null;
  }

  return {
    enqueue, flush, close,
    isPlaying: () => activeSources.size > 0,
    setOnIdle: (fn) => { onIdle = fn; },
  };
}
