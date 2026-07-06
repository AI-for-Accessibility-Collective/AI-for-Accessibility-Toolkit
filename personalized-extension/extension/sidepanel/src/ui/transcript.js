// Renders the running transcript. Four role types:
//   - user   : transcribed user speech (or typed input)
//   - agent  : transcribed model speech
//   - event  : browser-agent milestone bubble (from the bridge), with
//              an expandable details section showing the underlying
//              log entries. Each major event = one event bubble.
//   - action : tool-call confirmation chip ("✓ Text size: 150%"). The
//              NEWEST undoable chip carries an Undo button while the
//              session is live (the undo stack lives in the offscreen
//              page and dies with it).
//
// We re-render the whole list on every snapshot. Transcripts are
// bounded (200 entries) so this is cheap, and idempotency means we
// don't worry about partial-state churn from streaming transcription.
//
// To preserve the open/closed state of <details> across re-renders we
// key entries by ts and stash open ts values in a Set.

const _openDetails = new Set();

export function mountTranscript(rootEl, emptyEl, { onUndo } = {}) {
  function render(snap) {
    const list = snap.transcript || [];
    // Live "Listening..." placeholder while the mic is picking up
    // speech. The Gemini Live API only emits user-side transcripts
    // *after* end-of-speech, so without this the user gets no visual
    // feedback that they're being heard until they stop talking.
    // We show the placeholder only when there isn't already an
    // in-progress user partial (so once real text streams in, it
    // replaces the placeholder rather than rendering alongside it).
    const last = list[list.length - 1];
    const hasUserPartial = last && last.role === 'user' && last.partial;
    const showListening = !!snap.micActivity && !hasUserPartial;

    if (!list.length && !showListening) {
      emptyEl.hidden = false;
      rootEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    // Only the newest undoable action chip gets the Undo button, and only
    // while connected (the offscreen undo stack is gone otherwise) and not
    // while an undo is already in flight (the button is re-created enabled on
    // every re-render, so double activation would revert an older change).
    let newestUndoable = null;
    if (snap.connection === 'live' && !snap.undoInFlight) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.role === 'action' && e.undoable && e.ok) { newestUndoable = e; break; }
        // An undo chip means the change below it was already reverted.
        if (e.role === 'action' && e.tool === 'undo_last_change') break;
      }
    }
    // Autoscroll only when the user is already at the bottom — don't yank them
    // down if they scrolled up to re-read while the model streams.
    const scroller = rootEl.parentElement;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const frag = document.createDocumentFragment();
    for (const entry of list) {
      frag.appendChild(_renderEntry(entry, { canUndo: entry === newestUndoable, onUndo }));
    }
    if (showListening) {
      frag.appendChild(_renderListeningPlaceholder());
    }
    rootEl.replaceChildren(frag);
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  }
  return { render };
}

function _renderListeningPlaceholder() {
  // Same shape as a user bubble so it visually anchors where the
  // real transcript will land. The .vp-msg-listening class drives
  // the pulsing animation in sidepanel.css.
  const li = document.createElement('li');
  li.className = 'vp-msg vp-msg-user vp-msg-listening';
  const icon = document.createElement('span');
  icon.className = 'vp-listening-icon';
  icon.textContent = '🎤';
  const text = document.createElement('span');
  text.textContent = ' Listening…';
  li.appendChild(icon);
  li.appendChild(text);
  return li;
}

function _renderEntry(entry, opts = {}) {
  if (entry.role === 'event') return _renderEventBubble(entry);
  if (entry.role === 'action') return _renderActionChip(entry, opts);
  return _renderSpeechBubble(entry);
}

function _renderActionChip(entry, { canUndo, onUndo } = {}) {
  const li = document.createElement('li');
  li.className = 'vp-msg vp-msg-action' + (entry.ok ? '' : ' vp-msg-action-failed');
  const icon = document.createElement('span');
  icon.className = 'vp-action-icon';
  icon.textContent = entry.ok ? '✓' : '⚠';
  icon.setAttribute('aria-hidden', 'true');
  li.appendChild(icon);
  const text = document.createElement('span');
  text.className = 'vp-action-text';
  text.textContent = entry.text || '(action)';
  li.appendChild(text);
  if (canUndo && typeof onUndo === 'function') {
    const btn = document.createElement('button');
    btn.className = 'vp-btn vp-undo-btn';
    btn.textContent = 'Undo';
    btn.setAttribute('aria-label', `Undo: ${entry.text || 'last change'}`);
    btn.addEventListener('click', () => { btn.disabled = true; onUndo(entry); });
    li.appendChild(btn);
  }
  li.appendChild(_timeEl(entry.ts));
  return li;
}

function _renderSpeechBubble(entry) {
  const li = document.createElement('li');
  li.className = `vp-msg vp-msg-${entry.role}` + (entry.partial ? ' vp-msg-partial' : '');
  li.textContent = entry.text;
  li.appendChild(_timeEl(entry.ts));
  return li;
}

function _renderEventBubble(entry) {
  const li = document.createElement('li');
  li.className = 'vp-msg vp-msg-event';

  const det = document.createElement('details');
  det.open = _openDetails.has(entry.ts);
  det.addEventListener('toggle', () => {
    if (det.open) _openDetails.add(entry.ts);
    else _openDetails.delete(entry.ts);
  });

  const summary = document.createElement('summary');
  summary.className = 'vp-event-summary';
  // Inline icon + title; native disclosure caret is on the left.
  const icon = document.createElement('span');
  icon.className = 'vp-event-icon';
  icon.textContent = '🌐';
  summary.appendChild(icon);
  const title = document.createElement('span');
  title.className = 'vp-event-title';
  title.textContent = entry.text || '(event)';
  summary.appendChild(title);
  det.appendChild(summary);

  // Detail rows: kind/sub/action/text columns. Each row = one log entry
  // (the major event itself first, then the minor activity that fed
  // into it).
  if (entry.details && entry.details.length) {
    const ul = document.createElement('ul');
    ul.className = 'vp-event-details';
    for (const row of entry.details) {
      const item = document.createElement('li');
      item.className = 'vp-event-row';
      const tag = document.createElement('span');
      tag.className = 'vp-event-tag';
      tag.textContent = row.action || row.sub || row.kind || '·';
      const txt = document.createElement('span');
      txt.className = 'vp-event-text';
      txt.textContent = row.text || '';
      item.appendChild(tag);
      item.appendChild(txt);
      ul.appendChild(item);
    }
    det.appendChild(ul);
  }

  li.appendChild(det);
  li.appendChild(_timeEl(entry.ts));
  return li;
}

function _timeEl(ts) {
  const t = document.createElement('span');
  t.className = 'vp-msg-time';
  t.textContent = _fmtTime(ts);
  return t;
}

function _fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
