// The shapes.
//
// A finding is not a sentence with a coloured dot. The corpus clusters 132
// breakdowns into twelve paradigms, and each paradigm has a shape it wants to
// be — because the shape is doing the work the sentence cannot.
//
// "944 results" as text is a number you have to judge. As a needle on a scale
// marked dead end / right / too loose, it arrives already judged, which is the
// entire point of the paradigm: the glance, translated. Rendering both as the
// same grey card throws away the only thing that made them different.
//
// Each shape here also has an auditory signature in the corpus — pitch for the
// gauge, one timbre per source for the triangulation, area-as-listening-time
// for the coverage map. Those belong to the spoken channel and are not built
// here; what is built here is the visual half, in a form that keeps them
// separable.
//
// Every shape:
//   * degrades to its own sentence if it has no structured data, so a check
//     that has not been given shape data yet still says what it found
//   * carries the page's own words underneath, because a claim that cannot be
//     traced is a claim you have to take on faith
//   * never uses colour alone — each has a mark or a geometry that survives
//     any colour vision and any high-contrast mode
//
// Paradigm numbers match deck/widgets.html.

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const svg = (w, h, label) => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', '100%');
  s.setAttribute('height', String(h));
  // The shape is decoration for anyone reading it aloud — every fact it draws
  // is also in the text beside it. Announcing the geometry twice is noise.
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (label) s.setAttribute('data-label', label);
  return s;
};

// Make part of a shape something you can press.
//
// A shape that only depicts is a picture of a problem. The paradigms in the
// analysis are interactions — poke the world means point at anything and hear
// its exact words; the coverage map exists so you can say "read those now";
// the fork exists so you can open the road not taken. Rendering them as static
// geometry keeps the diagram and throws away the affordance, which is the part
// that returns control to the person.
//
// So each shape's parts are real buttons: reachable by keyboard, named for
// screen readers, and carrying the action they perform.
let ACT = null;

/** @param {(a: {action: string, label: string, arg?: any}) => void} fn */
export function setActionHandler(fn) {
  ACT = fn;
}

const act = (node, { action, label, arg, describedBy }) => {
  if (!ACT) return node;                    // no handler: stays a plain shape
  node.classList.add('aw-act');
  // A <button> is already a button. Announcing "button button" and managing a
  // tabindex it already has is the kind of ARIA that makes things worse.
  const native = node.tagName === 'BUTTON';
  if (native) node.type = 'button';
  else {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
  }
  node.setAttribute('aria-label', describedBy || label);
  const fire = () => ACT({ action, label, arg });
  node.addEventListener('click', fire);
  // A native button already does Enter and Space; binding them again fires
  // twice.
  if (!native) {
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    });
  }
  return node;
};

const put = (parent, tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
};

