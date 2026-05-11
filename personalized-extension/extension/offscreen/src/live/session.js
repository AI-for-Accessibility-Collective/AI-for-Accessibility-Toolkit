// Session-resumption handle cache. The Live API emits a
// session_resumption_update message with a `new_handle` token periodically
// during a session. When the server later sends `go_away` (or the WS
// drops), we reconnect with that handle to restore context.
//
// We persist the handle to local storage so it survives the offscreen-
// page teardown that happens when the side panel closes with background
// mode off. Without persistence, every panel-reopen starts a brand-new
// server-side conversation -- defeating "can I resume the chat?"
//
// Writes are debounced (~1s): handle updates fire on most server
// messages during active conversation, but we only need the most-recent
// value.

import * as storage from '../storage.js';

const STORAGE_KEY = 'voiceResumeHandle';
const WRITE_DEBOUNCE_MS = 1000;

let _handle = null;
let _writeTimer = null;

// Sync in-memory cache from storage. Call once before constructing the
// setup message so the persisted handle (if any) makes it into the
// sessionResumption block. Returns the current handle for convenience.
export async function loadHandle() {
  const data = await storage.get('local', STORAGE_KEY);
  _handle = data[STORAGE_KEY] || null;
  return _handle;
}

export function getHandle() { return _handle; }

// Whether a handle exists right now without forcing a fresh read.
// Used by the UI ("Start" vs "Resume" button label).
export async function hasPersistedHandle() {
  const data = await storage.get('local', STORAGE_KEY);
  return !!data[STORAGE_KEY];
}

export function consumeUpdate(update) {
  if (!update) return;
  // resumable=false means the server's holding state we can't pick up
  // from later (mid-generation, mid-tool-call). Skip those.
  if (update.resumable && update.newHandle) {
    _handle = update.newHandle;
    _scheduleWrite(_handle);
  }
}

export async function clearHandle() {
  _handle = null;
  if (_writeTimer) { clearTimeout(_writeTimer); _writeTimer = null; }
  await storage.remove('local', STORAGE_KEY);
}

function _scheduleWrite(value) {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    storage.set('local', { [STORAGE_KEY]: value });
  }, WRITE_DEBOUNCE_MS);
}
