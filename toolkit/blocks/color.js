// Colour helpers for the blocks that draw: parse a CSS colour, find the
// background an element is drawn on, the WCAG contrast ratio, and the
// nearest colour of the same hue that has enough of it.

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

const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, sat, l];
};
const fromHsl = ([h, sat, l]) => {
  if (!sat) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255].map(Math.round);
};

/** The colour nearest `fg` with its hue and saturation, darker or lighter
 *  (away from `bg`), that has at least `min` contrast against `bg`; `fg`
 *  itself when it already has; black or white when no shade of it does. */
export function nearestWithContrast(fg, bg, min) {
  const f = Array.isArray(fg) ? fg : parseColor(fg);
  const b = Array.isArray(bg) ? bg : parseColor(bg);
  if (!f || !b) return null;
  if (contrast(f, b) >= min) return f.slice(0, 3);
  const [h, sat, l] = toHsl(f);
  // Darker on a light background, lighter on a dark one; the other way if that cannot reach it.
  const dark = luminance(b) > 0.18;
  for (const toward of dark ? [0, 1] : [1, 0]) {
    if (contrast(fromHsl([h, sat, toward]), b) < min) continue;
    let lo = l, hi = toward; // lo fails, hi passes
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(fromHsl([h, sat, mid]), b) >= min) hi = mid; else lo = mid;
    }
    return fromHsl([h, sat, hi]);
  }
  return contrast([0, 0, 0], b) >= contrast([255, 255, 255], b) ? [0, 0, 0] : [255, 255, 255];
}