// ── 1. the glance, translated ───────────────────────────────────────────────
//
// A count means nothing until it is placed against something. The question is
// what.
//
// This was a gauge with three zones — dead end / right / too loose — and the
// thresholds were doing work they could not support. "Under a thousand is
// right" is one blind tutor's working rule for whether a QUERY is too loose;
// it is not a fact about shopping, and drawing it as a scale with a good
// region turned an attributed heuristic into an objective verdict. A person
// reading it would have no way to know that 800 and 1,000 were a judgement
// rather than a measurement.
//
// Two honest replacements, and which one is used depends on what the number
// is:
//
//   a PROPORTION when the finding is a share of something — 8 of the first 10
//   are ads. No threshold is needed: the ratio is the claim, and it is
//   self-evidently a lot or a little without anyone drawing a line.
//
//   a MARKED SCALE when there is a real reference point, which is then
//   ATTRIBUTED. The needle sits where today's count is, one mark shows the
//   reference, and the label says whose rule it is. A reader can then disagree
//   with the rule instead of with the number.
function gauge(f) {
  const d = f.shape || {};

  // a proportion: part of a whole, no judgement required
  if (Number.isFinite(d.part) && Number.isFinite(d.whole) && d.whole > 0) {
    const box = el('div', 'aw-shape aw-prop');
    const W = 300, H = 26;
    const s = svg(W, H, `${d.part} of ${d.whole}`);
    const unit = W / d.whole;
    for (let i = 0; i < d.whole; i++) {
      put(s, 'rect', {
        x: i * unit + 1, y: 4, width: Math.max(2, unit - 2), height: 11,
        fill: 'currentColor', opacity: i < d.part ? 0.85 : 0.16,
      });
    }
    const t = put(s, 'text', { x: 0, y: 25, 'font-size': 9, fill: 'currentColor', opacity: 0.7 });
    t.textContent = d.partLabel || `${d.part} of ${d.whole}`;
    box.appendChild(s);
    if (d.action) {
      box.appendChild(act(el('button', 'aw-act aw-act-inline',
        d.actionLabel || `Leave out the ${d.part}`),
        { action: d.action, label: d.partLabel || 'these', arg: d,
          describedBy: d.actionLabel || `Leave out the ${d.part}` }));
    }
    return box;
  }

  // a marked scale, with the reference attributed to whoever holds it
  const n = Number(d.value);
  if (!Number.isFinite(n) || !d.mark) return null;
  const box = el('div', 'aw-shape aw-scale');
  const W = 300, H = 40;
  const s = svg(W, H, 'where today\u2019s count sits');
  const top = Math.max(n, d.mark) * 2;
  const x = (v) => 8 + (Math.log10(Math.max(v, 1)) / Math.log10(Math.max(top, 10))) * (W - 16);

  put(s, 'line', { x1: 8, y1: 20, x2: W - 8, y2: 20, stroke: 'currentColor', opacity: 0.25 });
  // the reference, dashed — a rule of thumb, drawn as one
  put(s, 'line', {
    x1: x(d.mark), y1: 12, x2: x(d.mark), y2: 28,
    stroke: 'currentColor', opacity: 0.5, 'stroke-dasharray': '2 2',
  });
  const ml = put(s, 'text', {
    x: x(d.mark), y: 38, 'text-anchor': 'middle', 'font-size': 8.5,
    fill: 'currentColor', opacity: 0.6,
  });
  ml.textContent = d.markLabel || String(d.mark);

  put(s, 'circle', { cx: x(n), cy: 20, r: 4, fill: 'currentColor' });
  const v = put(s, 'text', {
    x: x(n), y: 12, 'text-anchor': 'middle', 'font-size': 10,
    'font-weight': 700, fill: 'currentColor',
  });
  v.textContent = d.display || String(n);
  box.appendChild(s);
  if (d.source) box.appendChild(el('p', 'aw-scale-src', d.source));
  return box;
}

// ── 2. claim vs evidence — a triangulation ──────────────────────────────────
//
// One claim, and every source that does or does not support it, each on its
// own line. A claim resting on the seller's own row looks identical to a
// checked fact until the sources are drawn separately.
function triangulation(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.sources) || !d.sources.length) return null;
  const box = el('div', 'aw-shape aw-tri');

  if (d.claim) box.appendChild(el('p', 'aw-tri-claim', `“${d.claim}”`));
  const list = el('ul', 'aw-tri-list');
  for (const src of d.sources) {
    const li = el('li', `aw-tri-src aw-${src.agrees === false ? 'no' : src.agrees ? 'yes' : 'unknown'}`);
    li.appendChild(el('span', 'aw-tri-who', src.who));
    li.appendChild(el('span', 'aw-tri-said', src.said || (src.agrees ? 'agrees' : 'says nothing')));
    // Press a source to have it read again from the live page. The whole
    // paradigm is that sources can disagree; being able to go back to one is
    // what makes that more than an assertion.
    act(li, { action: 'check-source', label: src.who, arg: src,
              describedBy: `Read ${src.who} again from the page` });
    list.appendChild(li);
  }
  box.appendChild(list);

  const agree = d.sources.filter((s) => s.agrees).length;
  box.appendChild(el('p', 'aw-tri-verdict',
    agree >= 2 ? `${agree} sources agree.`
      : agree === 1 ? 'Only one source says so.'
        : 'No source confirms this.'));
  return box;
}

