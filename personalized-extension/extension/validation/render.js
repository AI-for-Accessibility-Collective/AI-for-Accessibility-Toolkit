// One finding, two renderings.
//
// The two agent personas differ in exactly one way, and it decides everything
// about how a finding should reach them.
//
//   A sighted person delegating has not lost perception — they can still look
//   at the page. What delegation took is the DOING: re-sort, open a different
//   one, change the size, place the order. So interrupting them to describe
//   something they could see is pure cost, and what they actually need handed
//   back is the control.
//
//   A screen-reader person delegating has lost the page itself. Unrequested
//   information is the only kind that arrives, because you cannot scan for a
//   mark that might be there, and you cannot ask about a fact you were never
//   told exists.
//
// So the same finding becomes a spoken sentence for one and a quiet mark plus
// a control for the other. Not the same interface with the volume changed —
// they are near opposites, and they come from one property: whether a cheap
// independent check still exists.

/**
 * For speech. One sentence first, carrying the number rather than the
 * explanation, because a listener who stops attending after eight words should
 * still have the fact.
 *
 * @param {Object} finding
 * @param {string} level    ambient | aside | stop
 * @returns {{speak: string|null, live: 'polite'|'assertive'|null, holds: boolean}}
 */
export function renderSpoken(finding, level) {
  if (level === 'ambient') {
    // Reachable on request, never announced. Silence here is the point: the
    // budget for speech is small and this did not earn a piece of it.
    return { speak: null, live: null, holds: false, onRequest: finding.say };
  }
  if (level === 'stop') {
    return {
      // A stop names what happened and what to do about it. A blocking message
      // with no way forward is worse than no message.
      speak: finding.answerable === false ? finding.say
        : `${finding.say} ${prompt(finding)}`,
      live: 'assertive',
      holds: true,
    };
  }
  return { speak: finding.say, live: 'polite', holds: false };
}

/** What a stop asks for. Derived from the finding rather than generic, so the
 *  person is answering a question about their own task. */
function prompt(f) {
  if (/size/i.test(f.widget)) return 'Say "use it" or "change it".';
  if (/extra items|spending cap/i.test(f.widget)) return 'Say "remove them" or "go ahead".';
  if (/did it land/i.test(f.widget)) return 'Say "try again" or "stop".';
  return 'Say "go on" or "stop".';
}

/**
 * For eyes. A mark, not a sentence — and the control that delegation removed,
 * which is the part that actually helps this persona.
 *
 * @returns {{tone: string, text: string, control: Object|null, blocking: boolean}}
 */
export function renderVisual(finding, level) {
  const tone = finding.confirming ? 'ok'
    : level === 'stop' ? 'stop'
    : level === 'aside' ? 'note' : 'quiet';

  return {
    tone,
    // Short. This sits beside the thing it is about; the full sentence is
    // available on hover or focus, and reading it aloud is the other channel's
    // job.
    text: shorten(finding.say),
    full: finding.say,
    control: controlFor(finding),
    blocking: level === 'stop',
  };
}

/** The action delegation took away, per finding. This is the sighted
 *  persona's actual remedy — knowing is not the problem, reaching is. */
function controlFor(f) {
  const w = f.widget;
  if (/badge decoder|stars never alone/i.test(w)) {
    return { label: 'Sort by rating', action: 're-sort', arg: 'rating' };
  }
  if (/no exact match|two answers about size/i.test(w)) {
    return { label: 'Change size', action: 'pick-size' };
  }
  if (/extra items/i.test(w)) {
    return { label: 'Remove the extras', action: 'remove-extras' };
  }
  if (/word match|unseen-photo/i.test(w)) {
    return { label: 'Open a different one', action: 'open-other' };
  }
  if (/spending cap|did it land/i.test(w)) {
    return { label: 'Stop here', action: 'halt' };
  }
  return null;
}

/** First clause, up to a natural break. */
function shorten(s) {
  const first = String(s).split(/(?<=[.?!])\s/)[0] || String(s);
  return first.length <= 64 ? first : `${first.slice(0, 61).replace(/\s\S*$/, '')}…`;
}

/**
 * Render one finding for whoever is present. `persona` is 'BA' (screen reader
 * + agent) or 'SA' (sighted + agent); both may be true when someone is using
 * a screen reader with vision, so both renderings are returned and the caller
 * decides which channels are live.
 */
export function render(finding, level, { speech = true, visual = true } = {}) {
  return {
    finding, level,
    spoken: speech ? renderSpoken(finding, level) : null,
    visual: visual ? renderVisual(finding, level) : null,
  };
}
