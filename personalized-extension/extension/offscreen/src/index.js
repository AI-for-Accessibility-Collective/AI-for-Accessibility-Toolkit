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
import { dispatchToolCall } from './live/tools.js';
import { createAgentBridge } from './bridge/agent-bridge.js';
import { createEventRouter } from './bridge/event-router.js';
import * as voiceState from './state.js';
import * as storage from './storage.js';
import { clearHandle } from './live/session.js';

// Bound the wait for setupComplete after the WS handshake succeeds. If
// the server doesn't respond within this window the request is hung;
// fail loudly instead of leaving the UI stuck at "Connecting…".
const SETUP_TIMEOUT_MS = 15000;

// ---- shared singletons -------------------------------------------------

let live = null;
let setupTimer = null;

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

// ---- connect / disconnect ---------------------------------------------

async function connect() {
  if (live && live.isOpen()) return;
  voiceState.setConnection('connecting');
  voiceState.setError(null);

  const apiKey = await _getApiKey();
  if (!apiKey) {
    voiceState.setConnection('error');
    voiceState.setError('Gemini API key not set. Open the popup → AI keys to add one.');
    return;
  }
  const model = await _getModel();

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
    onToolCall: async (fc) => {
      return await dispatchToolCall(fc.name, fc.args || {});
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
      setTimeout(() => connect().catch((e) => {
        voiceState.setConnection('error');
        voiceState.setError(`reconnect failed: ${e.message || e}`);
      }), 250);
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
  bridge.stop();
  mic.stop();
  player.flush();
  if (live) {
    try { live.close(); } catch {}
    live = null;
  }
  await clearHandle();
  voiceState.clearTranscript();
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
]);

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
