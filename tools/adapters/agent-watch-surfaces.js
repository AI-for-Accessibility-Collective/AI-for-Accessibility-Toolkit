// The three surfaces.
//
// Everything an agent says is an utterance: spoken once, then gone. That is a
// failure class of its own — 17 of the 132 breakdowns in the corpus are things
// that existed, were said, and could not be reached again. *"The order number
// is 17 digits heard once." "The confirmation page cannot be reopened."* For
// someone working by ear, an utterance you missed is gone; a surface you can
// return to is a different thing entirely.
//
// So three things persist, and they are one object at three time scales:
//
//     RULEBOOK        what is true across every task
//         ▲  promote — a correction becomes permanent
//     LIVING PROMPT   what is true for this task
//         ▲  answer — the page raises a distinction, you settle it
//     LIVING PLAN     what is true right now
//
// The arrow only runs upward, and that is what makes the second task cheaper
// than the first: an emergent answer becomes a task field, a repeated task
// field becomes a standing rule. Nothing flows down, because a standing rule
// that could be silently overwritten by one task is not standing.
//
// Two rules that are not cosmetic:
//
//   * The Rulebook starts EMPTY. A first-time user has no profile, and asking
//     eleven questions up front to fill one is the interrogation the corpus
//     warns about. Rules are promoted at the moment the page raises them.
//   * The Plan carries what did NOT happen as visibly as what did. An
//     unflagged absence reads exactly like a passed check — that is the single
//     most repeated failure in the corpus, and a plan that lists only
//     successes manufactures it.

/**
 * A section that opens on demand.
 *
 * Three surfaces open at once is still a wall, just a wall one click further
 * in. Each one answers a different question — what I did, what you asked for,
 * what holds from now on — and someone opening the history usually wants one
 * of the three, not all of them.
 */
const section = (cls, heading, open = false) => {
  const d = document.createElement('details');
  d.className = `aw-surf ${cls}`;
  d.open = open;
  const sum = document.createElement('summary');
  sum.className = 'aw-surf-head';
  sum.textContent = heading;
  d.appendChild(sum);
  return d;
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * The Living Plan — what is true right now.
 *
 * Steps carry one of three marks, and the third is the one that matters:
 *   ✓ done · ✗ could not · — skipped
 *
 * A skipped step is not a missing step. "Nobody read the reviews" has to be as
 * legible as "opened the best-rated match", because by ear they are otherwise
 * the same silence.
 */
export function livingPlan(steps, { compact = false, totalPhases = 6 } = {}) {
  if (!Array.isArray(steps) || !steps.length) return null;
  // "Right now" was wrong: this is a record of what already happened, and
  // labelling a history as the present made the whole panel read as stale.
  // No aria-label — the summary already names it, and a landmark labelled
  // twice is read twice.
  // Named as the analysis names it. "What I did" was clearer than "Right now"
  // but it renamed a concept that already has a name and is used across the
  // project, the paper and the corpus — so the surface and the writing about
  // it stopped matching.
  const box = section('aw-plan', 'Living Plan');

  // How far through, at a glance. Six phases are known in advance, so this is
  // a real fraction rather than a guess — and where a task has stalled is
  // exactly what a person who delegated it cannot otherwise see.
  const done = steps.filter((s) => s.state === 'done').length;
  box.appendChild(el('p', 'aw-plan-count', `${done} of ${totalPhases} steps`));

  const list = el('ol', 'aw-plan-list');
  const shown = compact ? steps.slice(-3) : steps;
  for (const s of shown) {
    const kind = s.state === 'failed' ? 'failed' : s.state === 'skipped' ? 'skipped' : 'done';
    const li = el('li', `aw-plan-step aw-plan-${kind}`);
    li.appendChild(el('span', 'aw-plan-what', s.what));
    // "nothing to flag" under a step already marked done is the same fact
    // twice. The mark carries it.
    if (s.detail && s.detail !== 'nothing to flag') {
      li.appendChild(el('span', 'aw-plan-detail', s.detail));
    }
    list.appendChild(li);
  }
  box.appendChild(list);

  return box;
}

/**
 * The Living Prompt — what is true for this task.
 *
 * Editable mid-run, and editing is not free: anything already checked against
 * the old value stops being checked. Saying so is the whole point. Without it
 * a run manufactures the breakdown the corpus records at Search — *"after a
 * re-sort every position you heard is wrong"* — with stale verifications still
 * reading as passed.
 */
export function livingPrompt(contract, { invalidated = [], onEdit } = {}) {
  if (!contract) return null;
  const box = section('aw-prompt', 'Living Prompt');

  const fields = [
    ['buying', contract.item],
    ['must have', (contract.mustHaves || []).join(', ')],
    ['size', contract.size],
    ['budget', contract.budget],
    ['how many', contract.quantity > 1 ? String(contract.quantity) : null],
    ['needed by', contract.deadline],
  ].filter(([, v]) => v);

  const dl = el('dl', 'aw-prompt-list');
  for (const [k, v] of fields) {
    const row = el('div', 'aw-prompt-row');
    row.appendChild(el('dt', null, k));
    // Editable where it is shown, rather than a link to somewhere else. The
    // analysis is explicit that editing mid-run is a real move and that its
    // cost has to be stated — that is much harder to mean if changing a field
    // takes you out of the surface that would tell you.
    const dd = el('dd', null, null);
    if (onEdit) {
      const input = el('input', 'aw-prompt-value');
      input.type = 'text';
      input.value = v;
      input.setAttribute('aria-label', k);
      const commit = () => {
        const next = input.value.trim();
        if (next && next !== v) onEdit(k, next);
        else input.value = v;
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = v; input.blur(); }
      });
      dd.appendChild(input);
    } else {
      dd.textContent = v;
    }
    row.appendChild(dd);
    dl.appendChild(row);
  }
  box.appendChild(dl);

  // The cost of an edit, stated. Anything checked against the old value is no
  // longer checked, and a check that silently reverts to unchecked is exactly
  // the invisible loss this whole layer exists to surface.
  if (invalidated.length) {
    const warn = el('p', 'aw-prompt-stale');
    warn.textContent = `${invalidated.length} thing${invalidated.length === 1 ? '' : 's'} `
      + `I checked against the old answer ${invalidated.length === 1 ? 'is' : 'are'} `
      + `no longer checked: ${invalidated.join('; ')}.`;
    box.appendChild(warn);
  }
  return box;
}

