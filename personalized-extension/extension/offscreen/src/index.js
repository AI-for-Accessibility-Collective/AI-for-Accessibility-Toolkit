// Voice engine entry. The page is loaded by the SW via
// chrome.offscreen.createDocument(); we wire the Live client, audio I/O,
// browser-agent bridge, and a small command receiver so the side panel
// can toggle mic/background/etc.
//
// Lifecycle:
//   - Loads -> 'voiceHello' broadcast so the SW + UI know we're up.
//   - 'voiceConnect' command -> connect Live + start mic + start bridge.
//   - 'voiceDisconnect' command -> close everything.
//   - 'voiceMicToggle' command -> start/stop mic (Live stays connected).
//   - 'voiceBackgroundMode' command -> set backgroundMode flag (the SW
//     consults this when deciding whether to keep us alive after the
//     panel closes).
//
// We deliberately do NOT auto-connect on page load. The SW spawns this
// page eagerly so the audio APIs are warm, but we wait for the user to
// click "Voice" in the UI before opening a (paid) Live session.

import { createLiveClient } from './live/client.js';
import { createMicCapture } from './live/audio-input.js';
import { createAudioPlayer } from './live/audio-output.js';
import { dispatchToolCall, describeAction, resetSessionState, undoLastFromUi } from './live/tools.js';
import { buildSystemInstruction } from './live/prompt.js';
import { createAgentBridge } from './bridge/agent-bridge.js';
import { createEventRouter } from './bridge/event-router.js';
import * as voiceState from './state.js';
import * as storage from './storage.js';
import { clearHandle, hasPersistedHandle } from './live/session.js';

// Bound the wait for setupComplete after the WS handshake succeeds. If
// the server doesn't respond within this window the request is hung;
// fail loudly instead of leaving the UI stuck at "Connecting…".
const SETUP_TIMEOUT_MS = 15000;

// ---- shared singletons -------------------------------------------------

let live = null;
let setupTimer = null;
// Guards against two connect() calls racing (a second panel clicking Start, or
// the goAway reconnect timer firing while a manual restart is mid-flight) and
// opening two concurrent, billed Live sessions with one WebSocket orphaned.
let connecting = false;
let goAwayTimer = null;

// Wall-clock of the last audio chunk we received from the model.
// Combined with player.isPlaying() this gives a robust "is the model
// audibly speaking right now" signal:
//
//   playing  -- definitely speaking, queue draining
//   recent   -- chunks arrived <SPEAKING_GRACE_MS ago, likely mid-turn
//   neither  -- model is silent, router can inject events
//
// The Live API's turnComplete event turned out to be unreliable as a
// "model is done" signal: the server holds the turn open during tool-
// call processing even when the model has stopped producing audio,
// stretching turnInProgress to 25-30+ seconds and force-flushing only
// at MAX_DEFER. The audio-queue + recency signals reflect what the
// user actually hears, which is what matters for "don't talk over the
// model".
let lastAudioChunkAt = 0;
const SPEAKING_GRACE_MS = 1500;

const player = createAudioPlayer({ sampleRate: 24000 });
// When the last queued chunk finishes playing, the model is no longer
// "speaking" -- flip the flag so the event-router will inject pending
// [Browser update] messages.
player.setOnIdle(() => {
  console.log('[voice] player idle (was speaking=', voiceState.get().speaking, ')');
  if (voiceState.get().speaking) {
    voiceState.setSpeaking(false);
  }
});

const mic = createMicCapture({
  onAudio: (buf) => live?.sendAudioChunk(buf),
  onSpeechStart: () => {
    voiceState.setMicActivity(true);
    // Barge-in: flush model audio immediately so we don't talk over the
    // user. Server-side VAD will detect them; we don't manually send
    // activity_start under default config.
    player.flush();
    voiceState.setSpeaking(false);
  },
  onSpeechEnd: () => {
    // Hysteresis-debounced ~500ms after the last audible sample. The
    // side-panel UI hides its "Listening..." placeholder on this flip
    // and waits for the actual server transcript (which arrives once
    // server-side VAD also detects end-of-speech).
    voiceState.setMicActivity(false);
  },
});

const router = createEventRouter({
  sendTextTurn: (text, opts) => live?.sendTextTurn(text, opts),
  isUserSpeaking: () => voiceState.get().micActivity,
  isModelSpeaking: () => {
    // Audio actively playing -> the user IS hearing the model now.
    if (player.isPlaying()) return true;
    // Queue is empty but a chunk arrived recently -> the model is
    // probably between segments of one turn, hold the injection
    // briefly to avoid stepping on the next bit. The grace is short
    // enough that genuine post-turn silence flushes promptly.
    return (Date.now() - lastAudioChunkAt) < SPEAKING_GRACE_MS;
  },
  // Each major bridge event -> one transcript bubble with expandable
  // details. The agent's spoken narration of that event lands as a
  // separate "agent" bubble immediately after.
  onMajorBubble: (entry) => voiceState.appendEvent(entry),
});

