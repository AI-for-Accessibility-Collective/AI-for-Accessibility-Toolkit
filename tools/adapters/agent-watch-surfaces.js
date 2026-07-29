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
export function livingPlan(steps, { compact = false } = {}) {
  if (!Array.isArray(steps) || !steps.length) return null;
  const box = el('section', 'aw-surf aw-plan');
  box.setAttribute('aria-label', 'What the assistant is doing right now');
  box.appendChild(el('h3', 'aw-surf-head', 'Right now'));

  const list = el('ol', 'aw-plan-list');
  const shown = compact ? steps.slice(-3) : steps;
  for (const s of shown) {
    const kind = s.state === 'failed' ? 'failed' : s.state === 'skipped' ? 'skipped' : 'done';
    const li = el('li', `aw-plan-step aw-plan-${kind}`);
    li.appendChild(el('span', 'aw-plan-what', s.what));
    if (s.detail) li.appendChild(el('span', 'aw-plan-detail', s.detail));
    list.appendChild(li);
  }
  box.appendChild(list);

  const skipped = steps.filter((s) => s.state === 'skipped').length;
  if (skipped) {
    box.appendChild(el('p', 'aw-plan-note',
      `${skipped} thing${skipped === 1 ? '' : 's'} nobody checked.`));
  }
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
  const box = el('section', 'aw-surf aw-prompt');
  box.setAttribute('aria-label', 'What you asked for');
  box.appendChild(el('h3', 'aw-surf-head', 'This task'));

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
    const dd = el('dd', null, v);
    if (onEdit) {
      const b = el('button', 'aw-prompt-edit', 'change');
      b.type = 'button';
      b.addEventListener('click', () => onEdit(k));
      dd.appendChild(b);
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
  const box = el('section', 'aw-surf aw-rules');
  box.setAttribute('aria-label', 'Your standing rules');
  const n = (rules || []).length;
  box.appendChild(el('h3', 'aw-surf-head',
    n ? `Always (${n})` : 'Always'));

  if (!n) {
    box.appendChild(el('p', 'aw-rules-empty',
      'Nothing standing yet. I’ll ask when something comes up worth keeping.'));
  } else {
    const list = el('ul', 'aw-rules-list');
    for (const r of rules) {
      const li = el('li', `aw-rules-rule${r.on === false ? ' aw-rules-off' : ''}`);
      const t = el('button', 'aw-rules-toggle', r.on === false ? 'off' : 'on');
      t.type = 'button';
      t.setAttribute('aria-pressed', String(r.on !== false));
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
#${id} .aw-surf { padding: 10px 14px; border-top: 1px solid ${line}; }
#${id} .aw-surf-head {
  margin: 0 0 6px; font-size: ${px(0.78)}; font-weight: 600;
  text-transform: uppercase; letter-spacing: .5px; color: ${muted};
}

/* the living plan */
#${id} .aw-plan-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-plan-step {
  display: flex; flex-direction: column; padding: 3px 0 3px 17px;
  position: relative; font-size: ${px(0.92)};
}
#${id} .aw-plan-step::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-plan-done::before    { content: "✓"; }
#${id} .aw-plan-failed::before  { content: "✗"; }
/* An em dash, not a blank: a skipped step has to be as legible as a done one,
   because by ear the alternative is silence. */
#${id} .aw-plan-skipped::before { content: "—"; }
#${id} .aw-plan-skipped .aw-plan-what { font-weight: 600; }
#${id} .aw-plan-detail { color: ${muted}; font-size: ${px(0.84)}; }
#${id} .aw-plan-note {
  margin: 6px 0 0; font-size: ${px(0.84)}; font-weight: 600;
}

/* the living prompt */
#${id} .aw-prompt-list { margin: 0; }
#${id} .aw-prompt-row {
  display: flex; gap: 9px; padding: 2px 0; font-size: ${px(0.92)};
}
#${id} .aw-prompt-row dt { flex: 0 0 32%; color: ${muted}; margin: 0; }
#${id} .aw-prompt-row dd {
  flex: 1 1 auto; margin: 0; display: flex; gap: 7px;
  justify-content: space-between; min-width: 0;
}
#${id} .aw-prompt-edit {
  flex: 0 0 auto; font: inherit; font-size: ${px(0.8)}; background: none;
  border: 0; padding: 0; color: inherit; opacity: .55;
  text-decoration: underline; cursor: pointer;
}
#${id} .aw-prompt-edit:hover { opacity: 1; }
#${id} .aw-prompt-stale {
  margin: 7px 0 0; padding: 7px 9px; font-size: ${px(0.88)};
  border: 1px solid currentColor; border-radius: 7px;
}

/* the rulebook */
#${id} .aw-rules-empty { margin: 0; font-size: ${px(0.88)}; color: ${muted}; }
#${id} .aw-rules-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-rules-rule {
  display: flex; gap: 8px; align-items: baseline; padding: 3px 0;
  font-size: ${px(0.92)};
}
#${id} .aw-rules-toggle {
  flex: 0 0 auto; font: inherit; font-size: ${px(0.7)}; text-transform: uppercase;
  letter-spacing: .5px; border: 1px solid currentColor; border-radius: 3px;
  padding: 0 4px; background: none; color: inherit; cursor: pointer;
}
#${id} .aw-rules-off { opacity: .5; }
#${id} .aw-rules-offer {
  margin: 9px 0 0; padding: 9px 11px; border-radius: 8px;
  border: ${high ? '2px' : '1px'} solid ${line};
}
#${id} .aw-rules-because {
  margin: 0 0 3px; font-size: ${px(0.82)}; color: ${muted};
}
#${id} .aw-rules-ask { margin: 0 0 8px; font-size: ${px(0.95)}; }
#${id} .aw-rules-row { display: flex; gap: 8px; flex-wrap: wrap; }
#${id} .aw-rules-row .aw-do { margin-top: 0; }
`;
}
