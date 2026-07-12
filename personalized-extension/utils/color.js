// utils/color.js — thin colorjs.io wrapper for CSS Color 4 parsing and WCAG
// contrast math.  Uses the tree-shakeable /fn procedural API so only the
// color-spaces and algorithms we actually need land in the bundle.
//
// Exported API (new):
//   parseColor(cssString)            → colorjs PlainColorObject | null
//   contrastWCAG21(fg, bg)           → number (WCAG 2.x ratio)
//   meetsContrastAA(fg, bg, opts)    → boolean (4.5:1 / 3:1 for largeText)
//   compositeOver(fg, bg)            → PlainColorObject (alpha-aware composite)
//   nearestAccessibleColor(fg, bg, opts) → sRGB hex string, hue-preserving
//   contrastAPCA(fg, bg)             → number  (advisory only — NOT for pass/fail)
//
// Legacy shims (kept so existing callers don't break):
//   getLuminance(cssString)          → number | null
//   getContrastRatio(c1, c2)         → number | null
//   getEffectiveBackground(element)  → sRGB string  (unchanged signature; still
//                                       browser-only — call from content scripts)
//   rgbToHex(r,g,b)                  → hex string

// ---------------------------------------------------------------------------
// Colorjs.io /fn barrel — the only valid export path for the procedural API.
// "colorjs.io/fn" resolves to src/index-fn.js which re-exports all spaces
// and functions.  Sub-paths like "colorjs.io/fn/spaces/srgb" are NOT in the
// package exports map and fail at bundle time.
// ---------------------------------------------------------------------------
import {
  parse,
  to,
  toGamut,
  set as colorSet,
  clone as colorClone,
  ColorSpace,
  // Spaces — bundled in the fn barrel
  sRGB,
  sRGB_Linear,
  XYZ_D65,
  XYZ_D50,
  OKLab,
  OKLCH,
  Lab,
  LCH,
  HSL,
  HWB,
  // Contrast algorithms
  contrastWCAG21 as _wcagContrast,
  contrastAPCA as _apcaContrast,
  getLuminance as _cjsLuminance,
} from 'colorjs.io/fn';

// Register all spaces so parse() can understand every common CSS color format.
// This is idempotent — registering an already-registered space is a no-op.
[sRGB, sRGB_Linear, XYZ_D65, XYZ_D50, OKLab, OKLCH, Lab, LCH, HSL, HWB].forEach(s => {
  if (s && s.id) {
    try { ColorSpace.register(s); } catch { /* already registered */ }
  }
});

// ---------------------------------------------------------------------------
// parseColor
// ---------------------------------------------------------------------------
/**
 * Parse any CSS color string (hex, rgb/rgba, hsl/hsla, oklch, lab, named …)
 * into a colorjs PlainColorObject.  Returns null for transparent / empty.
 *
 * @param {string} cssString
 * @returns {object | null}
 */
