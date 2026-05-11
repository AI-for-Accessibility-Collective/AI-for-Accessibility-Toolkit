// Browser-event injection router. The bridge feeds events here; we
// decide what to do with each:
//
//   MAJOR events (task start/done/error, navigation, tool errors,
//   tab management) get one model turn each -- a separate
//   [Browser update] message that the voice agent narrates as its own
//   spoken bubble. Each major event also creates a transcript "event"
//   entry with the minor activity since the previous major event
//   visible as expandable details.
//
//   MINOR events (clicks, typing, scrolls, individual log lines)
//   accumulate in a per-major buffer; they are not narrated separately
//   but are folded into the next major event's bubble + injection so
//   the model has context.
//
// Major flushing waits for the user/model to be silent so we don't
// talk over them, but uses a tighter window than the old "coalesce
// everything in 800ms" approach -- one bubble per browser milestone
// rather than one mega-summary.

const SILENT_WAIT_MS = 400;
// Even if no MAJOR event has arrived, drain a buffer of MINOR events
// after this long. Without this, a sequence of click_index / type_index
// actions (the bulk of a typical agent run) would never produce a
// bubble or model turn -- the user just hears silence between Start
// and Done. The synthetic flush bundles recent minor activity into one
// "Progress" bubble titled by the latest action.
const MINOR_FLUSH_MS = 7000;
// Safety net for genuinely-stuck speaking signals. With the
// audio-queue + recency check in offscreen/index.js this rarely
// triggers; when it does, force-flushing is preferable to silence.
// Set well above a normal model turn (5-12s) so we don't interrupt
// real speech, but well below the 30s the user observed previously.
const MAX_DEFER_MS = 12000;

export function createEventRouter({
  sendTextTurn,
  isUserSpeaking,
  isModelSpeaking,
  onMajorBubble, // ({summary, details, ts}) -- transcript event entry
}) {
  // Pending minor events since the last major. Each item is the raw
  // bridge event so the UI's details view can render structured rows.
  let minorBuffer = [];
  // Queue of pending major events waiting for a quiet moment to inject.
  // Most of the time this stays at length 0-1.
  let pendingMajor = [];
  let flushTimer = null;
  let minorFlushTimer = null;

  function ingest(event) {
    if (!event) return;
    console.log('[voice] router ingest:', event.kind, event.logKind || event.status || '', event.action || '', '(major=' + !!event.major + ')');
    if (event.major) {
      pendingMajor.push({
        event,
        minors: minorBuffer.slice(),
        queuedAt: Date.now(),
      });
      minorBuffer = [];
      // A real major arrived -- cancel any pending minor-flush since
      // we're about to emit anyway.
      if (minorFlushTimer) { clearTimeout(minorFlushTimer); minorFlushTimer = null; }
      _scheduleFlush();
      return;
    }
    // Minor: buffer + arm a timer to surface progress if no major
    // arrives soon. Reset the timer on each new minor event so the
    // most-recent activity titles the synthetic "Progress" bubble.
    minorBuffer.push(event);
    if (minorFlushTimer) clearTimeout(minorFlushTimer);
    minorFlushTimer = setTimeout(_synthesizeProgress, MINOR_FLUSH_MS);
  }

  function _synthesizeProgress() {
    minorFlushTimer = null;
    if (!minorBuffer.length) return;
    // Synthesize a major-shaped event from the buffer so _emitOne can
    // treat it uniformly. The phrasing pulls the last minor's text as
    // the bubble title -- usually the most recent click/type the agent
    // performed, which is what the user wants to hear about.
    const last = minorBuffer[minorBuffer.length - 1];
    const synthetic = {
      kind: 'progress',
      text: _phraseProgress(minorBuffer),
      ts: (last && last.ts) || Date.now(),
      _lastAction: last && last.action,
    };
    pendingMajor.push({
      event: synthetic,
      minors: minorBuffer.slice(),
      queuedAt: Date.now(),
    });
    minorBuffer = [];
    _scheduleFlush();
  }

  function flushNow() {
    // Force-flush any queued major events regardless of speech state
    // (caller signals the bubble should appear immediately, e.g. on
    // task done/error where the user explicitly wants the result).
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (minorFlushTimer) { clearTimeout(minorFlushTimer); minorFlushTimer = null; }
    // Also drain any minor-only buffer so trailing activity isn't lost.
    if (minorBuffer.length) {
      _synthesizeProgress();
    }
    while (pendingMajor.length) _emitOne(pendingMajor.shift());
  }

  function _scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
  }

  function _tryFlush() {
    flushTimer = null;
    if (!pendingMajor.length) return;
    // Force-flush events that have been queued too long. Bubbles +
    // narration getting batched at task end (because a stuck speaking
    // flag deferred everything) is worse UX than the model briefly
    // stepping on its own sentence.
    const head = pendingMajor[0];
    const overBudget = head && head.queuedAt && (Date.now() - head.queuedAt) > MAX_DEFER_MS;
    if (!overBudget) {
      // If user is speaking, wait -- never inject mid-speech.
      if (isUserSpeaking?.()) {
        flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
        return;
      }
      // If model is speaking, also defer briefly to avoid stepping on
      // its current sentence; this also gives multiple major events
      // arriving in quick succession a chance to share one model turn.
      if (isModelSpeaking?.()) {
        flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
        return;
      }
    } else {
      console.log(`[voice] router force-flush ${pendingMajor.length} events (over ${MAX_DEFER_MS}ms defer budget)`);
    }
    // Drain queue; emit one major at a time so each gets its own
    // model turn and its own bubble. The model's spoken output for
    // each appears as a separate transcript entry.
    while (pendingMajor.length) _emitOne(pendingMajor.shift());
  }

  function _emitOne({ event, minors }) {
    const summary = event.kind === 'progress' ? event.text : _phraseMajor(event);
    if (!summary) return;
    // Use the event's own timestamp, not Date.now(): if a flush was
    // deferred for several seconds, the bubble should still show
    // *when the thing actually happened* in the browser, not when we
    // got around to surfacing it.
    const ts = event.ts || Date.now();
    console.log('[voice] router emit bubble:', summary, 'ts=', new Date(ts).toLocaleTimeString());

    // Push the event bubble so it appears in the transcript even if
    // the model takes a moment to narrate.
    onMajorBubble?.({
      summary,
      details: _detailLines(event, minors),
      ts,
    });

    // Inject for the model to narrate. Include a brief context line
    // listing minor activity so the agent's spoken summary is grounded.
    let text = `[Browser update] ${summary}`;
    if (event.catchup) {
      text = `[Browser update] Catch-up since you were last here: ${summary}`;
    }
    if (minors.length) {
      const ctx = minors
        .map(_phraseMinor)
        .filter(Boolean)
        .slice(-5)            // cap context to avoid prompt bloat
        .join(' · ');
      if (ctx) text += ` (recent activity: ${ctx})`;
    }
    sendTextTurn(text, { role: 'user', turnComplete: true });
  }

  return { ingest, flushNow };
}

