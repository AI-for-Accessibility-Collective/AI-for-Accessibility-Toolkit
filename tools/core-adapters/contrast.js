// Contrast: raises text contrast to at least WCAG AA (4.5:1, 3:1 for large text)
// where the page falls short, computing colours without AI, keeping the hue of each
// text colour. In 'yellow-black' mode, gives every text yellow on black through one
// stylesheet.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
//
// The person's settings it reads:
//   - contrastMode: 'light' (more contrast in page's own colours), 'yellow-black',
//     or 'none' / 'off'. With no contrastMode asked for, still fixes text below AA.
//   - darkMode: true when the person prefers a dark theme (used for default root
//     background fallback when transparent).
//
// What the person can adjust:
//   - Alt+Shift+C: cycles contrastMode between more contrast in the page's own colours
//     ('light'), yellow on black ('yellow-black'), and off ('none').
//   - Alt+Shift+V: saves the current contrastMode for every site ({ scope: 'all' }).
//   Announced to screen readers in plain words with s.announce().
//
// Options:
//   - mode: default contrastMode when none is set in profile (default: 'light').
//   - target: minimum contrast ratio for normal text (default: 4.5).
//   - largeTarget: minimum contrast ratio for large text (default: 3.0).
//
// Decisions it makes:
//   - Measures before changing: text that already meets the ratio is left alone.
//   - Keeps hue: converts colors to HSL and adjusts lightness only as much as needed
//     toward the endpoint (darker or lighter) that reaches the target ratio in fewer
//     steps, preserving the original hue angle and saturation.
//   - Computes colors deterministically without AI: fast, private, and consumes no
//     token budget.
//   - Detects real backgrounds: composites semi-transparent ancestor backgrounds over
//     an opaque base (white, or black when darkMode is active).
//   - Skips elements with background images or gradients where effective contrast
//     cannot be computed deterministically.
//   - Yellow-black mode uses a single stylesheet (s.css) forcing yellow text on black
//     backgrounds while leaving images, video, and canvas untouched.
//   - Handles text added later: watches the DOM with s.watch.added and fixes new
//     elements once without flicker.
//
// What it cannot do:
//   - Cannot compute text contrast over complex photographic images or canvas pixels.
//   - Does not alter images, video, or canvas graphics.

