// Colour helpers for the blocks that draw: parse a CSS colour, find the
// background an element is drawn on, and the WCAG contrast ratio.

/** [r, g, b, a] from rgb()/rgba()/#hex, or null. */
export function parseColor(value) {
  const v = String(value || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  if (v === 'white') return [255, 255, 255, 1];
  if (v === 'black') return [0, 0, 0, 1];
  if (v === 'transparent') return [0, 0, 0, 0];
  return null;
}

const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio of two colours (strings or [r,g,b]), 1 to 21. */
export function contrast(a, b) {
  const ca = Array.isArray(a) ? a : parseColor(a);
  const cb = Array.isArray(b) ? b : parseColor(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour an element's text is drawn on: the first opaque background up
 *  its ancestors, white when there is none. */
export function backgroundOf(el, win) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = parseColor(win.getComputedStyle(n).backgroundColor);
    if (c && c[3] >= 0.5) return c;
  }
  return [255, 255, 255, 1];
}

/** The element's text colour, black when it cannot be read. */
export function textColorOf(el, win) {
  return parseColor(win.getComputedStyle(el).color) || [0, 0, 0, 1];
}

/** The first candidate with at least `min` contrast against `against`. */
export function pick(candidates, against, min) {
  return candidates.find((c) => contrast(c, against) >= min) || null;
}

export const hex = ([r, g, b]) => '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
