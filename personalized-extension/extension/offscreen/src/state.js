// Owns the state the side-panel UI needs to render: connection status,
// transcript (user + agent text from input/output transcription), and a
// terse "browser-agent status" mirror. State changes are broadcast via
// chrome.runtime.sendMessage so any open UI surface (sidepanel, popup,
// future widget) can subscribe -- and chrome.storage.local persists the
// transcript so the panel can show history after reopen.
//
// Why both broadcast and storage:
//   - chrome.runtime.sendMessage is fire-and-forget; if no UI is open
//     the message is dropped. Good for live deltas.
//   - chrome.storage.local survives panel close; the panel reads the
//     latest snapshot on open, then subscribes to deltas.

import * as storage from './storage.js';

const STATE_KEY = 'voiceState';
const TRANSCRIPT_LIMIT = 200;

const _state = {
  connection: 'disconnected', // 'disconnected' | 'connecting' | 'live' | 'error'
  recording: false,
  speaking: false,            // model audio playing
  micActivity: false,         // user speech detected by RMS
  transcript: [],             // [{role:'user'|'agent', text, ts, partial?}]
  backgroundMode: false,      // user toggle: keep voice alive while panel closed
  error: null,
};

let _subscribers = new Set();

function _writeStorage(payload) {
  // All storage routes through ./storage.js so the SW-proxy fallback
  // kicks in when chrome.storage is missing in this offscreen context.
  // Fire-and-forget: the live UI uses the runtime broadcast below;
  // storage is only for late-subscriber hydration.
  storage.set('local', payload);
}

function _broadcastState() {
  try {
    chrome.runtime.sendMessage({
      type: 'voiceState',
      state: {
        connection: _state.connection,
        recording: _state.recording,
        speaking: _state.speaking,
        micActivity: _state.micActivity,
        backgroundMode: _state.backgroundMode,
        error: _state.error,
      },
    }).catch(() => {});
  } catch {}
}

function _persist() {
  // Broadcast lightweight state (no full transcript list every time)
  // for live UI. Snapshot to storage so a late-subscribing UI surface
  // can hydrate after reopen.
  _broadcastState();
  _writeStorage({
    [STATE_KEY]: {
      connection: _state.connection,
      recording: _state.recording,
      speaking: _state.speaking,
      backgroundMode: _state.backgroundMode,
      error: _state.error,
      transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT),
    },
  });
}

export function get() {
  return { ..._state, transcript: _state.transcript.slice() };
}

export function setConnection(s) { _state.connection = s; _persist(); }
export function setRecording(b)  { _state.recording = !!b; _persist(); }
export function setSpeaking(b)   { _state.speaking = !!b; _persist(); }
export function setMicActivity(b){ _state.micActivity = !!b; _persist(); }
export function setBackgroundMode(b){ _state.backgroundMode = !!b; _persist(); }
export function setError(msg)    { _state.error = msg || null; _persist(); }

// Append a "browser event" entry -- this becomes its own bubble in the
// side panel, separate from the agent's spoken narration. The router
// invokes this for each major bridge event; details[] is rendered as
// an expandable section.
export function appendEvent({ summary, details, ts }) {
  const entry = {
    role: 'event',
    text: summary || '',
    details: Array.isArray(details) ? details : [],
    ts: ts || Date.now(),
  };
  _state.transcript.push(entry);
  while (_state.transcript.length > TRANSCRIPT_LIMIT) _state.transcript.shift();
  // Live deltas + storage snapshot, same pattern as appendTranscript.
  try {
    chrome.runtime.sendMessage({
      type: 'voiceTranscript',
      delta: { role: entry.role, text: entry.text, details: entry.details, finished: true, ts: entry.ts },
    }).catch(() => {});
  } catch {}
  _writeStorage({
    [STATE_KEY]: {
      connection: _state.connection,
      recording: _state.recording,
      speaking: _state.speaking,
      backgroundMode: _state.backgroundMode,
      error: _state.error,
      transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT),
    },
  });
}

// Append an "action chip" entry -- one per state-changing tool call
// (settings change, undo, task start/stop, memory edit). Rendered by the
// panel as a compact confirmation chip; the newest undoable one carries the
// Undo button while the session is live.
export function appendAction({ tool, text, ok, undoable, actionId, ts }) {
  const entry = {
    role: 'action',
    text: text || '',
    tool: tool || null,
    ok: ok !== false,
    undoable: !!undoable,
    actionId: actionId || `act-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    ts: ts || Date.now(),
  };
  _state.transcript.push(entry);
  while (_state.transcript.length > TRANSCRIPT_LIMIT) _state.transcript.shift();
  try {
    chrome.runtime.sendMessage({
      type: 'voiceTranscript',
      delta: { role: entry.role, text: entry.text, tool: entry.tool, ok: entry.ok, undoable: entry.undoable, actionId: entry.actionId, finished: true, ts: entry.ts },
    }).catch(() => {});
  } catch {}
  _writeStorage({
    [STATE_KEY]: {
      connection: _state.connection,
      recording: _state.recording,
      speaking: _state.speaking,
      backgroundMode: _state.backgroundMode,
      error: _state.error,
      transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT),
    },
  });
  return entry;
}

// Append or extend the most recent transcript entry. Live transcription
// emits multiple `finished:false` partials before a final `finished:true`
// chunk -- we replace the running buffer until finished, then snapshot.
//
// Note we only collapse onto the last entry if it's the same role AND
// still partial -- an event bubble in between resets the streaming
// continuation, so user/agent speech after an event correctly starts
// a new bubble instead of merging across the event.
//
// Robust to either streaming convention:
//   - delta chunks ("ok" then " I" then " will") -> append
//   - cumulative chunks ("ok" then "ok I" then "ok I will") -> replace
// Detected per-chunk by checking whether the new text starts with the
// existing partial; natural prose makes a false-positive vanishingly
// unlikely.
export function appendTranscript({ role, text, finished }) {
  if (!text) return;
  const last = _state.transcript[_state.transcript.length - 1];
  if (last && last.role === role && last.partial) {
    if (text.startsWith(last.text) && text.length >= last.text.length) {
      // Cumulative -- new chunk is the full text so far.
      last.text = text;
    } else {
      // Delta -- new chunk is just the new tail.
      last.text += text;
    }
    if (finished) last.partial = false;
  } else {
    _state.transcript.push({
      role, text, ts: Date.now(), partial: !finished,
    });
  }
  // Trim
  while (_state.transcript.length > TRANSCRIPT_LIMIT) _state.transcript.shift();
  // Broadcast just the delta for low-latency captioning (storage write
  // is debounced indirectly via rapid overwrites which Chrome coalesces).
  try {
    chrome.runtime.sendMessage({
      type: 'voiceTranscript',
      delta: { role, text, finished: !!finished, ts: Date.now() },
    }).catch(() => {});
  } catch {}
  _writeStorage({
    [STATE_KEY]: {
      connection: _state.connection,
      recording: _state.recording,
      speaking: _state.speaking,
      backgroundMode: _state.backgroundMode,
      error: _state.error,
      transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT),
    },
  });
}

export function clearTranscript() {
  _state.transcript = [];
  _persist();
}
