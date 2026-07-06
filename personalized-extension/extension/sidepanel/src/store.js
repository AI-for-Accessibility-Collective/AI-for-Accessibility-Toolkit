// Side-panel state store + subscription glue. Reads the offscreen-owned
// snapshot from chrome.storage on mount and keeps it warm via runtime
// broadcasts (`voiceState` and `voiceTranscript` messages from
// offscreen/src/state.js).

const STATE_KEY = 'voiceState';
const RESUME_HANDLE_KEY = 'voiceResumeHandle';

const _store = {
  connection: 'disconnected',
  recording: false,
  speaking: false,
  micActivity: false,
  backgroundMode: false,
  error: null,
  transcript: [],
  // True when chrome.storage holds a session-resumption handle from a
  // prior offscreen instance. Drives the "Resume" vs "Start" button
  // label so the user knows the conversation will pick up where it
  // left off.
  hasResumeHandle: false,
};

const _listeners = new Set();

export function get() { return { ..._store, transcript: _store.transcript.slice() }; }

export function subscribe(fn) {
  _listeners.add(fn);
  // Fire once with current state so the caller doesn't have to render
  // empty then wait for the first event.
  try { fn(get()); } catch {}
  return () => _listeners.delete(fn);
}

function _emit() {
  const snap = get();
  for (const fn of _listeners) {
    try { fn(snap); } catch {}
  }
}

// --- snapshot from storage ---------------------------------------------
export async function hydrate() {
  const data = await chrome.storage.local.get([STATE_KEY, RESUME_HANDLE_KEY]);
  const s = data[STATE_KEY];
  _store.hasResumeHandle = !!data[RESUME_HANDLE_KEY];
  if (s) {
    _store.connection = s.connection || 'disconnected';
    _store.recording = !!s.recording;
    _store.speaking = !!s.speaking;
    _store.backgroundMode = !!s.backgroundMode;
    _store.error = s.error || null;
    _store.transcript = Array.isArray(s.transcript) ? s.transcript.slice() : [];
  }
  _emit();
}

// --- runtime broadcasts ------------------------------------------------
export function installListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'voiceState' && msg.state) {
      Object.assign(_store, msg.state);
      _emit();
      return;
    }
    if (msg.type === 'voiceTranscript' && msg.delta) {
      _appendTranscript(msg.delta);
      _emit();
      return;
    }
  });
  // Storage changes are how we learn the resume handle was written by
  // the offscreen page in another window's runtime, and how we catch
  // voiceState writes that happen outside the runtime-broadcast path
  // (e.g. the side panel itself writing a client-side error).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (RESUME_HANDLE_KEY in changes) {
      _store.hasResumeHandle = !!changes[RESUME_HANDLE_KEY].newValue;
      _emit();
    }
    if (STATE_KEY in changes) {
      const s = changes[STATE_KEY].newValue;
      if (s) {
        // The offscreen broadcasts every state change over runtime AND writes
        // it to storage, so this onChanged is usually an echo of a delta the
        // runtime path already applied. Apply the fields (cheap) but only
        // re-render when something the UI shows actually differs — otherwise a
        // speaking/partial-transcript flurry would double every render.
        const differs =
          s.connection !== _store.connection || !!s.recording !== _store.recording ||
          !!s.speaking !== _store.speaking || !!s.backgroundMode !== _store.backgroundMode ||
          (s.error || null) !== _store.error ||
          (Array.isArray(s.transcript) && _transcriptDiffers(s.transcript, _store.transcript));
        _store.connection = s.connection || 'disconnected';
        _store.recording = !!s.recording;
        _store.speaking = !!s.speaking;
        _store.backgroundMode = !!s.backgroundMode;
        _store.error = s.error || null;
        if (Array.isArray(s.transcript)) _store.transcript = s.transcript.slice();
        if (differs) _emit();
      }
    }
  });
}

// Cheap transcript equality: same length and same last-entry identity/content.
// Enough to catch the storage echo of a delta the runtime path already applied.
function _transcriptDiffers(a, b) {
  if (a.length !== b.length) return true;
  if (!a.length) return false;
  const x = a[a.length - 1], y = b[b.length - 1];
  return x.ts !== y.ts || x.text !== y.text || x.role !== y.role;
}

function _appendTranscript({ role, text, finished, details, ts, tool, ok, undoable, actionId }) {
  // Event bubbles never stream and never collapse onto each other --
  // each is its own row with a `details` array that the UI exposes via
  // an expand toggle.
  if (role === 'event') {
    _store.transcript.push({
      role, text, details: Array.isArray(details) ? details : [], ts: ts || Date.now(),
    });
    return;
  }
  // Action chips (tool-call confirmations) are complete rows too — never
  // streamed, never collapsed.
  if (role === 'action') {
    _store.transcript.push({
      role, text, tool: tool || null, ok: ok !== false, undoable: !!undoable,
      actionId: actionId || null, ts: ts || Date.now(),
    });
    return;
  }
  const last = _store.transcript[_store.transcript.length - 1];
  if (last && last.role === role && last.partial) {
    // Same robustness as the offscreen state: handle delta + cumulative.
    if (text.startsWith(last.text) && text.length >= last.text.length) {
      last.text = text;
    } else {
      last.text += text;
    }
    if (finished) last.partial = false;
  } else {
    _store.transcript.push({ role, text, ts: ts || Date.now(), partial: !finished });
  }
}