// ----- phrasers --------------------------------------------------------

function _phraseMajor(event) {
  if (event.kind === 'status') {
    if (event.status === 'running') {
      return event.task ? `Started task: ${event.task}` : 'Task started';
    }
    if (event.status === 'done') {
      return event.summary ? `Task done: ${event.summary}` : 'Task done';
    }
    if (event.status === 'error') {
      return event.error ? `Task error: ${event.error}` : 'Task errored';
    }
    if (event.status === 'stopped') return 'Task stopped';
    return null;
  }
  if (event.kind === 'log') {
    if (event.logKind === 'error') return `Error: ${event.text || ''}`.trim();
    if (event.logKind === 'done') return event.text || 'Done';
    if (event.logKind === 'action') {
      // Action-specific phrasing keeps bubble titles readable.
      switch (event.action) {
        case 'navigate':    return `Navigating: ${event.text || ''}`.trim();
        case 'go_back':     return 'Went back';
        case 'go_forward':  return 'Went forward';
        case 'refresh':     return 'Refreshed page';
        case 'open_tab':    return `Opened tab: ${event.text || ''}`.trim();
        case 'switch_tab':  return `Switched tab: ${event.text || ''}`.trim();
        case 'close_tab':   return 'Closed tab';
        case 'done':        return event.text || 'Done';
        default:            return event.text || event.action || 'Action';
      }
    }
  }
  return null;
}

function _phraseProgress(minors) {
  // Use the most recent minor event's text/action as the bubble title.
  // The full buffer renders in the expandable details, so the title
  // can be terse.
  const last = minors[minors.length - 1];
  if (!last) return 'Progress';
  if (last.kind === 'log') {
    if (last.action) {
      const verb = _verbForAction(last.action);
      return verb || `${last.action}: ${last.text || ''}`.trim();
    }
    return last.text || 'Progress';
  }
  return 'Progress';
}

function _verbForAction(action) {
  // Concise verbs for common actions. Falls through (returns null) for
  // anything not in the table, letting _phraseProgress include the raw
  // action name.
  switch (action) {
    case 'click_index':
    case 'click':           return 'Clicking';
    case 'type_index':
    case 'type':            return 'Typing';
    case 'fill_input':      return 'Filling input';
    case 'press_key':       return 'Pressing key';
    case 'scroll':          return 'Scrolling';
    case 'select_dropdown': return 'Selecting option';
    case 'dropdown_options':return 'Reading dropdown';
    case 'upload_file':     return 'Uploading file';
    case 'handle_dialog':   return 'Handling dialog';
    case 'js':              return 'Reading page';
    case 'read_skill':
    case 'write_skill':     return 'Loading playbook';
    default: return null;
  }
}

function _phraseMinor(event) {
  if (event.kind === 'log') {
    return event.text || event.action || event.logKind;
  }
  if (event.kind === 'status') return `status -> ${event.status}`;
  return null;
}

// Detail rows shown when the user expands a bubble. We expose the raw
// event shape; the UI formats columns. Most-recent first so the user
// sees the major event at the top.
function _detailLines(major, minors) {
  const rows = [];
  rows.push({
    when: 'now',
    kind: major.kind,
    sub: major.logKind || major.status || '',
    action: major.action || '',
    text: _phraseMajor(major) || '',
  });
  for (let i = minors.length - 1; i >= 0; i--) {
    const m = minors[i];
    rows.push({
      when: '',
      kind: m.kind,
      sub: m.logKind || m.status || '',
      action: m.action || '',
      text: _phraseMinor(m) || '',
    });
  }
  return rows;
}