/**
 * The Rulebook — what is true across every task.
 *
 * Starts empty except one default that is never asked about, because a person
 * who has stated no preferences should still not have money spent without
 * being asked.
 *
 * `offer` is a rule the page has just earned the right to ask about. It is
 * shown at the moment it applies, never in advance — none of these could have
 * been stated before the page raised them.
 */
export function rulebook(rules, { offer, onPromote, onToggle } = {}) {
  const n = (rules || []).length;
  // Opens itself only when there is something to answer.
  const box = section('aw-rules',
    'Rulebook', !!offer);

  if (!n) {
    box.appendChild(el('p', 'aw-rules-empty',
      'Nothing standing yet. I’ll ask when something comes up worth keeping.'));
  } else {
    const list = el('ul', 'aw-rules-list');
    for (const r of rules) {
      const li = el('li', `aw-rules-rule${r.on === false ? ' aw-rules-off' : ''}`);
      // A switch, with its state in the accessibility tree rather than only in
      // the word printed on it. A rule that is off has to be legible as off to
      // someone who never sees the styling.
      const t = el('button', 'aw-rules-toggle');
      t.type = 'button';
      t.setAttribute('role', 'switch');
      t.setAttribute('aria-checked', String(r.on !== false));
      t.setAttribute('aria-label', `${r.text} — ${r.on === false ? 'off' : 'on'}`);
      t.appendChild(el('span', 'aw-rules-knob'));
      if (onToggle) t.addEventListener('click', () => onToggle(r));
      li.appendChild(t);
      li.appendChild(el('span', 'aw-rules-text', r.text));
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  if (offer) {
    const o = el('div', 'aw-rules-offer');
    // The trigger first: a rule offered without the moment that earned it is
    // a settings screen, and settings screens get answered wrong.
    o.appendChild(el('p', 'aw-rules-because', offer.because));
    o.appendChild(el('p', 'aw-rules-ask', offer.ask));
    const row = el('div', 'aw-rules-row');
    const yes = el('button', 'aw-do aw-primary', 'Always do that');
    yes.type = 'button';
    yes.addEventListener('click', () => onPromote?.(offer, true));
    const no = el('button', 'aw-do', 'Just this once');
    no.type = 'button';
    no.addEventListener('click', () => onPromote?.(offer, false));
    row.append(yes, no);
    o.appendChild(row);
    box.appendChild(o);
  }
  return box;
}

/** Styles for all three, sized from the person's type scale. */
export function surfaceCss(id, base, muted, line, high) {
  const px = (n) => `${Math.round(base * n)}px`;
  return `
#${id} .aw-surf { padding: 8px 14px; border-top: 1px solid ${line}; }
#${id} .aw-surf > summary.aw-surf-head {
  margin: 0; padding: 3px 0; cursor: pointer;
  font-size: ${px(0.78)}; font-weight: 600;
  text-transform: uppercase; letter-spacing: .5px; color: ${muted};
}
#${id} .aw-surf[open] > summary.aw-surf-head { margin-bottom: 6px; color: inherit; }
#${id} .aw-surf > summary:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }

/* the living plan */
#${id} .aw-plan-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-plan-step {
  /* One line per step, like the prompt's rows: the step on the left, what
     came of it on the right. A long outcome wraps under, still right-set. */
  display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 9px;
  padding: 3px 0 3px 17px; position: relative; font-size: ${px(0.86)};
}
#${id} .aw-plan-step::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-plan-done::before    { content: "✓"; }
#${id} .aw-plan-failed::before  { content: "✗"; }
/* An em dash, not a blank: a skipped step has to be as legible as a done one,
   because by ear the alternative is silence. */
#${id} .aw-plan-skipped::before { content: "—"; }
#${id} .aw-plan-skipped .aw-plan-what { font-weight: 600; }
#${id} .aw-plan-detail {
  color: ${muted}; font-size: ${px(0.78)};
  margin-left: auto; text-align: right; flex: 0 1 auto;
}
#${id} .aw-plan-note {
  margin: 6px 0 0; font-size: ${px(0.78)}; font-weight: 600;
}

/* the living prompt */
#${id} .aw-prompt-list { margin: 0; }
#${id} .aw-prompt-row {
  display: flex; gap: 9px; padding: 2px 0; font-size: ${px(0.86)};
}
#${id} .aw-prompt-row dt { flex: 0 0 32%; color: ${muted}; margin: 0; }
#${id} .aw-prompt-row dd {
  flex: 1 1 auto; margin: 0; display: flex; gap: 7px;
  justify-content: space-between; min-width: 0;
}
#${id} .aw-prompt-value {
  flex: 1 1 auto; min-width: 0; font: inherit; color: inherit;
  background: none; border: 0; border-bottom: 1px dashed ${line};
  padding: 1px 2px; border-radius: 2px;
}
#${id} .aw-prompt-value:hover { border-bottom-style: solid; }
#${id} .aw-prompt-value:focus {
  outline: none; border-bottom: 1px solid currentColor; background: rgba(0,0,0,.03);
}
#${id} .aw-prompt-edit {
  flex: 0 0 auto; font: inherit; font-size: ${px(0.78)}; background: none;
  border: 0; padding: 0; color: inherit; opacity: .55;
  text-decoration: underline; cursor: pointer;
}
#${id} .aw-prompt-edit:hover { opacity: 1; }
#${id} .aw-prompt-stale {
  margin: 7px 0 0; padding: 7px 9px; font-size: ${px(0.86)};
  border: 1px solid currentColor; border-radius: 7px;
}

#${id} .aw-plan-count {
  margin: 0 0 7px; font-size: ${px(0.78)}; color: ${muted};
}

/* the rulebook */
#${id} .aw-rules-empty { margin: 0; font-size: ${px(0.86)}; color: ${muted}; }
#${id} .aw-rules-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-rules-rule {
  display: flex; gap: 8px; align-items: baseline; padding: 3px 0;
  font-size: ${px(0.86)};
}
#${id} .aw-rules-toggle {
  flex: 0 0 auto; width: ${px(1.9)}; height: ${px(1.05)}; padding: 1px;
  border: 1px solid ${high ? 'currentColor' : '#1a73e8'}; border-radius: 999px;
  background: ${high ? 'none' : '#1a73e8'}; cursor: pointer; position: relative;
}
#${id} .aw-rules-knob {
  display: block; width: ${px(0.72)}; height: ${px(0.72)}; border-radius: 50%;
  background: ${high ? 'currentColor' : '#fff'}; transform: translateX(${px(0.82)});
  ${'' /* off slides back, and the border stays so the track is still visible */}
}
#${id} .aw-rules-toggle[aria-checked="false"] {
  border-color: ${high ? 'currentColor' : '#9ca3af'}; background: none; opacity: ${high ? '.55' : '1'};
}
#${id} .aw-rules-toggle[aria-checked="false"] .aw-rules-knob { background: ${high ? 'currentColor' : '#9ca3af'}; }
#${id} .aw-rules-toggle[aria-checked="false"] .aw-rules-knob { transform: translateX(0); }
#${id} .aw-rules-toggle:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
#${id} .aw-rules-off { opacity: .5; }
#${id} .aw-rules-offer {
  margin: 9px 0 0; padding: 9px 11px; border-radius: 8px;
  border: ${high ? '2px' : '1px'} solid ${line};
}
#${id} .aw-rules-because {
  margin: 0 0 3px; font-size: ${px(0.78)}; color: ${muted};
}
#${id} .aw-rules-ask { margin: 0 0 8px; }
#${id} .aw-rules-row { display: flex; gap: 8px; flex-wrap: wrap; }
#${id} .aw-rules-row .aw-do { margin-top: 0; }
`;
}
