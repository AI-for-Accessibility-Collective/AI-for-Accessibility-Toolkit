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

const put = (parent, tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
};

// ── 1. the glance, translated — a gauge ─────────────────────────────────────
//
// The tutor's scale. A count is meaningless until it is placed: 0 is a dead
// end, a few hundred means the query landed, four figures means it is too
// loose. The needle does the judging that the number alone leaves to you.
function gauge(f) {
  const d = f.shape || {};
  const box = el('div', 'aw-shape aw-gauge');
  const n = Number(d.value);
  if (!Number.isFinite(n)) return null;

  const W = 300, H = 46;
  const s = svg(W, H, 'count on a scale');
  // Log scale: the interesting range spans 0 to 10,000 and a linear axis puts
  // every real search in the leftmost tenth.
  const x = (v) => 8 + (Math.log10(Math.max(v, 1)) / 4) * (W - 16);

  const zones = d.zones || [
    { to: 1, label: 'dead end' },
    { to: 800, label: 'right' },
    { to: 10000, label: 'too loose' },
  ];
  let from = 0;
  zones.forEach((z, i) => {
    put(s, 'rect', {
      x: x(from), y: 16, width: Math.max(2, x(z.to) - x(from)), height: 7,
      fill: 'currentColor', opacity: i === 1 ? 0.5 : 0.16,
    });
    const t = put(s, 'text', {
      x: (x(from) + x(z.to)) / 2, y: 38, 'text-anchor': 'middle',
      'font-size': 9, fill: 'currentColor', opacity: 0.65,
    });
    t.textContent = z.label;
    from = z.to;
  });

  // the needle
  put(s, 'line', { x1: x(n), y1: 8, x2: x(n), y2: 27, stroke: 'currentColor', 'stroke-width': 2 });
  put(s, 'polygon', {
    points: `${x(n) - 4},8 ${x(n) + 4},8 ${x(n)},14`, fill: 'currentColor',
  });
  const v = put(s, 'text', {
    x: Math.min(W - 4, Math.max(14, x(n))), y: 6, 'text-anchor': 'middle',
    'font-size': 10, 'font-weight': 700, fill: 'currentColor',
  });
  v.textContent = d.display || String(n);

  box.appendChild(s);
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
    box.appendChild(col);
  }
  return box;
}

/** paradigm number → renderer. Missing numbers fall back to the sentence. */
export const SHAPES = {
  1: gauge,
  2: triangulation,
  3: diff,
  4: coverage,
  6: timeline,
  7: airlock,
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
export function shapeCss(id, base, muted, line, high) {
  const px = (n) => `${Math.round(base * n)}px`;
  return `
#${id} .aw-shape { margin: 7px 0 2px; color: inherit; }

/* 1 — gauge */
#${id} .aw-gauge svg { display: block; overflow: visible; margin-top: 8px; }

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