const bridge = createAgentBridge({
  onEvent: (e) => {
    router.ingest(e);
    // Status flips that imply task completion/failure should flush
    // immediately so the user hears the final word without delay.
    if (e.kind === 'status' && (e.status === 'done' || e.status === 'error' || e.status === 'stopped')) {
      router.flushNow();
    }
  },
});

// ---- session context (system-instruction grounding) --------------------

function _sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp || null);
      });
    } catch { resolve(null); }
  });
}

function _withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

// Ground the session in real state (current tab, active settings, profile,
// pending-proposal count). Every fetch is bounded and optional — a slow or
// failed source just drops its section rather than delaying the connect.
async function fetchSessionContext() {
  const [context, memory] = await Promise.all([
    _withTimeout(_sendMessage({ type: 'voiceGetContext' }), 1500),
    _withTimeout(_sendMessage({ type: 'voiceGetMemory' }), 1500),
  ]);
  const ctx = {};
  if (context && !context.error) {
    ctx.tab = context.tab || null;
    ctx.activeSettings = context.activeSettings || null;
    if (typeof context.zoomPercent === 'number') ctx.zoomPercent = context.zoomPercent;
  }
  if (memory && !memory.error) {
    const lines = [];
    if (memory.profile?.supportAreas?.length) lines.push(`support areas: ${memory.profile.supportAreas.join(', ')}`);
    if (memory.profile?.notes) lines.push(memory.profile.notes);
    if (lines.length) ctx.profileLines = lines;
    if (Array.isArray(memory.pendingProposals)) ctx.pendingProposals = memory.pendingProposals.length;
  }
  return ctx;
}

// ---- connect / disconnect ---------------------------------------------

async function connect() {
  // isOpen() is false for the whole connect window (WS handshake + the
  // session-context fetch), so guard with an explicit in-flight flag too.
  if (connecting || (live && live.isOpen())) return;
  connecting = true;
  try {
    await _connectInner();
  } finally {
    connecting = false;
  }
}