export function parseColor(cssString) {
  if (!cssString) return null;
  const s = String(cssString).trim();
  if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)' || s === 'rgba(0,0,0,0)') return null;
  try {
    return parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// contrastWCAG21
// ---------------------------------------------------------------------------
/**
 * WCAG 2.x contrast ratio between two CSS color strings or colorjs objects.
 * Returns null when either color cannot be parsed.
 *
 * @param {string | object} fg
 * @param {string | object} bg
 * @returns {number | null}
 */
export function contrastWCAG21(fg, bg) {
  const fgColor = typeof fg === 'string' ? parseColor(fg) : fg;
  const bgColor = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!fgColor || !bgColor) return null;
  try {
    return _wcagContrast(fgColor, bgColor);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// meetsContrastAA
// ---------------------------------------------------------------------------
/**
 * WCAG 2.x AA pass check.  Thresholds: 4.5:1 normal text, 3:1 large text.
 *
 * @param {string | object} fg
 * @param {string | object} bg
 * @param {{ largeText?: boolean }} [opts]
 * @returns {boolean}
 */
export function meetsContrastAA(fg, bg, { largeText = false } = {}) {
  const ratio = contrastWCAG21(fg, bg);
  if (ratio === null) return false;
  return ratio >= (largeText ? 3 : 4.5);
}

// ---------------------------------------------------------------------------
// compositeOver — alpha-aware Porter-Duff SRC-OVER
// ---------------------------------------------------------------------------
/**
 * Composite a (possibly translucent) foreground color over an opaque
 * background, both as CSS strings or colorjs objects.  Returns a fully-opaque
 * sRGB PlainColorObject.
 *
 * @param {string | object} fg   may have alpha < 1
 * @param {string | object} bg   treated as opaque (alpha clamped to 1)
 * @returns {object}
 */
export function compositeOver(fg, bg) {
  const fgColor = typeof fg === 'string' ? parseColor(fg) : fg;
  const bgColor = typeof bg === 'string' ? parseColor(bg) : bg;

  if (!fgColor || !bgColor) {
    if (bgColor) return to(bgColor, 'srgb');
    return parse('white');
  }

  const fgSRGB = to(fgColor, 'srgb');
  const bgSRGB = to(bgColor, 'srgb');

  const alpha = fgSRGB.alpha ?? 1;
  if (alpha >= 1) return fgSRGB;

  const bgAlpha = bgSRGB.alpha ?? 1;
  const outAlpha = alpha + bgAlpha * (1 - alpha);

  const fgCoords = fgSRGB.coords;
  const bgCoords = bgSRGB.coords;

  const outCoords = fgCoords.map((fc, i) => {
    const bc = bgCoords[i];
    if (outAlpha === 0) return 0;
    return ((fc ?? 0) * alpha + (bc ?? 0) * bgAlpha * (1 - alpha)) / outAlpha;
  });

  return { space: sRGB, coords: outCoords, alpha: outAlpha };
}

// ---------------------------------------------------------------------------
// nearestAccessibleColor — deterministic OKLCH lightness stepping
// ---------------------------------------------------------------------------
/**
 * Find the nearest OKLCH-lightness-stepped color for fg that meets the WCAG
 * AA contrast threshold against bg.  Hue and chroma are preserved; the result
 * is gamut-mapped to sRGB and serialized as "rgb(r g b)".
 *
 * Handles white-on-white (step toward black) and black-on-black (step toward
 * white) extremes.
 *
 * @param {string | object}  fg
 * @param {string | object}  bg
 * @param {{ target?: number }} [opts]  target contrast ratio (default 4.5)
 * @returns {string}  serialized sRGB color, e.g. "rgb(42 42 42)"
 */
export function nearestAccessibleColor(fg, bg, { target = 4.5 } = {}) {
  const fgColor = typeof fg === 'string' ? parseColor(fg) : fg;
  const bgColor = typeof bg === 'string' ? parseColor(bg) : bg;

  if (!fgColor) return _fallbackColor(bgColor);

  // Composite fg alpha over bg first so we work with the perceived color
  const bgResolved = bgColor ? to(compositeOver(bgColor, parse('white')), 'srgb') : parse('white');
  const fgOpaque = to(compositeOver(fgColor, bgResolved), 'srgb');

  const currentRatio = contrastWCAG21(fgOpaque, bgResolved);
  if (currentRatio !== null && currentRatio >= target) {
    return _serializeSRGB(fgOpaque);
  }

  const fgOKLCH = to(fgOpaque, 'oklch');
  const currentL = fgOKLCH.coords[0] ?? 0.5;

  const STEP = 0.005;
  const MAX_STEPS = 220;
  // Add a small margin above the target to survive _serializeSRGB rounding.
  const TARGET_WITH_MARGIN = target + 0.08;

  let darkCandidate = null;
  let lightCandidate = null;

  // Step toward 0 (darker)
  {
    const trial = colorClone(fgOKLCH);
    let l = currentL;
    for (let i = 0; i < MAX_STEPS; i++) {
      l = Math.max(0, l - STEP);
      colorSet(trial, 'oklch.l', l);
      const inSRGB = toGamut(to(trial, 'srgb'));
      const ratio = contrastWCAG21(inSRGB, bgResolved);
      if (ratio !== null && ratio >= TARGET_WITH_MARGIN) { darkCandidate = { color: inSRGB, l }; break; }
      if (l <= 0) break;
    }
  }

  // Step toward 1 (lighter)
  {
    const trial = colorClone(fgOKLCH);
    let l = currentL;
    for (let i = 0; i < MAX_STEPS; i++) {
      l = Math.min(1, l + STEP);
      colorSet(trial, 'oklch.l', l);
      const inSRGB = toGamut(to(trial, 'srgb'));
      const ratio = contrastWCAG21(inSRGB, bgResolved);
      if (ratio !== null && ratio >= TARGET_WITH_MARGIN) { lightCandidate = { color: inSRGB, l }; break; }
      if (l >= 1) break;
    }
  }

  if (!darkCandidate && !lightCandidate) return _fallbackColor(bgResolved);
  if (!darkCandidate) return _serializeSRGB(lightCandidate.color);
  if (!lightCandidate) return _serializeSRGB(darkCandidate.color);

  const darkDelta = Math.abs(currentL - darkCandidate.l);
  const lightDelta = Math.abs(currentL - lightCandidate.l);
  return _serializeSRGB(darkDelta <= lightDelta ? darkCandidate.color : lightCandidate.color);
}

function _fallbackColor(bgColor) {
  if (!bgColor) return 'rgb(0 0 0)';
  const bgParsed = typeof bgColor === 'string' ? parseColor(bgColor) : bgColor;
  if (!bgParsed) return 'rgb(0 0 0)';
  try {
    const whiteRatio = _wcagContrast(bgParsed, parse('white'));
    return whiteRatio >= 4.5 ? 'rgb(255 255 255)' : 'rgb(0 0 0)';
  } catch {
    return 'rgb(0 0 0)';
  }
}

function _serializeSRGB(color) {
  const inSRGB = to(color, 'srgb');
  const r = Math.round(Math.min(255, Math.max(0, (inSRGB.coords[0] ?? 0) * 255)));
  const g = Math.round(Math.min(255, Math.max(0, (inSRGB.coords[1] ?? 0) * 255)));
  const b = Math.round(Math.min(255, Math.max(0, (inSRGB.coords[2] ?? 0) * 255)));
  return `rgb(${r} ${g} ${b})`;
}

// ---------------------------------------------------------------------------
// contrastAPCA — advisory only, NOT used for pass/fail
// ---------------------------------------------------------------------------
/**
 * APCA Lc contrast value (advisory only).  WCAG 3 has not adopted APCA as
 * normative; WCAG 2.x (contrastWCAG21 / meetsContrastAA) remains normative.
 *
 * @param {string | object} fg
 * @param {string | object} bg
 * @returns {number | null}
 */
export function contrastAPCA(fg, bg) {
  const fgColor = typeof fg === 'string' ? parseColor(fg) : fg;
  const bgColor = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!fgColor || !bgColor) return null;
  try {
    // colorjs.io APCA signature: contrastAPCA(background, foreground)
    return _apcaContrast(bgColor, fgColor);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy shims — preserved so nothing else breaks
// ---------------------------------------------------------------------------

/**
 * @deprecated Use contrastWCAG21 / parseColor instead.
 * Returns relative luminance (0–1) of a CSS color string, or null.
 */
export function getLuminance(cssString) {
  const color = parseColor(cssString);
  if (!color) return null;
  try {
    return Math.max(0, _cjsLuminance(color));
  } catch {
    return null;
  }
}

/**
 * @deprecated Use contrastWCAG21 instead.
 * Returns WCAG 2.x contrast ratio between two CSS color strings, or null.
 */
export function getContrastRatio(color1, color2) {
  return contrastWCAG21(color1, color2);
}

/**
 * Walk DOM ancestors compositing alpha stops, return the effective background
 * as a CSS rgb() string.  Falls back to white only when no background found.
 * Handles documentElement background too.
 * Browser-only — do not call in Node unit tests.
 *
 * @param {Element} element
 * @returns {string}
 */
export function getEffectiveBackground(element) {
  const stack = [];
  let el = element.parentElement || element;

  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const parsed = parseColor(bg);
      if (parsed) {
        stack.push(parsed);
        if ((parsed.alpha ?? 1) >= 1) break;
      }
    }
    el = el.parentElement;
  }

  if (stack.length === 0) return 'rgb(255 255 255)';

  let composite = parse('white');
  for (let i = stack.length - 1; i >= 0; i--) {
    composite = compositeOver(stack[i], composite);
  }
  return _serializeSRGB(composite);
}

/**
 * @param {number} r  0–255
 * @param {number} g  0–255
 * @param {number} b  0–255
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}