// ── 3. diff against the ask — a literal diff ────────────────────────────────
//
// Her words on the left, the page's on the right. The failure this catches is
// a loose match read as a match: "strap on the back" against "Adjustable
// Velcro Straps" is obviously not the same once they are on one line.
function diff(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.rows) || !d.rows.length) return null;
  const box = el('div', 'aw-shape aw-diff');

  const head = el('div', 'aw-diff-row aw-diff-head');
  head.appendChild(el('span', null, 'you said'));
  head.appendChild(el('span', null, 'the page'));
  box.appendChild(head);

  for (const r of d.rows) {
    const row = el('div', `aw-diff-row aw-${r.match === false ? 'no' : r.match ? 'yes' : 'unknown'}`);
    row.appendChild(el('span', 'aw-diff-mine', r.asked));
    row.appendChild(el('span', 'aw-diff-theirs', r.found == null ? 'not found' : String(r.found)));
    // Only the rows that do not match: pressing a row that agrees would do
    // nothing, and a control that does nothing teaches people to stop pressing.
    if (r.match === false) {
      act(row, { action: 'fix-field', label: r.asked, arg: r,
                 describedBy: `Fix this: you asked for ${r.asked}, the page says ${r.found}` });
    }
    box.appendChild(row);
  }
  return box;
}

// ── 4. what I didn't look at — a coverage map ───────────────────────────────
//
// Drawn to scale, because the proportion IS the finding. "I read 40 reviews"
// sounds thorough; 40 of 84 next to 0 of 7 photos does not. In the spoken
// channel the same proportion becomes listening time.
function coverage(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.parts) || !d.parts.length) return null;
  const box = el('div', 'aw-shape aw-cov');

  for (const p of d.parts) {
    const total = Math.max(1, Number(p.of) || 1);
    const done = Math.min(total, Math.max(0, Number(p.checked) || 0));
    const row = el('div', 'aw-cov-row');
    row.appendChild(el('span', 'aw-cov-what', p.what));

    const W = 150, H = 9;
    const s = svg(W, H, `${done} of ${total}`);
    put(s, 'rect', { x: 0, y: 1, width: W, height: H - 2, fill: 'currentColor', opacity: 0.13 });
    if (done) {
      put(s, 'rect', {
        x: 0, y: 1, width: Math.max(2, (done / total) * W), height: H - 2,
        fill: 'currentColor', opacity: 0.75,
      });
    }
    row.appendChild(s);
    row.appendChild(el('span', 'aw-cov-n', done ? `${done}/${total}` : `none of ${total}`));
    if (done < total) {
      act(row, { action: 'cover', label: p.what, arg: { what: p.what, of: total, checked: done },
                 describedBy: `Check the ${total - done} ${p.what} nobody has looked at` });
    }
    box.appendChild(row);
  }
  return box;
}

// ── 6. time-stamped world — a timeline ──────────────────────────────────────
//
// One fact at every moment it was seen. A set of prices gathered over four
// minutes and reported as one number is a comparison across time presented as
// a snapshot; laid on an axis it stops being able to hide.
function timeline(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.points) || d.points.length < 2) return null;
  const box = el('div', 'aw-shape aw-time');
  const W = 300, H = 40;
  const s = svg(W, H, 'the same fact over time');
  put(s, 'line', { x1: 6, y1: 24, x2: W - 6, y2: 24, stroke: 'currentColor', opacity: 0.3 });

  const n = d.points.length;
  d.points.forEach((p, i) => {
    const x = 6 + (i / (n - 1)) * (W - 12);
    const last = i === n - 1;
    put(s, 'circle', { cx: x, cy: 24, r: last ? 4 : 3, fill: 'currentColor', opacity: last ? 1 : 0.45 });
    const v = put(s, 'text', {
      x, y: 14, 'text-anchor': 'middle', 'font-size': 10,
      'font-weight': last ? 700 : 400, fill: 'currentColor', opacity: last ? 1 : 0.7,
    });
    v.textContent = p.value;
    const w = put(s, 'text', {
      x, y: 36, 'text-anchor': 'middle', 'font-size': 8.5, fill: 'currentColor', opacity: 0.6,
    });
    w.textContent = p.when;

  });
  box.appendChild(s);
  // The action lives OUTSIDE the drawing. The svg is aria-hidden — everything
  // it shows is already in the sentence — and a focusable element inside an
  // aria-hidden subtree is reachable by tab but invisible to a screen reader,
  // which is worse than either being present or absent.
  const now = d.points[d.points.length - 1];
  box.appendChild(act(el('button', 'aw-act aw-act-inline', `Re-read ${now.value} now`),
    { action: 're-read', label: now.value, arg: now,
      describedBy: `Read ${now.value} again from the page now` }));
  return box;
}

