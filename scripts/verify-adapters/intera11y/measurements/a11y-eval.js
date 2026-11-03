'use strict';

function relLuminance([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatioRaw(rgb1, rgb2) {
  const a = relLuminance(rgb1), b = relLuminance(rgb2);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
function contrastRatio(rgb1, rgb2) {
  return +contrastRatioRaw(rgb1, rgb2).toFixed(2);
}
function parseRGB(s) {
  const m = (s || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;

  const p = m[1].split(/[\s,/]+/).map((x) => parseFloat(x)).filter((n) => !Number.isNaN(n));
  if (p.length < 3) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

const PT_TO_PX = 96 / 72;
const LARGE_NORMAL_PX = 18 * PT_TO_PX;
const LARGE_BOLD_PX = 14 * PT_TO_PX;
function isLargeText(fontPx, fontWeight) {
  const fw = parseInt(fontWeight, 10) || 400;
  if (!(fontPx > 0)) return false;
  return fontPx >= LARGE_NORMAL_PX || (fontPx >= LARGE_BOLD_PX && fw >= 700);
}
function contrastThresholdFor(fontPx, fontWeight) {
  return isLargeText(fontPx, fontWeight) ? 3.0 : 4.5;
}

const TARGET_MIN = 24;
const TARGET_R = 12;
function _circleRectIntersect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
function _circleCircleIntersect(cx1, cy1, r1, cx2, cy2, r2) {
  const dx = cx1 - cx2, dy = cy1 - cy2;
  return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
}

function _ts(verdict, reason, minDim, extra) { return { verdict, passes: verdict === 'pass', requiresJudgment: verdict === 'needs-judgment', reason, minDim, ...(extra || {}) }; }

function _square24Fits(w, h, r) { const need = 24 + 0.586 * (r || 0); return w >= need && h >= need; }
function evalTargetSize(box, opts = {}) {
  const w = box ? box.w : 0, h = box ? box.h : 0;
  const minDim = Math.min(w, h);
  if (!(w > 0) || !(h > 0)) return _ts('pass', 'zero-size/hidden — not a rendered target', minDim);

  const cornerR = opts.cornerRadius || 0;
  const shapeBlocksSquare = !!opts.transformed || !!opts.clipped || (cornerR > 0 && !_square24Fits(w, h, cornerR));
  if (w >= TARGET_MIN && h >= TARGET_MIN) {

    if (opts.squareFits === true) return _ts('pass', 'meets 24×24 — a page-aligned 24×24 square is densely hit-tested fully on-target', minDim);
    if (opts.squareFits === false) return _ts('needs-judgment', 'bbox ≥24×24 but a page-aligned 24×24 square is NOT fully on the target (clip/overflow/rounded/SVG/obscured/non-rect — hit-tested)', minDim, { shapeUncertain: true });
    const why = shapeBlocksSquare ? 'transform/clip/radius present' : 'hit-area could not be measured';
    return _ts('needs-judgment', `bbox ≥24×24 but a continuous 24×24 solid area is unproven (${why}) — confirm a page-aligned 24×24 square fits`, minDim, { shapeUncertain: true });
  }
  if (opts.essential) return _ts('pass', 'essential exception', minDim);
  if (opts.uaControl) return _ts('pass', 'user-agent control exception (unmodified default-sized native control)', minDim);

  const inlineCandidate = !!opts.inlineCandidate;
  const neighbors = Array.isArray(opts.neighbors) ? opts.neighbors : null;
  if (neighbors) {
    const cx = (box.x || 0) + w / 2, cy = (box.y || 0) + h / 2;
    let intersected = null;
    for (const n of neighbors) {
      if (!n || !(n.w > 0) || !(n.h > 0)) continue;
      const ncx = n.x + n.w / 2, ncy = n.y + n.h / 2;
      const undersized = Math.min(n.w, n.h) < TARGET_MIN;
      const hit = _circleRectIntersect(cx, cy, TARGET_R, n) ||
        (undersized && _circleCircleIntersect(cx, cy, TARGET_R, ncx, ncy, TARGET_R));
      if (hit) { intersected = n; break; }
    }
    if (!intersected) return _ts('pass', 'spacing exception (24px circle clears all adjacent targets)', minDim);
    if (inlineCandidate) return _ts('needs-judgment', `${w}x${h}px below 24x24 and 24px circle intersects a neighbour, but display:inline — confirm whether it is genuinely in a sentence (hint inSentence=${opts.inSentence})`, minDim, { inlineCandidate, inSentenceHint: opts.inSentence === true });
    return _ts('fail', `${w}x${h}px below 24x24; 24px circle intersects an adjacent target`, minDim, { checkExceptions: ['equivalent', 'essential'] });
  }

  return _ts('needs-judgment', `${w}x${h}px below 24x24 (spacing exception unproven — no neighbour geometry)`, minDim, { indeterminateSpacing: true, inlineCandidate });
}

const VSR_ROOT_PHRASES = new Set([
  'document', 'main', 'banner', 'navigation', 'complementary', 'contentinfo',
  'end of document', 'end of main',
]);
function isVsrNoisePhrase(phrase) {
  if (!phrase) return true;
  const p = String(phrase).trim().toLowerCase();
  if (!p) return true;
  if (VSR_ROOT_PHRASES.has(p)) return true;
  if (/^end of /.test(p)) return true;
  return false;
}

function meaningfulAnnouncement(after, before) {
  if (isVsrNoisePhrase(after)) return null;
  if (before != null && String(after).trim() === String(before).trim()) return null;
  return after;
}

function isMediaErrorName(name) {
  if (!name) return false;
  return /unable to play media|no compatible source|the media could not be loaded|video format or mime type is not supported|invalid (source|media)/i.test(String(name));
}

function isBlankFrame(stats) {
  if (!stats) return false;
  const { meanLuma, stdLuma, darkFraction } = stats;
  return (meanLuma != null && meanLuma <= 16 && stdLuma != null && stdLuma <= 6) ||
    (darkFraction != null && darkFraction >= 0.985 && stdLuma != null && stdLuma <= 8);
}

const COMPOSITE_ROLES = new Set(['tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'radio', 'treeitem', 'gridcell']);

function isRovingTabindexItem(role, tabindex) {
  return COMPOSITE_ROLES.has(role) && String(tabindex) === '-1';
}

function keyboardOperabilitySignal({ role, tabindex, reachedByTab, respondedToSyntheticKey, respondsToArrows, focusable }) {
  if (isRovingTabindexItem(role, tabindex)) {
    if (respondsToArrows) return { operable: true, confident: true, reason: 'roving-tabindex item operated by arrow keys' };
    return { operable: null, confident: false, reason: 'roving-tabindex item: not Tab-reachable BY DESIGN; arrow operation could not be confirmed via synthetic events on this snapshot' };
  }
  if (reachedByTab && respondedToSyntheticKey) return { operable: true, confident: true, reason: 'reached by Tab and responded to Enter/Space' };
  if (respondedToSyntheticKey || respondsToArrows) return { operable: true, confident: false, reason: 'responded to a key (handlers present)' };

  if (focusable === false && reachedByTab === false && !COMPOSITE_ROLES.has(role))
    return { operable: false, confident: false, reason: 'not focusable and not reached by Tab — likely not keyboard operable (verify on live page)' };
  return { operable: null, confident: false, reason: 'no keyboard response observed, but only limited/snapshot evidence was available — indeterminate (PARTIAL)' };
}

const VIS = 1.5;
function _nonNone(s) { return !!s && !/^\s*none/i.test(s) && !/(^|\s)0px(\s|$)/.test(s); }

const FOCUS_MIN_CHANGED = 24;
const FOCUS_FILL_FRACTION = 0.04;
const FOCUS_RING_BORDERFRAC = 0.6;
function focusSpatialVerdict(stats) {
  if (!stats || !(stats.totalPixels > 0)) return { present: null, reason: 'no spatial stats' };
  const changedFraction = stats.changedPixels / stats.totalPixels;
  const borderFraction = stats.borderPixels > 0 ? (stats.borderChanged / stats.borderPixels) : 0;
  const changedInBorderShare = stats.changedPixels > 0 ? (stats.borderChanged / stats.changedPixels) : 0;
  const ringLike = stats.changedPixels >= FOCUS_MIN_CHANGED && changedInBorderShare >= FOCUS_RING_BORDERFRAC;
  const fillLike = changedFraction >= FOCUS_FILL_FRACTION;
  const present = stats.changedPixels >= FOCUS_MIN_CHANGED && (ringLike || fillLike || changedFraction >= 0.015);

  const roughMeetsProxy = present && (stats.minThicknessPx >= 2) && (stats.maxContrastChange >= 3);
  return {
    present, ringLike, fillLike, changedFraction: +changedFraction.toFixed(4), borderFraction: +borderFraction.toFixed(3),
    focusAppearance2413: { enforced: false, proxyOnly: true, areaPx: stats.changedPixels, thicknessProxyPx: stats.minThicknessPx, maxSampledContrast: stats.maxContrastChange, bbox: stats.bbox, roughMeetsProxy },
    reason: present ? (ringLike ? 'perimeter/ring change' : fillLike ? 'fill change' : 'area change') : 'no meaningful focus-dependent change',
  };
}

function _visibleOutlineStyle(s) {
  if (!s) return false;
  const style = String(s).trim().split(/\s+/)[0].toLowerCase();
  if (style === 'none' || style === 'hidden') return false;
  if (/(^|\s)0px(\s|$)/.test(s)) return false;
  return /^(auto|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(style);
}
function focusRingDecision(opts = {}) {

  const realTabDiffPct = opts.realTabDiffPct != null ? opts.realTabDiffPct : opts.diffPct;
  const realTabCropValid = opts.realTabCropValid != null ? opts.realTabCropValid : opts.cropValid;
  const fOut = opts.focusedOutline, uOut = opts.unfocusedOutline;
  const fSh = opts.focusedBoxShadow, uSh = opts.unfocusedBoxShadow;
  const forcedDiffPct = opts.forcedDiffPct;

  const outlineFocusDependent = _visibleOutlineStyle(fOut) && (uOut == null || fOut !== uOut);
  const shadowFocusDependent = (!!fSh && fSh !== 'none') && (uSh == null || fSh !== uSh);
  const focusDependentComputed = outlineFocusDependent || shadowFocusDependent;

  const spatial = opts.realTabSpatial ? focusSpatialVerdict(opts.realTabSpatial) : null;
  const forcedSpatial = opts.forcedSpatial ? focusSpatialVerdict(opts.forcedSpatial) : null;
  const realChange = realTabCropValid && (spatial ? spatial.present === true : (typeof realTabDiffPct === 'number' && realTabDiffPct >= VIS));
  const realNoChange = realTabCropValid && (spatial ? spatial.present === false : (typeof realTabDiffPct === 'number' && realTabDiffPct < VIS));
  const forcedChange = forcedSpatial ? forcedSpatial.present === true : (typeof forcedDiffPct === 'number' && forcedDiffPct >= VIS);

  if (realChange) return { present: true, basis: focusDependentComputed ? 'real-keyboard-diff+computed' : 'real-keyboard-diff (verify not animation)', focusDependentComputed };

  if (realNoChange) {
    if (focusDependentComputed) return { present: null, basis: 'conflict: computed ring changed but real pixels did not (likely clipped/wrong-crop)', focusDependentComputed };
    return { present: false, basis: 'real-keyboard: no focus-dependent change', focusDependentComputed };
  }

  if (forcedChange && focusDependentComputed) return { present: true, basis: 'forced-focus-visible-diff + computed (real crop unavailable)', focusDependentComputed };

  if (outlineFocusDependent) return { present: true, basis: 'forced computed outline focus-dependent (none→visible style; no pixel crop)', focusDependentComputed };
  if (typeof forcedDiffPct === 'number' && !forcedChange && !focusDependentComputed) return { present: false, basis: 'forced-focus-visible: no focus-dependent change', focusDependentComputed };

  if (shadowFocusDependent) return { present: null, basis: 'conflict: focus-dependent box-shadow but no pixel confirmation of visibility', focusDependentComputed };
  return { present: null, basis: 'indeterminate (no valid crop, no forced diff, no focus-dependent computed change)', focusDependentComputed };
}

const CONSENT_SELECTORS = [

  '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#onetrust-pc-sdk', '.onetrust-pc-dark-filter', '#ot-sdk-container',

  '.cmplz-cookiebanner', '#cmplz-cookiebanner-container', '#truste-consent-track', '#truste-consent-content',
  '.qc-cmp2-container', '.qc-cmp-cleanslate', '#usercentrics-root', '#CybotCookiebotDialog',
  '[id^="sp_message_container"]', '#onetrust-pc-sdk', '#didomi-host', '.osano-cm-window', '.osano-cm-dialog',

  '#cookie-banner', '#cookie-consent', '[id*="cookie-banner" i]', '[class*="cookie-banner" i]',
  '[id*="cookieConsent" i]', '[class*="cookie-consent" i]', '[class*="consent-banner" i]',
  '[aria-label*="cookie" i][role="dialog"]', '[aria-label*="consent" i][role="dialog"]', '[id*="gdpr" i]',
];

function coerceAxName(nameValue) {
  return nameValue != null ? String(nameValue) : null;
}

module.exports = {
  relLuminance, contrastRatio, contrastRatioRaw, parseRGB,
  isLargeText, contrastThresholdFor, LARGE_NORMAL_PX, LARGE_BOLD_PX,
  evalTargetSize, TARGET_MIN,
  isVsrNoisePhrase, meaningfulAnnouncement,
  isMediaErrorName, isBlankFrame,
  isRovingTabindexItem, keyboardOperabilitySignal, COMPOSITE_ROLES,
  focusRingDecision, focusSpatialVerdict,
  coerceAxName,
  CONSENT_SELECTORS,
};