function parseColor(value) {
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
  if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0];
  return null;
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrastRatio(a, b) {
  const ca = Array.isArray(a) ? a : parseColor(a);
  const cb = Array.isArray(b) ? b : parseColor(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  h = (h % 360 + 360) % 360;
  h /= 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function isLargeText(el, win) {
  const style = win.getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 16;
  const weight = style.fontWeight;
  const bold = weight === 'bold' || weight === 'bolder' || (parseInt(weight, 10) || 400) >= 700;
  return fontSize >= 24 || (bold && fontSize >= 18.667);
}

function elementIntersects(elRect, ancestorRect) {
  return !(
    elRect.right <= ancestorRect.left ||
    elRect.left >= ancestorRect.right ||
    elRect.bottom <= ancestorRect.top ||
    elRect.top >= ancestorRect.bottom
  );
}

function hasBackgroundImage(element, win) {
  const elRect = element.getBoundingClientRect();
  let el = element;
  while (el && el.nodeType === 1) {
    const isRoot = el === win.document.documentElement || el === win.document.body;
    const nRect = isRoot ? null : el.getBoundingClientRect();
    if (isRoot || (nRect.width > 0 && nRect.height > 0 && elementIntersects(elRect, nRect))) {
      const style = win.getComputedStyle(el);
      const bgImg = style.backgroundImage;
      if (bgImg && bgImg !== 'none') return true;
      const c = parseColor(style.backgroundColor);
      if (c && c[3] >= 1) break;
    }
    if (el === win.document.documentElement) break;
    el = el.parentElement;
  }
  return false;
}

function getEffectiveBackground(el, win, isDark) {
  const elRect = el.getBoundingClientRect();
  const layers = [];
  let n = el;
  while (n && n.nodeType === 1) {
    const isRoot = n === win.document.documentElement || n === win.document.body;
    if (isRoot) {
      const style = win.getComputedStyle(n);
      const c = parseColor(style.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
      break;
    }
    const nRect = n.getBoundingClientRect();
    if (n === el || (nRect.width > 0 && nRect.height > 0 && elementIntersects(elRect, nRect))) {
      const style = win.getComputedStyle(n);
      const c = parseColor(style.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    n = n.parentElement;
  }
  let base = isDark ? [0, 0, 0] : [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) {
    const [r, g, b, a] = layers[i];
    base = [
      Math.round(r * a + base[0] * (1 - a)),
      Math.round(g * a + base[1] * (1 - a)),
      Math.round(b * a + base[2] * (1 - a)),
    ];
  }
  return base;
}

function adjustColorToMeetContrast(fg, bg, target) {
  if (contrastRatio(fg, bg) >= target) return null;

  const [h, s, l] = rgbToHsl(fg[0], fg[1], fg[2]);

  let darkCandidate = null;
  for (let i = 1; i <= 100; i++) {
    const newL = Math.max(0, l - (i / 100) * l);
    const candidate = hslToRgb(h, s, newL);
    if (contrastRatio(candidate, bg) >= target) {
      darkCandidate = { color: candidate, steps: i };
      break;
    }
  }

  let lightCandidate = null;
  for (let i = 1; i <= 100; i++) {
    const newL = Math.min(1, l + (i / 100) * (1 - l));
    const candidate = hslToRgb(h, s, newL);
    if (contrastRatio(candidate, bg) >= target) {
      lightCandidate = { color: candidate, steps: i };
      break;
    }
  }

  if (darkCandidate && lightCandidate) {
    return darkCandidate.steps <= lightCandidate.steps ? darkCandidate.color : lightCandidate.color;
  }
  if (darkCandidate) return darkCandidate.color;
  if (lightCandidate) return lightCandidate.color;

  const black = [0, 0, 0];
  const white = [255, 255, 255];
  return contrastRatio(black, bg) >= contrastRatio(white, bg) ? black : white;
}

const YELLOW_BLACK_CSS = `
html {
  background-color: #000000 !important;
}
*:not(img):not(video):not(canvas):not(svg):not(path) {
  background-color: #000000 !important;
  color: #ffff00 !important;
  border-color: #ffff00 !important;
}
a, a * {
  color: #ffff00 !important;
  text-decoration: underline !important;
}
button, input, select, textarea {
  background-color: #000000 !important;
  color: #ffff00 !important;
  border: 1px solid #ffff00 !important;
}
`;

export default {
  s: null,
  currentMode: 'light',
  modifiedElements: new Set(),
  modifiedRecords: [],

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;

    const s = (this.s = toolkit.session());
    const win = globalThis.window;
    const doc = win.document;

    const profileMode = s.profile.get('contrastMode');
    if (profileMode === 'none' || profileMode === 'off') {
      s.end();
      this.s = null;
      return false;
    }

    const initialMode = profileMode === 'yellow-black' ? 'yellow-black' : (options.mode || 'light');
    this.currentMode = initialMode;
    this.modifiedElements = new Set();
    this.modifiedRecords = [];

    const normalTarget = Number(options.target) || 4.5;
    const largeTarget = Number(options.largeTarget) || 3.0;

    const clearOwnFixes = () => {
      for (const rec of this.modifiedRecords) {
        if (rec.prevColor) {
          rec.el.style.setProperty('color', rec.prevColor, rec.prevPriority);
        } else {
          rec.el.style.removeProperty('color');
        }
        if (!rec.hadStyle && !rec.el.getAttribute('style')) {
          rec.el.removeAttribute('style');
        } else if (rec.hadStyle) {
          rec.el.setAttribute('style', rec.prevStyle);
        }
      }
      this.modifiedRecords = [];
      this.modifiedElements.clear();
    };

    const hasDirectText = (el) => {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.nodeValue.trim().length > 0) return true;
      }
      if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value.trim()) return true;
      return false;
    };

    const isNonTextElement = (el) => {
      return /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|CANVAS|VIDEO|IMG|AUDIO|IFRAME|OBJECT|EMBED|BR|HR|WBR)$/i.test(el.tagName);
    };

    const fixElement = (el) => {
      if (!s.alive() || !el || el.nodeType !== 1) return;
      if (this.modifiedElements.has(el)) return;
      if (isNonTextElement(el) || s.page.isOurs(el) || !s.page.isVisible(el)) return;
      if (!hasDirectText(el)) return;
      if (hasBackgroundImage(el, win)) return;

      const isDark = Boolean(s.profile.get('darkMode'));
      const bg = getEffectiveBackground(el, win, isDark);
      const colorStr = win.getComputedStyle(el).color;
      const fg = parseColor(colorStr);
      if (!fg || fg[3] === 0) return;

      const large = isLargeText(el, win);
      const target = large ? largeTarget : normalTarget;

      const newRgb = adjustColorToMeetContrast(fg, bg, target);
      if (!newRgb) return;

      const hadStyle = el.hasAttribute('style');
      const prevStyle = el.getAttribute('style');
      const prevColor = el.style.color;
      const prevPriority = el.style.getPropertyPriority('color');

      const fixedColorStr = `rgb(${newRgb[0]}, ${newRgb[1]}, ${newRgb[2]})`;
      s.setStyle(el, 'color', fixedColorStr, 'important');

      this.modifiedElements.add(el);
      this.modifiedRecords.push({ el, prevColor, prevPriority, hadStyle, prevStyle });
    };

    const fixSubtree = (root) => {
      if (!root || root.nodeType !== 1) return;
      if (this.currentMode !== 'light') return;
      fixElement(root);
      const descendants = root.querySelectorAll('*');
      for (let i = 0; i < descendants.length; i++) {
        fixElement(descendants[i]);
      }
    };

    const applyMode = (mode) => {
      this.currentMode = mode;
      if (mode === 'yellow-black') {
        clearOwnFixes();
        s.css('contrast-yellow-black', YELLOW_BLACK_CSS);
      } else if (mode === 'none' || mode === 'off') {
        clearOwnFixes();
        s.css('contrast-yellow-black', '');
      } else {
        s.css('contrast-yellow-black', '');
        fixSubtree(doc.body || doc.documentElement);
      }
    };

    applyMode(this.currentMode);

    s.watch.added(doc.body || doc.documentElement, (el) => {
      if (this.currentMode === 'light') {
        fixSubtree(el);
      }
    });

    s.keys.shortcut({ code: 'KeyC', alt: true, shift: true }, async () => {
      let nextMode;
      if (this.currentMode === 'light') {
        nextMode = 'yellow-black';
      } else if (this.currentMode === 'yellow-black') {
        nextMode = 'none';
      } else {
        nextMode = 'light';
      }
      applyMode(nextMode);
      await s.profile.set({ contrastMode: nextMode });

      if (nextMode === 'yellow-black') {
        s.announce('Contrast: yellow on black on this site. Press Alt+Shift+V to use on every site.');
      } else if (nextMode === 'none') {
        s.announce('Contrast: off on this site. Press Alt+Shift+V to use on every site.');
      } else {
        s.announce('Contrast: higher contrast in page colours on this site. Press Alt+Shift+V to use on every site.');
      }
    });

    s.keys.shortcut({ code: 'KeyV', alt: true, shift: true }, async () => {
      await s.profile.set({ contrastMode: this.currentMode }, { scope: 'all' });
      if (this.currentMode === 'yellow-black') {
        s.announce('Contrast: yellow on black on every site.');
      } else if (this.currentMode === 'none' || this.currentMode === 'off') {
        s.announce('Contrast: off on every site.');
      } else {
        s.announce('Contrast: higher contrast in page colours on every site.');
      }
    });

    s.profile.onChange((personal, changed) => {
      if (changed.contrastMode !== undefined) {
        const pMode = changed.contrastMode;
        const newMode = (pMode === 'none' || pMode === 'off') ? 'none' : (pMode === 'yellow-black' ? 'yellow-black' : 'light');
        if (newMode !== this.currentMode) applyMode(newMode);
      } else if (changed.darkMode !== undefined && this.currentMode === 'light') {
        clearOwnFixes();
        fixSubtree(doc.body || doc.documentElement);
      }
    });

    s.onEnd(() => {
      this.modifiedRecords = [];
      this.modifiedElements.clear();
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
