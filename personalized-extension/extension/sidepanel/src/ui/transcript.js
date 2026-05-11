// Renders the running transcript. Three role types:
//   - user   : transcribed user speech
//   - agent  : transcribed model speech
//   - event  : browser-agent milestone bubble (from the bridge), with
//              an expandable details section showing the underlying
//              log entries. Each major event = one event bubble.
//
// We re-render the whole list on every snapshot. Transcripts are
// bounded (200 entries) so this is cheap, and idempotency means we
// don't worry about partial-state churn from streaming transcription.
//
// To preserve the open/closed state of <details> across re-renders we
// key entries by ts and stash open ts values in a Set.

const _openDetails = new Set();

export function mountTranscript(rootEl, emptyEl) {
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
    const frag = document.createDocumentFragment();
    for (const entry of list) {
      frag.appendChild(_renderEntry(entry));
    }
    if (showListening) {
      frag.appendChild(_renderListeningPlaceholder());
    }
    rootEl.replaceChildren(frag);
    rootEl.parentElement.scrollTop = rootEl.parentElement.scrollHeight;
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

function _renderEntry(entry) {
  if (entry.role === 'event') return _renderEventBubble(entry);
  return _renderSpeechBubble(entry);
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
