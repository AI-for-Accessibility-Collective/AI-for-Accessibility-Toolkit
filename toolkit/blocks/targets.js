// Block: targets, for controls too small to hit.
//
//   s.targets.room(els, { size, others, rects, within })
//       how far each element may grow on each side, measured once
//   s.targets.hitArea(el, entry, { attrs })  /  s.targets.hitAreas(map, { attrs })
//       a larger hit area that changes neither how the element looks nor where anything is
//
// room() decides from geometry only, the same way whatever order the
// elements come in: between two targets, each may take half the gap when the
// other also grows toward it, the whole gap when the other is already big
// enough on that axis, and nothing past the page's edge. So two grown boxes
// never overlap, and a later batch measured with the same rule never meets
// an earlier one. It also says whether the element's own box, grown that
// much, would be cut off by an ancestor that clips (`clipped`) and how many
// line boxes it has (`lines`), so that nothing has to be read again after a
// change.
//
// hitArea() uses a pseudo-element when the element can have one: one of
// ::after or ::before the page does not use (any rendered content counts,
// even ""), the element not clipping its own content and not cut off, and,
// when it is not positioned, making it position: relative moves nothing
// else (no absolutely positioned content or pseudo-element of its own, no
// offsets set). Otherwise an HTML ring around the element, never over it:
// anchored to it (CSS anchor positioning, so it follows scrolling and
// reflow), hidden when the element is scrolled or clipped out of view, and
// passing the pointer's presses and clicks on the ring to the element. The
// element itself is never covered, so its own hover, menus and touch work
// as before. Where the browser has no anchor positioning, no ring is made.

const REPLACED = /^(input|select|textarea|img|video|audio|iframe|canvas|object|embed|svg)$/i;
const FORWARD = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
const PSEUDO_CSS = `[data-ai4a11y-hit~="rel"] { position: relative !important; }
[data-ai4a11y-hit~="after"]::after, [data-ai4a11y-hit~="before"]::before { all: unset !important; content: "" !important; position: absolute !important; inset: var(--ai4a11y-hit) !important; }`;

const quarter = (v) => Math.max(0, Math.floor(v * 4) / 4);
const plain = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });

// Share `want` between two sides, centred where both have room, else moved to the side that has.
function split(want, a, b) {
  let x = Math.min(want / 2, a);
  const y = Math.min(want - x, b);
  x = Math.min(want - y, a);
  return [quarter(x), quarter(y)];
}

