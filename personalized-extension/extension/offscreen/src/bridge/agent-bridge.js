// Subscribe to chrome.storage.local.bhAgent and emit a clean stream of
// "interesting" events. Mirrors what a human watching the popup's agent
// log would notice: status flips (idle → running → done/error), tool
// calls (navigate / click / type / etc.), and significant info entries.
//
// chrome.storage.onChanged fires with every persisted-state write -- the
// agent writes after every step, log append, and patch. Many of those
// writes are duplicates from the bridge's perspective (only `log` grew by
// one entry); we diff against the previous snapshot and only emit deltas.
//
// We persist the timestamp of the last log entry we emitted to storage so
// that when the offscreen page is torn down and re-created (e.g. user
// closed the side panel without background mode), the next start() can
// emit a catch-up batch for whatever happened in between.

import * as storage from '../storage.js';

// Only `action` log entries are surfaced. The agent writes
// kind='done' / kind='error' log entries that always pair with a
// status flip (status='done' / 'error') -- emitting both produced
// duplicate bubbles + duplicate model injections at task end.
// Status flips are the canonical "task lifecycle" signal.
const NOTABLE_LOG_KINDS = new Set(['action']);

// Some action tool names are too noisy on their own (waitForLoad,
// waitForElement, etc.) -- skip narration for those. Add to this set if
// the voice agent starts saying "waiting for the page to load" repeatedly.
const NOISY_ACTIONS = new Set([
  'wait', 'wait_for_element', 'wait_for_network_idle',
  'browser_screenshot', 'browser_read_page', 'browser_list_tabs',
]);

// "Major" events get their own transcript bubble + their own model
// turn -- the kind of progress milestones a human would want to hear
// about. Everything else is "minor": rolled into the bubble's details
// and provided as context to the model when it narrates the next major
// event.
//
// We deliberately exclude action='done' from MAJOR_ACTIONS: the agent
// writes the action='done' log entry just before flipping
// status='done', and treating both as major produced multiple bubbles
// for the same task end (action bubble, status bubble, plus a third
// Progress bubble synthesized from the trailing kind='done' log entry
// during flushNow). Status flips remain the canonical end-of-task
// signal.
const MAJOR_ACTIONS = new Set([
  'navigate', 'go_back', 'go_forward', 'refresh',
  'open_tab', 'switch_tab', 'close_tab',
]);
function _isMajor(event) {
  if (event.kind === 'status') return true; // start/done/error/stopped
  if (event.kind === 'log') {
    if (event.logKind === 'action' && MAJOR_ACTIONS.has(event.action)) return true;
  }
  return false;
}

// (Transient-error filter is no longer needed here: kind='error' log
// entries don't pass the NOTABLE_LOG_KINDS check above. Terminal
// errors are signaled via status='error' instead.)

const LAST_SEEN_KEY = 'voiceBridgeLastSeen';
// Don't replay events older than this on reconnect -- a 2-hour-old action
// isn't useful catch-up and would mislead the model. Empirical cap.
const CATCHUP_MAX_AGE_MS = 60 * 60 * 1000;
// Cap how many backlog entries we replay so the catch-up turn doesn't
// balloon. Most-recent first; older ones are dropped.
const CATCHUP_MAX_ENTRIES = 8;
const WRITE_DEBOUNCE_MS = 500;