async function _connectInner() {
  voiceState.setConnection('connecting');
  voiceState.setError(null);

  const apiKey = await _getApiKey();
  if (!apiKey) {
    voiceState.setConnection('error');
    voiceState.setError('Gemini API key not set. Open the popup → AI keys to add one.');
    return;
  }
  const model = await _getModel();
  // A brand-new conversation (no resumption handle) must not inherit the
  // previous session's undo stack or seen-id gates. Await the journal reset so
  // it's ordered before the new session can issue its first change.
  if (!(await hasPersistedHandle())) await resetSessionState();
  let systemInstruction = null;
  try { systemInstruction = buildSystemInstruction(await fetchSessionContext()); } catch {}

  // If setupComplete doesn't arrive, mark error rather than hang.
  if (setupTimer) clearTimeout(setupTimer);
  setupTimer = setTimeout(() => {
    setupTimer = null;
    if (voiceState.get().connection === 'connecting') {
      voiceState.setConnection('error');
      voiceState.setError('Connection timed out before setup completed. Check API key and network, then try again.');
      try { live?.close(); } catch {}
      live = null;
    }
  }, SETUP_TIMEOUT_MS);

  live = createLiveClient({
    apiKey,
    model,
    systemInstruction,
    onAudio: (b64, rate) => {
      if (Date.now() - lastAudioChunkAt > SPEAKING_GRACE_MS) {
        console.log('[voice] turn START');
      }
      lastAudioChunkAt = Date.now();
      voiceState.setSpeaking(true);
      player.enqueue(b64, rate).catch((err) => {
        console.warn('[voice] enqueue failed', err);
      });
    },
    onInterrupted: () => {
      console.log('[voice] turn INTERRUPTED');
      // Server says the user barged in. Drop pending audio so the
      // router can immediately inject any queued events.
      player.flush();
      voiceState.setSpeaking(false);
    },
    onTurnComplete: () => {
      console.log('[voice] turn COMPLETE');
      // Server is done generating this turn. The audio queue might
      // still be playing locally; the speaking flag flips false via
      // player.setOnIdle when the queue drains. We do NOT use this
      // event to gate router flushing -- the queue + recency check
      // above is more reliable (turnComplete is delayed during tool-
      // call processing even though audio has long since stopped).
      if (!player.isPlaying()) voiceState.setSpeaking(false);
    },
    onInputTranscript: (t) => {
      // Diagnostic: lets us see if Gemini Live ever emits multiple
      // partial chunks for input. In practice it sends the full
      // utterance once after server-side VAD detects end-of-speech,
      // which is why the side panel needs a "Listening..." placeholder
      // driven off mic RMS rather than relying on streaming
      // transcription for live feedback.
      console.log('[voice] input transcript chunk:', JSON.stringify({ text: t.text || '', finished: !!t.finished }).slice(0, 200));
      voiceState.appendTranscript({ role: 'user', text: t.text || '', finished: t.finished });
    },
    onOutputTranscript: (t) => {
      voiceState.appendTranscript({ role: 'agent', text: t.text || '', finished: t.finished });
    },
    onToolCall: async (fc, signal) => {
      const result = await dispatchToolCall(fc.name, fc.args || {}, signal);
      // State-changing tools get a confirmation chip in the panel transcript
      // (describeAction returns null for read-only ones).
      try {
        const chip = describeAction(fc.name, fc.args || {}, result);
        if (chip) voiceState.appendAction({ tool: fc.name, text: chip.summary, ok: chip.ok, undoable: chip.undoable });
      } catch {}
      return result;
    },
    onToolCallCancellation: () => {
      // No long-running tools today; nothing to undo.
    },
    onGoAway: ({ timeLeft }) => {
      console.log('[voice] goAway, time_left=', timeLeft);
      // Reconnect with cached resumption handle. Simple immediate retry;
      // the server gives ~60s notice so we don't need to delay.
      voiceState.setConnection('connecting');
      try { live?.close(); } catch {}
      live = null;
      // Brief pause so the server-side close completes before reconnect.
      // Tracked so disconnect()/restart() can cancel a pending reconnect and
      // not race a fresh session.
      if (goAwayTimer) clearTimeout(goAwayTimer);
      goAwayTimer = setTimeout(() => {
        goAwayTimer = null;
        connect().catch((e) => {
          voiceState.setConnection('error');
          voiceState.setError(`reconnect failed: ${e.message || e}`);
        });
      }, 250);
    },
    onSetupComplete: () => {
      if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
      voiceState.setConnection('live');
      bridge.start();
      mic.start().catch((err) => {
        voiceState.setError(`mic: ${err.message || err}`);
      });
      voiceState.setRecording(true);
    },
    onError: (msg) => {
      // Any WS-level close (whether 1xxx transport, 4xxx auth, or
      // protocol-level rejection) means the connection is gone. Always
      // surface a visible error so the UI doesn't stay stuck at
      // "Connecting…". Cancel any pending setup timer.
      console.warn('[voice]', msg);
      if (!/^ws closed/.test(msg)) return;
      if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
      if (/code=4\d{3}/.test(msg)) {
        // 4xxx range = auth/policy/expired-handle. Clear the persisted
        // handle so the next connect starts a fresh session.
        clearHandle();
        const expired = /handle/i.test(msg) || /resum/i.test(msg);
        voiceState.setError(expired
          ? "Previous session couldn't resume — press Start again to begin a fresh one."
          : msg);
      } else {
        voiceState.setError(msg);
      }
      voiceState.setConnection('error');
    },
  });
  live.connect();
}

async function disconnect() {
  if (goAwayTimer) { clearTimeout(goAwayTimer); goAwayTimer = null; }
  bridge.stop();
  mic.stop();
  player.flush();
  if (live) {
    try { live.close(); } catch {}
    live = null;
  }
  voiceState.setConnection('disconnected');
  voiceState.setRecording(false);
  voiceState.setSpeaking(false);
}

// Restart: tear down the live session, drop the resumption handle and
// transcript so the user gets a genuinely fresh conversation, then
// reopen. The offscreen page itself stays alive (cheaper than full
// teardown + recreate) and the existing mic permission is reused.
async function restart() {
  if (goAwayTimer) { clearTimeout(goAwayTimer); goAwayTimer = null; }
  bridge.stop();
  mic.stop();
  player.flush();
  if (live) {
    try { live.close(); } catch {}
    live = null;
  }
  await clearHandle();
  voiceState.clearTranscript();
  // Fresh conversation: a new session must not be able to undo changes or
  // delete memories the user handled in the previous one. Await so the journal
  // reset is ordered before connect() opens the new session.
  await resetSessionState();
  voiceState.setError(null);
  voiceState.setRecording(false);
  voiceState.setSpeaking(false);
  // Reset the bridge's last-seen marker so the next bridge.start
  // doesn't replay log entries from the prior task as fresh
  // catch-up. Without this, a freshly-restarted session would hear
  // "Task done: <prior summary>" before the user even speaks.
  try { await storage.set('local', { voiceBridgeLastSeen: Date.now() }); } catch {}
  await connect();
}