export function targetsBlock(s, env) {
  const { doc, win } = env;
  const made = new WeakMap();   // el -> { how, set(entry) }
  let styled = false;

  function pageBox() {
    const de = doc.documentElement;
    const sx = win.scrollX || 0, sy = win.scrollY || 0;
    return { left: -sx, top: -sy, right: Math.max(de.scrollWidth, de.clientWidth) - sx, bottom: Math.max(de.scrollHeight, de.clientHeight) - sy };
  }

  // Per axis, the nearest ancestor that clips on that axis: the area a box inside it can use
  // (all of a scroller's content, what is shown of one that hides overflow), and what it shows now.
  function clipOf(start, page, memo) {
    if (!start || start === doc.body || start === doc.documentElement || start.nodeType !== 1) return { x: page, y: page, vx: page, vy: page, nx: null, ny: null };
    if (memo.has(start)) return memo.get(start);
    const up = clipOf(start.parentElement, page, memo);
    let out = up;
    let cs = null;
    try { cs = win.getComputedStyle(start); } catch { /* not an element we can read */ }
    const cx = cs && cs.overflowX !== 'visible', cy = cs && cs.overflowY !== 'visible';
    if (cx || cy) {
      const r = start.getBoundingClientRect();
      const vl = r.left + start.clientLeft, vt = r.top + start.clientTop;
      const shown = { left: vl, top: vt, right: vl + start.clientWidth, bottom: vt + start.clientHeight };
      const scrolls = (o) => o === 'auto' || o === 'scroll';
      const area = { left: scrolls(cs.overflowX) ? vl - start.scrollLeft : vl, top: scrolls(cs.overflowY) ? vt - start.scrollTop : vt };
      area.right = scrolls(cs.overflowX) ? area.left + Math.max(start.scrollWidth, start.clientWidth) : shown.right;
      area.bottom = scrolls(cs.overflowY) ? area.top + Math.max(start.scrollHeight, start.clientHeight) : shown.bottom;
      if (cx) out = { ...out, x: area, vx: shown, nx: start };
      if (cy) out = { ...out, y: area, vy: shown, ny: start };
    }
    memo.set(start, out);
    return out;
  }

  function room(els, { size = 24, others = [], rects = null, within = null } = {}) {
    const S = Number(size) > 0 ? Number(size) : 24;
    const out = new Map();
    const R = new Map();
    for (const el of [...els, ...others]) {
      if (!el || R.has(el) || !el.isConnected) continue;
      R.set(el, (rects && rects.get(el)) || plain(el.getBoundingClientRect()));
    }
    const page = within || pageBox();
    const de = doc.documentElement;
    const view = within || { left: 0, top: 0, right: de.clientWidth, bottom: de.clientHeight };
    const memo = new Map();
    const clipFor = (el) => {
      let fixed = false;
      try { fixed = win.getComputedStyle(el).position === 'fixed'; } catch { /* keep the page's box */ }
      return fixed ? { x: view, y: view, vx: view, vy: view, nx: null, ny: null, fixed } : { ...clipOf(el.parentElement, page, memo), fixed };
    };
    const all = [...R].map(([o, q]) => [o, q, clipFor(o)]);
    const edge = (r, b, wx, wy) => ({
      left: Math.min(wx, Math.max(0, r.left - b.x.left)), right: Math.min(wx, Math.max(0, b.x.right - r.right)),
      top: Math.min(wy, Math.max(0, r.top - b.y.top)), bottom: Math.min(wy, Math.max(0, b.y.bottom - r.bottom)),
    });
    for (const el of els) {
      const r = R.get(el);
      if (!r) continue;
      const c = clipFor(el);
      const bound = c.fixed ? view : page;
      const wx = Math.max(0, S - r.width), wy = Math.max(0, S - r.height);
      const cap = edge(r, { x: bound, y: bound }, wx, wy);
      if (wx || wy) {
        for (const [o, full, oc] of all) {
          if (o === el || o.contains(el) || el.contains(o)) continue;
          // A neighbour counts where it can be seen from here: what a scroller or clip it is in, and
          // this element is not, shows of it (one scrolled out of view is not next to this one).
          const sx = oc.nx && !oc.nx.contains(el), sy = oc.ny && !oc.ny.contains(el);
          const q = {
            left: sx ? Math.max(full.left, oc.vx.left) : full.left, right: sx ? Math.min(full.right, oc.vx.right) : full.right,
            top: sy ? Math.max(full.top, oc.vy.top) : full.top, bottom: sy ? Math.min(full.bottom, oc.vy.bottom) : full.bottom,
            width: full.width, height: full.height,
          };
          if (q.right <= q.left || q.bottom <= q.top) continue;
          const gx = Math.max(q.left - r.right, r.left - q.right);
          const gy = Math.max(q.top - r.bottom, r.top - q.bottom);
          if (gx >= 2 * S || gy >= 2 * S) continue;
          // Kept apart on the axis with the larger gap; each side the same for both.
          if (gx >= gy) {
            const g = quarter(Math.max(0, gx) * (q.width < S ? 0.5 : 1));
            if (q.left + q.right > r.left + r.right) cap.right = Math.min(cap.right, g); else cap.left = Math.min(cap.left, g);
          } else {
            const g = quarter(Math.max(0, gy) * (q.height < S ? 0.5 : 1));
            if (q.top + q.bottom > r.top + r.bottom) cap.bottom = Math.min(cap.bottom, g); else cap.top = Math.min(cap.top, g);
          }
        }
      }
      // Inside what clips it where that is enough (toward the side with room); past it only to reach more.
      const inner = edge(r, c, wx, wy);
      const fit = (k) => Math.min(cap[k], inner[k]);
      let [left, right] = split(wx, fit('left'), fit('right'));
      let [top, bottom] = split(wy, fit('top'), fit('bottom'));
      let clipped = false;
      const [l2, r2] = split(wx, cap.left, cap.right);
      const [t2, b2] = split(wy, cap.top, cap.bottom);
      if (l2 + r2 > left + right || t2 + b2 > top + bottom) {
        [left, right, top, bottom] = [l2, r2, t2, b2];
        clipped = r.left - left < c.x.left - 0.5 || r.right + right > c.x.right + 0.5 || r.top - top < c.y.top - 0.5 || r.bottom + bottom > c.y.bottom + 0.5;
      }
      out.set(el, { rect: r, top, right, bottom, left, clipped, lines: el.getClientRects().length });
    }
    return out;
  }

  const used = (el, which) => {
    try { const c = win.getComputedStyle(el, which).content; return !!c && c !== 'none' && c !== 'normal'; } catch { return true; }
  };

  // Which pseudo-element can be the hit area, and whether the element must become positioned for it.
  function pseudoFor(el, cs) {
    if (REPLACED.test(el.tagName) || (win.SVGElement && el instanceof win.SVGElement)) return null;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return null;
    const which = !used(el, '::after') ? 'after' : !used(el, '::before') ? 'before' : null;
    if (!which) return null;
    if (cs.position !== 'static') return { which, rel: false };
    // position: relative would move what is positioned against an ancestor now.
    if (['top', 'right', 'bottom', 'left'].some((p) => cs[p] !== 'auto')) return null;
    const other = which === 'after' ? '::before' : '::after';
    try { if (used(el, other) && win.getComputedStyle(el, other).position === 'absolute') return null; } catch { return null; }
    for (const d of el.querySelectorAll('*')) {
      try { if (win.getComputedStyle(d).position === 'absolute') return null; } catch { return null; }
    }
    return { which, rel: true };
  }

  const ringStyle = (name, e, cursor) => [
    'all: unset', 'position: absolute', `position-anchor: ${name}`,
    `top: calc(anchor(top) - ${e.top}px)`, `left: calc(anchor(left) - ${e.left}px)`,
    `bottom: calc(anchor(bottom) - ${e.bottom}px)`, `right: calc(anchor(right) - ${e.right}px)`,
    'position-visibility: anchors-visible', `cursor: ${cursor || 'pointer'}`,
    // A hole where the element is: the ring never covers it.
    `clip-path: polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${e.left}px ${e.top}px, ${e.left}px calc(100% - ${e.bottom}px), calc(100% - ${e.right}px) calc(100% - ${e.bottom}px), calc(100% - ${e.right}px) ${e.top}px, ${e.left}px ${e.top}px)`,
  ].map((d) => `${d} !important`).join('; ');

  function makeRing(el, cs, e, attrs) {
    const parent = el.parentNode;
    if (!parent || parent.nodeType !== 1 || (win.SVGElement && parent instanceof win.SVGElement)) return null;
    if (!(win.CSS && win.CSS.supports && win.CSS.supports('anchor-name: --a'))) return null;
    const name = `--ai4a11y-hit-${env.shared.nextId++}`;
    const theirs = cs.anchorName && cs.anchorName !== 'none' ? `${cs.anchorName}, ` : '';
    s.setStyle(el, 'anchor-name', theirs + name, 'important');
    const ring = s.el('span', { attrs: { 'aria-hidden': 'true', ...(attrs || {}) }, kind: 'hit' });
    const cursor = cs.cursor;
    ring.style.cssText = ringStyle(name, e, cursor);
    const forward = (ev) => {
      ev.stopPropagation();
      if (ev.type === 'mousedown') {
        ev.preventDefault();
        if (typeof el.focus === 'function') el.focus({ preventScroll: true });
      }
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(ev.clientX, r.left + 0.5), r.right - 0.5);
      const y = Math.min(Math.max(ev.clientY, r.top + 0.5), r.bottom - 0.5);
      const Ctor = win.PointerEvent && ev instanceof win.PointerEvent ? win.PointerEvent : win.MouseEvent;
      el.dispatchEvent(new Ctor(ev.type, {
        bubbles: true, cancelable: true, composed: true, view: win, detail: ev.detail,
        clientX: x, clientY: y, screenX: ev.screenX + x - ev.clientX, screenY: ev.screenY + y - ev.clientY,
        button: ev.button, buttons: ev.buttons, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey,
        pointerId: ev.pointerId, pointerType: ev.pointerType, isPrimary: ev.isPrimary, width: ev.width, height: ev.height, pressure: ev.pressure,
      }));
    };
    for (const type of FORWARD) s.listen(ring, type, forward);
    s.insert(parent, ring, el.nextSibling);
    return { how: 'ring', ring, set: (next) => { ring.style.cssText = ringStyle(name, next, cursor); } };
  }

  function hitAreas(entries, { attrs } = {}) {
    const result = new Map();
    if (!s.alive()) return result;
    const plan = [];
    // Read everything first, then write: one style pass for the lot.
    for (const [el, e] of entries) {
      if (!el || !el.isConnected || !e) { result.set(el, null); continue; }
      const had = made.get(el);
      if (had) { plan.push({ el, e, had }); continue; }
      if (e.lines > 1 || !(e.top || e.right || e.bottom || e.left)) { result.set(el, null); continue; }
      let cs;
      try { cs = win.getComputedStyle(el); } catch { result.set(el, null); continue; }
      plan.push({ el, e, cs, pseudo: e.clipped ? null : pseudoFor(el, cs) });
    }
    for (const { el, e, had, cs, pseudo } of plan) {
      if (had) { had.set(e); result.set(el, had.how); continue; }
      let m = null;
      if (pseudo) {
        if (!styled) { s.css('ai4a11y-hit', PSEUDO_CSS); styled = true; }
        s.setAttr(el, 'data-ai4a11y-hit', pseudo.rel ? `${pseudo.which} rel` : pseudo.which);
        const set = (next) => s.setStyle(el, '--ai4a11y-hit', `-${next.top}px -${next.right}px -${next.bottom}px -${next.left}px`);
        set(e);
        m = { how: 'pseudo', set };
      } else {
        m = makeRing(el, cs, e, typeof attrs === 'function' ? attrs(el) : attrs);
      }
      if (m) made.set(el, m);
      result.set(el, m ? m.how : null);
    }
    return result;
  }

  const hitArea = (el, entry, options) => hitAreas(new Map([[el, entry]]), options).get(el) ?? null;

  return { room, hitArea, hitAreas };
}