export function createAgentBridge({ onEvent }) {
  let lastSnapshot = null;
  let installed = false;
  let lastEmittedT = 0;
  let writeTimer = null;
  let unsubscribe = null;

  function _persistLastSeen(t) {
    if (!t) return;
    lastEmittedT = Math.max(lastEmittedT, t);
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      storage.set('local', { [LAST_SEEN_KEY]: lastEmittedT });
    }, WRITE_DEBOUNCE_MS);
  }

  function _emit(evt) {
    // Tag each event so the router can decide whether to surface it as
    // its own bubble (major) or fold it into the next major one (minor).
    const major = _isMajor(evt);
    console.log('[voice] bridge emit:', evt.kind, evt.logKind || evt.status || '', evt.action || '', '(major=' + major + ')');
    onEvent({ ...evt, major });
  }

  function _listener(changes, area) {
    if (area !== 'local' || !changes.bhAgent) return;
    console.log('[voice] bridge sees bhAgent change');
    const next = changes.bhAgent.newValue || null;
    const prev = lastSnapshot;
    lastSnapshot = next;
    if (!next) return;
    _diff(prev, next);
  }

  function _diff(prev, next) {
    if (!prev || prev.status !== next.status) {
      _emit({
        kind: 'status',
        prev: prev ? prev.status : null,
        status: next.status,
        task: next.task,
        summary: next.summary || null,
        error: next.error || null,
        // Status flips don't have a stored timestamp -- use now.
        // This is the real "when it happened" since the storage
        // change just fired, modulo a few ms of relay latency.
        ts: Date.now(),
      });
    }

    const prevLog = (prev && prev.log) || [];
    const nextLog = next.log || [];
    if (!nextLog.length) return;

    // Anchor by timestamp -- the log is capped at 200 entries so indices
    // can shift; timestamps are stable.
    const anchorT = prevLog.length ? prevLog[prevLog.length - 1].t : lastEmittedT;
    let i = nextLog.length - 1;
    while (i >= 0 && nextLog[i].t > anchorT) i--;
    const newEntries = nextLog.slice(i + 1);

    for (const e of newEntries) {
      _maybeEmitLog(e);
    }
  }

  function _maybeEmitLog(e) {
    if (!NOTABLE_LOG_KINDS.has(e.kind)) return;
    if (e.kind === 'action' && NOISY_ACTIONS.has(e.action)) return;
    // Pass the log entry's original timestamp through so the bubble
    // shows when the action actually happened, not when we got
    // around to flushing the queue.
    _emit({ kind: 'log', logKind: e.kind, action: e.action, text: e.text, ts: e.t });
    _persistLastSeen(e.t || Date.now());
  }

  async function _replayCatchUp(cur) {
    // Read the timestamp we last persisted. If none, this is the very
    // first start -- no catch-up needed (the prime step below still
    // emits current status).
    const data = await storage.get('local', LAST_SEEN_KEY);
    const lastSeen = data[LAST_SEEN_KEY] || 0;
    lastEmittedT = lastSeen;
    if (!cur || !Array.isArray(cur.log) || !cur.log.length) return;

    const now = Date.now();
    const cutoff = Math.max(lastSeen, now - CATCHUP_MAX_AGE_MS);
    const fresh = cur.log
      .filter((e) => e && e.t > cutoff)
      .filter((e) => NOTABLE_LOG_KINDS.has(e.kind))
      .filter((e) => !(e.kind === 'action' && NOISY_ACTIONS.has(e.action)));
    if (!fresh.length) return;

    // Keep the most-recent slice; older backlog gets dropped.
    const slice = fresh.slice(-CATCHUP_MAX_ENTRIES);
    for (const e of slice) {
      _emit({ kind: 'log', logKind: e.kind, action: e.action, text: e.text, ts: e.t, catchup: true });
    }
    _persistLastSeen(slice[slice.length - 1].t || now);
  }

  async function start() {
    if (installed) return;
    unsubscribe = storage.onChanged(_listener);
    installed = true;
    // Prime: read current state, replay anything we missed since the
    // last time the bridge ran, emit current status. We only narrate
    // the current state if a task is *actively running* -- emitting
    // 'done' / 'error' / 'stopped' on prime would make the voice model
    // react to the previous session's terminal state as if it just
    // happened.
    try {
      const data = await storage.get('local', 'bhAgent');
      const cur = data.bhAgent || null;
      lastSnapshot = cur;
      await _replayCatchUp(cur);
      if (cur && cur.status === 'running') {
        _emit({ kind: 'status', status: cur.status, task: cur.task });
      }
    } catch (e) {
      console.warn('[bridge] prime failed', e);
    }
  }

  function stop() {
    if (!installed) return;
    if (typeof unsubscribe === 'function') {
      try { unsubscribe(); } catch {}
      unsubscribe = null;
    }
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    installed = false;
    lastSnapshot = null;
  }

  return { start, stop };
}