// ---- helpers ----------------------------------------------------------

async function _getApiKey() {
  // Mirrors background.js's resolution: chrome.storage.sync.geminiApiKey
  // (preferred) or legacy geminiKey. Routed through the storage shim so
  // it works whether or not chrome.storage is exposed to this offscreen
  // context.
  const data = await storage.get('sync', ['geminiApiKey', 'geminiKey']);
  return data.geminiApiKey || data.geminiKey || null;
}

async function _getModel() {
  const data = await storage.get('sync', ['voiceModel']);
  return data.voiceModel || 'gemini-3.1-flash-live-preview';
}

// ---- command receiver -------------------------------------------------

// Messages this offscreen page is the authoritative handler for. The SW
// owns lifecycle messages (voiceEnsure/voiceTeardown); registering a
// catch-all default case here was racing the SW and winning with an
// "unknown voice msg" error -- both listeners receive every message and
// the first to call sendResponse wins. By explicitly whitelisting, we
// stay silent on lifecycle msgs so the SW's response is what reaches
// the caller.
const OFFSCREEN_MSG_TYPES = new Set([
  'voicePing',
  'voiceConnect',
  'voiceDisconnect',
  'voiceRestart',
  'voiceMicToggle',
  'voiceBackgroundMode',
  'voiceClearTranscript',
  'voiceTextTurn',
  'voiceUndoLast',
  'voiceDebugToolCall',
  // Captions Increment 1: audio decode+chunk for transcription pipeline.
  'captionDecodeAudio',
]);