// ── 7. the airlock — a chamber ──────────────────────────────────────────────
//
// Everything that is about to be committed, sealed in one box with a single
// door. The corpus is blunt about why: after this the money has moved, and a
// checkpoint the agent can step over is narration.
function airlock(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.facts) || !d.facts.length) return null;
  const box = el('div', 'aw-shape aw-lock');
  if (d.headline) box.appendChild(el('p', 'aw-lock-head', d.headline));
  const list = el('ul', 'aw-lock-list');
  for (const fact of d.facts) {
    const li = el('li', `aw-lock-fact aw-${fact.ok === false ? 'no' : 'yes'}`);
    li.appendChild(el('span', 'aw-lock-what', fact.what));
    li.appendChild(el('span', 'aw-lock-val', fact.value));
    act(li, { action: 'change-fact', label: fact.what, arg: fact,
              describedBy: `Change ${fact.what}, currently ${fact.value}` });
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

// ── 12. the road not taken — a fork ─────────────────────────────────────────
//
// The pick and the rival it beat, in the same field order so the two can be
// compared by ear as well as by eye. Delegation's quietest loss is the option
// you were never told existed.
function fork(f) {
  const d = f.shape || {};
  if (!d.picked || !d.passed) return null;
  const box = el('div', 'aw-shape aw-fork');
  for (const [side, item] of [['picked', d.picked], ['passed over', d.passed]]) {
    const col = el('div', `aw-fork-side${side === 'picked' ? ' aw-fork-picked' : ''}`);
    col.appendChild(el('span', 'aw-fork-tag', side));
    col.appendChild(el('p', 'aw-fork-name', item.name));
    // Same fields in the same order on both sides — that ordering is what
    // makes them diffable without holding either in memory.
    for (const line of item.facts || []) col.appendChild(el('p', 'aw-fork-fact', line));
    if (side === 'passed over') {
      act(col, { action: 'open-other', label: item.name, arg: item,
                 describedBy: `Open ${item.name}, the one that was passed over` });
    }
    box.appendChild(col);
  }
  return box;
}

// ── 5. poke the world — a magnifier ─────────────────────────────────────────
//
// The page's exact words, re-read from the live page at a named moment, not
// recalled from the agent's account of it. The corpus's demand is verbatim:
// this is the one shape whose content must not be tidied, because tidying is
// the failure it exists to catch.
function magnifier(f) {
  const d = f.shape || {};
  if (!d.quote) return null;
  const box = el('div', 'aw-shape aw-mag');
  const q = el('blockquote', 'aw-mag-quote');
  q.textContent = d.quote;
  act(q, { action: 're-read', label: 'this text', arg: d,
           describedBy: 'Read this from the page again, right now' });
  box.appendChild(q);
  const foot = el('p', 'aw-mag-foot');
  foot.append(el('span', 'aw-mag-where', d.where || 'the live page'));
  // "live" and the time are the claim: this was read now, not remembered.
  foot.append(el('span', 'aw-mag-when', d.when ? `live · ${d.when}` : 'live'));
  box.appendChild(foot);
  return box;
}

// ── 8. rules from corrections — a switchboard ───────────────────────────────
//
// Every correction the person made, still on, and audible the moment it fires.
// A rule you cannot see is indistinguishable from a rule that quietly stopped
// working, which is why each switch shows what it has actually caught.
function switchboard(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.rules) || !d.rules.length) return null;
  const box = el('div', 'aw-shape aw-sw');
  const list = el('ul', 'aw-sw-list');
  for (const r of d.rules) {
    const li = el('li', `aw-sw-rule${r.fired ? ' aw-sw-fired' : ''}`);
    li.appendChild(el('span', 'aw-sw-toggle', r.on === false ? 'off' : 'on'));
    const body = el('div', 'aw-sw-body');
    body.appendChild(el('span', 'aw-sw-name', r.name));
    if (r.fired) body.appendChild(el('span', 'aw-sw-fired-note', r.fired));
    li.appendChild(body);
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

// ── 9. the auditor — a stamped sheet ────────────────────────────────────────
//
// Every line checked against a source the doer could not have written. That
// restriction is the whole paradigm: an agent confirming its own report is
// worth nothing, so only second sources appear here, each named.
function auditSheet(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.lines) || !d.lines.length) return null;
  const box = el('div', 'aw-shape aw-audit');
  box.appendChild(el('p', 'aw-audit-head', d.headline || 'Checked against other sources'));
  const list = el('ul', 'aw-audit-list');
  for (const l of d.lines) {
    const li = el('li', `aw-audit-line aw-${l.ok === false ? 'no' : l.ok ? 'yes' : 'unknown'}`);
    li.appendChild(el('span', 'aw-audit-src', l.source));
    li.appendChild(el('span', 'aw-audit-said', l.said));
    act(li, { action: 'check-source', label: l.source, arg: l,
              describedBy: `Check ${l.source} again` });
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

// ── 10. the escort — a numbered path ────────────────────────────────────────
//
// The agent drives the browser; the person makes the press. Used where the
// agent must not own the action — an irreversible control, a login wall — so
// the steps are numbered and the one the person owns is marked as theirs.
function path(f) {
  const d = f.shape || {};
  if (!Array.isArray(d.steps) || !d.steps.length) return null;
  const box = el('div', 'aw-shape aw-path');
  const list = el('ol', 'aw-path-list');
  d.steps.forEach((st, i) => {
    const li = el('li', `aw-path-step${st.yours ? ' aw-path-yours' : ''}`);
    li.appendChild(el('span', 'aw-path-n', String(i + 1)));
    const body = el('div', 'aw-path-body');
    body.appendChild(el('span', 'aw-path-what', st.what));
    body.appendChild(el('span', 'aw-path-who', st.yours ? 'you press' : 'I do this'));
    li.appendChild(body);
    act(li, { action: st.yours ? 'take-me-there' : 'do-step', label: st.what, arg: st,
              describedBy: st.yours ? `Take me to: ${st.what}` : `Do this step: ${st.what}` });
    list.appendChild(li);
  });
  box.appendChild(list);
  return box;
}

// ── 11. the world, rebuilt — a funnel ───────────────────────────────────────
//
// The corpus's 287-word cart readback against the one sentence that answers
// the question. The funnel shows the ratio, because the compression is the
// claim being made: everything discarded is still answerable, not gone.
function funnel(f) {
  const d = f.shape || {};
  if (!d.wasWords || !d.sentence) return null;
  const box = el('div', 'aw-shape aw-fun');

  const W = 300, H = 34;
  const s = svg(W, H, 'compression');
  put(s, 'polygon', {
    points: `0,2 ${W},14 ${W},20 0,32`, fill: 'currentColor', opacity: 0.15,
  });
  const a = put(s, 'text', { x: 2, y: 21, 'font-size': 9, fill: 'currentColor', opacity: 0.75 });
  a.textContent = `${d.wasWords} words`;
  const b = put(s, 'text', {
    x: W - 2, y: 20, 'text-anchor': 'end', 'font-size': 9,
    'font-weight': 700, fill: 'currentColor',
  });
  b.textContent = d.nowWords ? `${d.nowWords}` : '1 sentence';
  box.appendChild(s);

  box.appendChild(el('p', 'aw-fun-said', d.sentence));
  // Nothing is thrown away — the rest stays reachable by asking. Saying so is
  // what separates a summary from a loss.
  const rest = el('p', 'aw-fun-rest',
    d.rest || 'Everything else is still there — ask for any line.');
  act(rest, { action: 'expand', label: 'everything', arg: d,
              describedBy: `Read all ${d.wasWords} words, not the summary` });
  box.appendChild(rest);
  return box;
}

/** paradigm number → renderer. Missing numbers fall back to the sentence. */
export const SHAPES = {
  1: gauge,
  2: triangulation,
  3: diff,
  4: coverage,
  5: magnifier,
  6: timeline,
  7: airlock,
  8: switchboard,
  9: auditSheet,
  10: path,
  11: funnel,
  12: fork,
};

/**
 * Build the shape for a finding, or null if it has none.
 *
 * Never throws: a malformed shape must cost the geometry, not the finding. A
 * surface that reports problems cannot itself go blank on bad data.
 */
export function renderShape(f) {
  const make = SHAPES[f?.paradigm];
  if (!make) return null;
  try {
    return make(f);
  } catch (e) {
    console.warn('[AI4A11y] agent-watch: shape failed, falling back to text', e);
    return null;
  }
}

/** The CSS for every shape, sized from the person's type scale. */
export function shapeCss(id, base, muted, line, high, bg = '#fff') {
  const px = (n) => `${Math.round(base * n)}px`;
  return `
#${id} .aw-shape { margin: 7px 0 2px; color: inherit; }

/* Anything you can press. The hit target is the whole row, because a 6px dot
   is not a target — and every one of these is reachable by keyboard with a
   visible focus ring, since this surface is used by people who never see a
   hover state. */
#${id} .aw-act { cursor: pointer; border-radius: 5px; }
#${id} .aw-act:hover { background: rgba(0,0,0,.05); }
#${id} .aw-act:focus-visible { outline: 3px solid #06c; outline-offset: 1px; }
#${id} .aw-act::after {
  content: "›"; margin-left: 5px; opacity: .5; font-weight: 700;
}
#${id} .aw-act-inline {
  display: inline-block; margin-top: 7px; font: inherit;
  font-size: ${px(0.88)}; padding: 3px 10px; border: 1px solid ${line};
  border-radius: 999px; background: none; color: inherit;
}

/* 1 — proportion and marked scale */
#${id} .aw-prop svg, #${id} .aw-scale svg {
  display: block; overflow: visible; margin-top: 6px;
}
#${id} .aw-scale-src {
  margin: 2px 0 0; font-size: ${px(0.78)}; color: ${muted}; font-style: italic;
}

/* 2 — triangulation */
#${id} .aw-tri-claim { margin: 0 0 5px; font-style: italic; }
#${id} .aw-tri-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-tri-src {
  display: flex; gap: 7px; padding: 3px 0 3px 15px; position: relative;
  font-size: ${px(0.92)};
}
#${id} .aw-tri-src::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-tri-src.aw-yes::before { content: "+"; }
#${id} .aw-tri-src.aw-no::before { content: "−"; }
#${id} .aw-tri-src.aw-unknown::before { content: "?"; opacity: .55; }
#${id} .aw-tri-who { flex: 0 0 34%; color: ${muted}; }
#${id} .aw-tri-said { flex: 1 1 auto; }
#${id} .aw-tri-verdict {
  margin: 6px 0 0; padding-top: 5px; border-top: 1px solid ${line};
  font-weight: 600; font-size: ${px(0.92)};
}

/* 3 — diff */
#${id} .aw-diff-row {
  display: flex; gap: 8px; padding: 4px 0 4px 15px; position: relative;
  font-size: ${px(0.92)}; border-top: 1px solid ${line};
}
#${id} .aw-diff-row > span { flex: 1 1 50%; min-width: 0; overflow-wrap: anywhere; }
#${id} .aw-diff-head {
  border-top: 0; padding-left: 15px; color: ${muted};
  font-size: ${px(0.78)}; text-transform: uppercase; letter-spacing: .4px;
}
#${id} .aw-diff-row::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-diff-row.aw-yes::before { content: "="; }
#${id} .aw-diff-row.aw-no::before  { content: "≠"; }
#${id} .aw-diff-row.aw-unknown::before { content: "?"; opacity: .55; }
#${id} .aw-diff-mine { color: ${muted}; }
#${id} .aw-diff-row.aw-no .aw-diff-theirs { font-weight: 600; }

/* 4 — coverage */
#${id} .aw-cov-row {
  display: flex; align-items: center; gap: 8px; padding: 3px 0;
  font-size: ${px(0.92)};
}
#${id} .aw-cov-what { flex: 0 0 30%; color: ${muted}; }
#${id} .aw-cov-row svg { flex: 1 1 auto; }
#${id} .aw-cov-n { flex: 0 0 auto; font-variant-numeric: tabular-nums; }

/* 6 — timeline */
#${id} .aw-time svg { display: block; overflow: visible; }

/* 7 — airlock */
#${id} .aw-lock {
  border: ${high ? '2px' : '1px'} solid currentColor; border-radius: 8px;
  padding: 9px 11px;
}
#${id} .aw-lock-head { margin: 0 0 6px; font-weight: 600; font-size: ${px(0.92)}; }
#${id} .aw-lock-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-lock-fact {
  display: flex; gap: 8px; padding: 2px 0 2px 15px; position: relative;
  font-size: ${px(0.92)};
}
#${id} .aw-lock-fact::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-lock-fact.aw-yes::before { content: "✓"; }
#${id} .aw-lock-fact.aw-no::before  { content: "✗"; }
#${id} .aw-lock-what { flex: 0 0 42%; color: ${muted}; }

/* 5 — magnifier */
#${id} .aw-mag-quote {
  margin: 0; padding: 6px 0 6px 10px; border-left: 3px solid currentColor;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: ${px(0.88)};
}
#${id} .aw-mag-foot {
  display: flex; justify-content: space-between; gap: 8px;
  margin: 4px 0 0 13px; font-size: ${px(0.78)}; color: ${muted};
}

/* 8 — switchboard */
#${id} .aw-sw-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-sw-rule {
  display: flex; gap: 8px; align-items: baseline; padding: 3px 0;
  font-size: ${px(0.92)};
}
#${id} .aw-sw-toggle {
  flex: 0 0 auto; font-size: ${px(0.7)}; text-transform: uppercase;
  letter-spacing: .5px; border: 1px solid currentColor; border-radius: 3px;
  padding: 0 4px;
}
#${id} .aw-sw-body { display: flex; flex-direction: column; min-width: 0; }
#${id} .aw-sw-fired-note { color: ${muted}; font-size: ${px(0.84)}; }
#${id} .aw-sw-fired .aw-sw-name { font-weight: 600; }

/* 9 — audit sheet */
#${id} .aw-audit {
  border: 1px solid ${line}; border-radius: 8px; padding: 8px 10px;
}
#${id} .aw-audit-head {
  margin: 0 0 5px; font-size: ${px(0.78)}; text-transform: uppercase;
  letter-spacing: .4px; color: ${muted};
}
#${id} .aw-audit-list { list-style: none; margin: 0; padding: 0; }
#${id} .aw-audit-line {
  display: flex; gap: 8px; padding: 3px 0 3px 15px; position: relative;
  font-size: ${px(0.92)};
}
#${id} .aw-audit-line::before { position: absolute; left: 0; font-weight: 700; }
#${id} .aw-audit-line.aw-yes::before { content: "✓"; }
#${id} .aw-audit-line.aw-no::before  { content: "✗"; }
#${id} .aw-audit-line.aw-unknown::before { content: "?"; opacity: .55; }
#${id} .aw-audit-src { flex: 0 0 40%; color: ${muted}; }

/* 10 — numbered path */
#${id} .aw-path-list { list-style: none; margin: 0; padding: 0; counter-reset: p; }
#${id} .aw-path-step { display: flex; gap: 9px; padding: 4px 0; font-size: ${px(0.92)}; }
#${id} .aw-path-n {
  flex: 0 0 auto; width: ${px(1.35)}; height: ${px(1.35)}; line-height: ${px(1.35)};
  text-align: center; border-radius: 50%; border: 1px solid currentColor;
  font-size: ${px(0.74)};
}
#${id} .aw-path-body { display: flex; flex-direction: column; min-width: 0; }
#${id} .aw-path-who { font-size: ${px(0.78)}; color: ${muted}; }
/* The step the person owns is filled — so its digit must flip, or the number
   disappears on the one step that matters most. */
#${id} .aw-path-yours .aw-path-n { background: currentColor; color: ${bg}; }
#${id} .aw-path-yours .aw-path-what { font-weight: 600; }

/* 11 — funnel */
#${id} .aw-fun svg { display: block; }
#${id} .aw-fun-said { margin: 4px 0 0; font-weight: 600; }
#${id} .aw-fun-rest { margin: 3px 0 0; font-size: ${px(0.84)}; color: ${muted}; }

/* 12 — fork */
#${id} .aw-fork { display: flex; gap: 9px; }
#${id} .aw-fork-side {
  flex: 1 1 50%; min-width: 0; padding: 7px 9px;
  border: 1px solid ${line}; border-radius: 8px;
}
#${id} .aw-fork-picked { border-color: currentColor; }
#${id} .aw-fork-tag {
  display: block; font-size: ${px(0.74)}; text-transform: uppercase;
  letter-spacing: .4px; color: ${muted}; margin-bottom: 3px;
}
#${id} .aw-fork-name { margin: 0 0 3px; font-weight: 600; font-size: ${px(0.92)}; }
#${id} .aw-fork-fact { margin: 0; font-size: ${px(0.88)}; color: ${muted}; }
`;
}