// The panel's Undo button and the undo_last_change tool share one stack;
// this path also tells the model what happened so it can't quote stale state.
async function undoFromUi() {
  const result = await undoLastFromUi();
  try {
    const chip = describeAction('undo_last_change', {}, result);
    if (chip) voiceState.appendAction({ tool: 'undo_last_change', text: chip.summary, ok: chip.ok, undoable: false });
  } catch {}
  if (live && live.isOpen() && result && !result.error) {
    const what = Object.entries(result.reverted || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    if (voiceState.get().speaking) { player.flush(); voiceState.setSpeaking(false); }
    live.sendTextTurn(`[UI update] The user pressed Undo: settings reverted to ${what}. Acknowledge in one short sentence.`);
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (!OFFSCREEN_MSG_TYPES.has(msg.type)) return;

  (async () => {
    try {
      switch (msg.type) {
        case 'voicePing':
          sendResponse({ ok: true, state: voiceState.get() });
          break;
        case 'voiceConnect':
          await connect();
          sendResponse({ ok: true });
          break;
        case 'voiceDisconnect':
          await disconnect();
          sendResponse({ ok: true });
          break;
        case 'voiceRestart':
          await restart();
          sendResponse({ ok: true });
          break;
        case 'voiceMicToggle':
          if (mic.isRunning()) {
            mic.stop();
            voiceState.setRecording(false);
          } else {
            await mic.start();
            voiceState.setRecording(true);
          }
          sendResponse({ ok: true, recording: mic.isRunning() });
          break;
        case 'voiceBackgroundMode':
          voiceState.setBackgroundMode(!!msg.enabled);
          // Persist preference for SW lifecycle decisions.
          await storage.set('local', { voiceBackgroundMode: !!msg.enabled });
          sendResponse({ ok: true });
          break;
        case 'voiceClearTranscript':
          voiceState.clearTranscript();
          sendResponse({ ok: true });
          break;
        case 'voiceTextTurn': {
          // Typed input from the side panel — an accessibility path for users
          // who can't (or don't want to) speak, and a deterministic driver
          // for tests. Same barge-in semantics as spoken input.
          const text = (msg.text || '').trim();
          if (!text) { sendResponse({ error: 'empty message' }); break; }
          if (!live || !live.isOpen()) { sendResponse({ error: 'not connected' }); break; }
          voiceState.appendTranscript({ role: 'user', text, finished: true });
          if (voiceState.get().speaking) {
            player.flush();
            voiceState.setSpeaking(false);
          }
          live.sendTextTurn(text);
          sendResponse({ ok: true });
          break;
        }
        case 'voiceUndoLast':
          sendResponse({ ok: true, result: await undoFromUi() });
          break;
        case 'voiceDebugToolCall': {
          // Prototype-scoped test hook: run a tool exactly as the model
          // would (dispatch + action chip), without a paid Live session.
          const result = await dispatchToolCall(msg.name, msg.args || {});
          try {
            const chip = describeAction(msg.name, msg.args || {}, result);
            if (chip) voiceState.appendAction({ tool: msg.name, text: chip.summary, ok: chip.ok, undoable: chip.undoable });
          } catch {}
          sendResponse({ ok: true, result });
          break;
        }
        case 'captionDecodeAudio': {
          // Captions Increment 1 — audio decode + chunk.
          // The background sends an ArrayBuffer (via structured clone) of the
          // raw media bytes. We decode with AudioContext.decodeAudioData, slice
          // into ~15s PCM chunks, re-encode each as a WAV base64 string, and
          // return [{startSec, endSec, wavBase64}].
          //
          // Why offscreen (not content script): host_permissions fetch + AudioContext
          // decode in one place, no CORS constraints from the page origin.
          try {
            const buffer = msg.buffer;
            if (!buffer || !(buffer instanceof ArrayBuffer)) {
              sendResponse({ error: 'captionDecodeAudio: no buffer provided' });
              break;
            }
            const CHUNK_DURATION_S = 15;
            // Use the existing AudioContext from the voice audio pipeline if
            // available (avoids creating a duplicate context), or create a
            // temporary one. Either way we just need decodeAudioData.
            const ctx = new AudioContext();
            let decoded;
            try {
              decoded = await ctx.decodeAudioData(buffer.slice(0)); // slice to detach safely
            } finally {
              ctx.close().catch(() => {});
            }
            const { sampleRate, duration, numberOfChannels } = decoded;
            const chunkSamples = Math.ceil(CHUNK_DURATION_S * sampleRate);
            const totalSamples = decoded.length;
            const chunks = [];
            for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
              const chunkLen = Math.min(chunkSamples, totalSamples - offset);
              const startSec = offset / sampleRate;
              const endSec = Math.min(startSec + CHUNK_DURATION_S, duration);
              // Encode chunk as 16-bit PCM WAV (mono — mix down if stereo to
              // reduce payload size; Gemini handles mono WAV fine).
              const numChannelsOut = 1;
              const pcm = new Float32Array(chunkLen);
              // Mix down all channels to mono.
              for (let ch = 0; ch < numberOfChannels; ch++) {
                const channelData = decoded.getChannelData(ch);
                for (let i = 0; i < chunkLen; i++) {
                  pcm[i] += channelData[offset + i] / numberOfChannels;
                }
              }
              // Build WAV header + 16-bit PCM samples.
              const bitsPerSample = 16;
              const byteRate = sampleRate * numChannelsOut * bitsPerSample / 8;
              const blockAlign = numChannelsOut * bitsPerSample / 8;
              const dataSize = chunkLen * blockAlign;
              const wavBuffer = new ArrayBuffer(44 + dataSize);
              const view = new DataView(wavBuffer);
              function writeStr(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
              writeStr(0, 'RIFF');
              view.setUint32(4, 36 + dataSize, true);
              writeStr(8, 'WAVE');
              writeStr(12, 'fmt ');
              view.setUint32(16, 16, true);
              view.setUint16(20, 1, true); // PCM
              view.setUint16(22, numChannelsOut, true);
              view.setUint32(24, sampleRate, true);
              view.setUint32(28, byteRate, true);
              view.setUint16(32, blockAlign, true);
              view.setUint16(34, bitsPerSample, true);
              writeStr(36, 'data');
              view.setUint32(40, dataSize, true);
              // Convert float32 PCM → int16.
              let off = 44;
              for (let i = 0; i < chunkLen; i++) {
                const s = Math.max(-1, Math.min(1, pcm[i]));
                view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                off += 2;
              }
              // Base64-encode for structured-clone-safe return.
              const bytes = new Uint8Array(wavBuffer);
              let bin = '';
              for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
              const wavBase64 = btoa(bin);
              chunks.push({ startSec, endSec, wavBase64 });
            }
            sendResponse({ chunks });
          } catch (e) {
            sendResponse({ error: e.message || String(e) });
          }
          break;
        }
      }
    } catch (e) {
      // Log full stack to the offscreen-page DevTools console so the
      // root cause is visible there. The side panel only gets the short
      // message + a `stack` field it can also log.
      console.error(`[voice] ${msg.type} handler threw:`, e);
      sendResponse({
        error: (e && e.message) || String(e),
        stack: e && e.stack ? String(e.stack) : null,
      });
    }
  })();
  // Indicate async response.
  return true;
});

// Announce we're alive so any UI surface waiting on us can render.
chrome.runtime.sendMessage({ type: 'voiceHello' }).catch(() => {});
