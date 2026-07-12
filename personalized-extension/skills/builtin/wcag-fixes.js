import { markProcessed } from '../../utils/dom.js';
import {
  VALID_ARIA_ATTRS,
  VALID_ARIA_ROLES,
  DEPRECATED_ROLES,
  ARIA_REQUIRED_ATTRS
} from '../../utils/constants.js';

// Call-time lookup so the audit-trail hook assigned in content.js is always
// found regardless of module-import order.
const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

// ---------------------------------------------------------------------------
// Safety tiers
// ---------------------------------------------------------------------------
// SAFE tier: runs when autoWcagFix is on.
// RISKY tier: runs only when wcagRiskyFixes is ALSO on.
// Deleted: fixMissingAriaAttrs (state-ARIA backfill lies to SRs),
//          removeMetaRefresh (no-op at document_idle).

// ---------------------------------------------------------------------------
// BCP-47 structural validator
// ---------------------------------------------------------------------------
// Validates that a lang tag has correct subtag shapes: 2–3 alpha language code,
// optionally followed by 4-alpha script, 2-alpha or 3-digit region, and more.
// We only validate structure — we never rewrite a structurally valid tag.
// Examples: en, pt-BR, zh-Hant, sr-Cyrl-RS → valid
//           english, en_US (before normalise), empty → invalid/normalizable

export function isValidBcp47(tag) {
  if (!tag || typeof tag !== 'string') return false;
  const t = tag.trim();
  if (!t) return false;
  // Primary language subtag: 2–3 alpha (e.g. en, pt, zho)
  // followed by optional subtags separated by hyphens.
  // Script: 4 alpha; Region: 2 alpha or 3 digits; variants/extensions: lenient.
  // We check: starts with 2–3 alpha, rest are non-empty hyphen-separated tokens.
  const parts = t.split('-');
  if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) return false;
  for (let i = 1; i < parts.length; i++) {
    // Each subtag: 1–8 alphanumeric chars (covers script, region, variant, extension)
    if (!/^[a-zA-Z0-9]{1,8}$/.test(parts[i])) return false;
  }
  return true;
}

// Attempt to normalise a broken lang value to a valid BCP-47.
// Returns null when no sensible normalisation is possible.
function normaliseLang(raw) {
  if (!raw) return null;
  // Replace underscores with hyphens (en_US → en-US)
  const attempt = raw.replace(/_/g, '-');
  if (isValidBcp47(attempt)) return attempt;
  return null;
}

// ---------------------------------------------------------------------------
// CSS path helper — generates a unique selector for an element at fix time.
// Stored in the logFix inverse descriptor so revertFix can look the element
// up later (the element reference itself may be stale after page mutations).
// ---------------------------------------------------------------------------
function cssPath(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el === document.documentElement) return 'html';
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    let seg = node.tagName.toLowerCase();
    if (node.id) {
      // ID is unique — stop here.
      seg += '#' + CSS.escape(node.id);
      parts.unshift(seg);
      break;
    }
    // nth-of-type disambiguates siblings of the same tag.
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
      : [node];
    if (siblings.length > 1) {
      seg += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(seg);
    node = node.parentElement;
  }
  if (parts[0] && !parts[0].includes('#')) parts.unshift('html');
  return parts.join(' > ');
}

// ---------------------------------------------------------------------------
// SAFE-tier fixers
// ---------------------------------------------------------------------------

export function fixInvalidLang(element) {
  const currentLang = element.getAttribute('lang');
  if (!currentLang) return;

  // Never rewrite a structurally valid BCP-47 tag (pt-BR, fa, zh-Hant all stay).
  if (isValidBcp47(currentLang)) return;

  // Try to normalise (e.g. en_US → en-US).
  const fixed = normaliseLang(currentLang);
  if (!fixed) {
    // Cannot fix — leave it; do not guess or corrupt further.
    console.warn('[AI4A11y] Could not normalise lang attribute:', currentLang);
    return;
  }

  const sel = cssPath(element);
  element.setAttribute('lang', fixed);
  incrementStat('wcag');
  logFix('lang', sel, currentLang, fixed, { attr: 'lang', prior: currentLang, selector: sel });
  console.log('[AI4A11y] Normalised lang attribute:', currentLang, '->', fixed);
}

// fixMissingLang: per plan, set NOTHING when lang is absent (no guessing).
// The function is kept for the axeHandlers map entry but is intentionally a
// no-op — franc-based detection is deferred to a future increment.
export function fixMissingLang(_element) {
  // Intentional no-op: we do not guess the page language.
  // Screen readers fall back gracefully; a wrong guess is worse than none.
  console.info('[AI4A11y] fixMissingLang: no-op (language detection deferred)');
}

export function fixDuplicateId(element) {
  const originalId = element.id;
  const newId = `${originalId}_${randomSuffix()}`;

  // Rename the SECOND+ duplicate element only.
  // Do NOT re-point any references: getElementById resolves to the FIRST
  // occurrence, which means for/aria-labelledby/etc. already point at the
  // correct (first) element. Re-pointing would break that correct wiring.
  const sel = cssPath(element);
  element.id = newId;
  markProcessed(element, 'done', 'wcag');
  incrementStat('wcag');
  logFix('duplicate-id', sel, originalId, newId, { attr: 'id', prior: originalId, selector: sel });
  console.log('[AI4A11y] Renamed duplicate ID:', originalId, '->', newId);
}

export function fixTargetBlank(element) {
  const rel = element.getAttribute('rel') || '';
  const parts = rel.split(/\s+/).filter(Boolean);

  if (!parts.includes('noopener')) parts.push('noopener');
  if (!parts.includes('noreferrer')) parts.push('noreferrer');

  const newRel = parts.join(' ');
  const sel = cssPath(element);
  element.setAttribute('rel', newRel);
  markProcessed(element, 'done', 'wcag');
  incrementStat('wcag');
  logFix('target-blank', sel, rel || '(empty)', newRel, { attr: 'rel', prior: rel || null, selector: sel });
  console.log('[AI4A11y] Added rel="noopener noreferrer"');
}

export function replaceObsoleteElement(element) {
  const tag = element.tagName.toLowerCase();
  const replacement = tag === 'blink' ? 'span' : 'div';
  const newEl = document.createElement(replacement);

  while (element.firstChild) {
    newEl.appendChild(element.firstChild);
  }

  // Note: element is replaced so no revert by attribute — record the old tag.
  // For undo we'd need to re-insert — mark as non-revertable (no inverse).
  element.replaceWith(newEl);
  incrementStat('wcag');
  logFix('obsolete', cssPath(newEl), `<${tag}>`, `<${replacement}>`, null);
  console.log(`[AI4A11y] Replaced <${tag}> with <${replacement}>`);
}

export function fixViewportMeta(element) {
  const oldContent = element.getAttribute('content') || '';
  let content = oldContent;
  // Fix maximum-scale restriction
  content = content.replace(/maximum-scale\s*=\s*[\d.]+/gi, 'maximum-scale=5');
  // Fix user-scalable=no AND user-scalable=0 (both lock zoom)
  content = content.replace(/user-scalable\s*=\s*(no|0)/gi, 'user-scalable=yes');
  if (content === oldContent) return; // nothing changed
  const sel = cssPath(element);
  element.setAttribute('content', content);
  incrementStat('wcag');
  logFix('viewport', sel, oldContent, content, { attr: 'content', prior: oldContent, selector: sel });
  console.log('[AI4A11y] Fixed viewport meta');
}

export function fixPositiveTabindex(element) {
  const oldVal = element.getAttribute('tabindex');
  const sel = cssPath(element);
  element.setAttribute('tabindex', '0');
  markProcessed(element, 'done', 'wcag');
  incrementStat('wcag');
  logFix('tabindex', sel, oldVal, '0', { attr: 'tabindex', prior: oldVal, selector: sel });
  console.log('[AI4A11y] Fixed positive tabindex');
}

export function fixDeprecatedRole(element) {
  const role = element.getAttribute('role');
  if (role && DEPRECATED_ROLES[role]) {
    const newRole = DEPRECATED_ROLES[role];
    const sel = cssPath(element);
    element.setAttribute('role', newRole);
    incrementStat('wcag');
    logFix('aria-role', sel, role, newRole, { attr: 'role', prior: role, selector: sel });
    console.log('[AI4A11y] Replaced deprecated role:', role);
  }
}

// ---------------------------------------------------------------------------
// RISKY-tier fixers
// ---------------------------------------------------------------------------

export function fixHeadingOrder(element) {
  const match = element.tagName.match(/^H([1-6])$/);
  if (!match) return;

  const currentLevel = parseInt(match[1]);
  const allHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const idx = allHeadings.indexOf(element);

  if (idx === -1 || idx === 0) return;

  const prevHeading = allHeadings[idx - 1];
  const prevLevel = parseInt(prevHeading.tagName[1]);

  if (currentLevel > prevLevel + 1) {
    const newLevel = prevLevel + 1;
    const newHeading = document.createElement(`h${newLevel}`);

    while (element.firstChild) {
      newHeading.appendChild(element.firstChild);
    }

    for (const attr of element.attributes) {
      newHeading.setAttribute(attr.name, attr.value);
    }

    element.replaceWith(newHeading);
    incrementStat('wcag');
    // Element replaced — no simple attr inverse; record as non-revertable.
    logFix('heading-order', cssPath(newHeading), `h${currentLevel}`, `h${newLevel}`, null);
    console.log(`[AI4A11y] Fixed heading: h${currentLevel} -> h${newLevel}`);
  }
}

export function fixInvalidAriaAttr(element) {
  let fixed = false;
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('aria-') && !VALID_ARIA_ATTRS.has(attr.name)) {
      element.removeAttribute(attr.name);
      fixed = true;
      console.log('[AI4A11y] Removed invalid ARIA attr:', attr.name);
    }
  }
  if (fixed) incrementStat('wcag');
}

export function fixInvalidAriaRole(element) {
  const role = element.getAttribute('role');
  if (role && !VALID_ARIA_ROLES.has(role)) {
    const sel = cssPath(element);
    element.removeAttribute('role');
    incrementStat('wcag');
    logFix('aria-role', sel, role, '(removed)', { attr: 'role', prior: role, selector: sel });
    console.log('[AI4A11y] Removed invalid role:', role);
  }
}

export function fixNestedInteractive(element) {
  const parent = element.closest('a, button');
  if (!parent || element === parent) return;

  if (element.tagName === 'BUTTON') {
    const span = document.createElement('span');
    while (element.firstChild) {
      span.appendChild(element.firstChild);
    }
    span.className = element.className;
    element.replaceWith(span);
    incrementStat('wcag');
    logFix('nested-interactive', cssPath(span), 'button', 'span', null);
    console.log('[AI4A11y] Replaced nested button with span');
  } else if (element.tagName === 'A') {
    const sel = cssPath(element);
    const priorHref = element.getAttribute('href');
    element.removeAttribute('href');
    element.setAttribute('role', 'presentation');
    incrementStat('wcag');
    logFix('nested-interactive', sel, 'a[href]', 'a[role=presentation]',
      { attr: 'href', prior: priorHref, selector: sel });
    console.log('[AI4A11y] Made nested link non-interactive');
  }
}

export function fixTargetSize(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width >= 44 && rect.height >= 44) return;

  const needWidth = Math.max(0, (44 - rect.width) / 2);
  const needHeight = Math.max(0, (44 - rect.height) / 2);
  const display = getComputedStyle(element).display;
  const priorPadding = element.style.padding || '';
  const priorMinW = element.style.minWidth || '';
  const priorMinH = element.style.minHeight || '';
  const priorBoxSizing = element.style.boxSizing || '';

  const sel = cssPath(element);
  element.style.boxSizing = 'border-box';
  element.style.padding = `${needHeight}px ${needWidth}px`;
  element.style.minWidth = '44px';
  element.style.minHeight = '44px';

  if (display === 'inline') {
    element.style.display = 'inline-block';
  }

  incrementStat('wcag');
  logFix('target-size', sel, `${Math.round(rect.width)}x${Math.round(rect.height)}`, '44x44', {
    style: { padding: priorPadding, minWidth: priorMinW, minHeight: priorMinH, boxSizing: priorBoxSizing },
    selector: sel
  });
  console.log('[AI4A11y] Increased touch target size');
}

// ---------------------------------------------------------------------------
// DELETED fixers (kept as stubs for backwards-compat axeHandlers references)
// ---------------------------------------------------------------------------
// fixMissingAriaAttrs — state-ARIA backfill (aria-checked="false" etc.) lies
//   to screen readers about widget state. Removed entirely.
// removeMetaRefresh — no-op at document_idle (timer already armed). Removed.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomSuffix() {
  return Math.random().toString(36).substring(2, 7);
}

// ---------------------------------------------------------------------------
// axeHandlers — maps axe-core rule IDs to fixer functions.
// Only rule IDs present in axe-core 4.12 are included.
// Notes on dropped/renamed entries:
//   - duplicate-id* rules still exist in 4.12 (not removed).
//   - 'aria-required-attr' exists but maps to nothing (state-ARIA backfill
//     deleted; structural attrs are now handled without axe dispatch).
//   - 'meta-refresh' handler removed (was no-op).
//   - 'html-has-lang' maps to no-op fixMissingLang (intentional).
// ---------------------------------------------------------------------------
export const axeHandlers = {
  'html-has-lang':        fixMissingLang,      // no-op — no guessing
  'html-lang-valid':      fixInvalidLang,
  'valid-lang':           fixInvalidLang,
  'duplicate-id':         fixDuplicateId,
  'duplicate-id-aria':    fixDuplicateId,
  'duplicate-id-active':  fixDuplicateId,
  'tabindex':             fixPositiveTabindex,
  'aria-valid-attr':      fixInvalidAriaAttr,
  'aria-roles':           fixInvalidAriaRole,
  'aria-allowed-role':    fixInvalidAriaRole,
  'aria-deprecated-role': fixDeprecatedRole,
  'nested-interactive':   fixNestedInteractive,
  'target-size':          fixTargetSize,
  'meta-viewport':        fixViewportMeta,
  'meta-viewport-large':  fixViewportMeta,
  'blink':                replaceObsoleteElement,
  'marquee':              replaceObsoleteElement,
  // Risky-tier rules — dispatched only when wcagRiskyFixes is on; content.js
  // checks the tier before calling the handler via __ai4a11yAxeDispatch.
  'heading-order':        fixHeadingOrder,
};

// ---------------------------------------------------------------------------
// Safe and Risky tier lists (for sweep mode + dispatch tier-checking)
// ---------------------------------------------------------------------------
export const SAFE_FIXERS = [
  'fixDuplicateId', 'fixTargetBlank', 'replaceObsoleteElement', 'fixViewportMeta',
  'fixPositiveTabindex', 'fixMissingLang', 'fixInvalidLang', 'fixDeprecatedRole',
];

export const RISKY_FIXERS = [
  'fixHeadingOrder', 'fixInvalidAriaAttr', 'fixInvalidAriaRole',
  'fixNestedInteractive', 'fixTargetSize',
];

// axe rule IDs that belong to the risky tier (for dispatch gating in content.js)
export const RISKY_AXE_RULES = new Set([
  'heading-order', 'aria-valid-attr', 'aria-roles', 'aria-allowed-role',
  'nested-interactive', 'target-size',
]);

// ---------------------------------------------------------------------------
// WcagFixes adapter
// ---------------------------------------------------------------------------

export const WcagFixes = {
  enabled: false,
  _riskyEnabled: false,

  enable(opts = {}) {
    this.enabled = true;
    this._riskyEnabled = !!(opts && opts.wcagRiskyFixes);
    this.run();
  },

  disable() {
    this.enabled = false;
    this._riskyEnabled = false;
  },

  run() {
    const html = document.documentElement;

    // Lang: fix invalid tags; do NOT set missing ones (no guessing).
    if (html.getAttribute('lang')) fixInvalidLang(html);

    // Duplicate IDs: rename SECOND+ occurrences only; do not re-point refs.
    const ids = {};
    document.querySelectorAll('[id]').forEach(el => {
      if (ids[el.id]) fixDuplicateId(el);
      else ids[el.id] = true;
    });

    // target=_blank links
    document.querySelectorAll('a[target="_blank"]').forEach(a => {
      if (!markProcessed(a, 'check', 'wcag')) fixTargetBlank(a);
    });

    // Obsolete elements
    document.querySelectorAll('blink, marquee').forEach(el => replaceObsoleteElement(el));

    // Viewport meta
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) fixViewportMeta(viewport);

    // Positive tabindex
    document.querySelectorAll('[tabindex]').forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) fixPositiveTabindex(el);
    });

    // Deprecated roles
    document.querySelectorAll('[role]').forEach(el => {
      fixDeprecatedRole(el);
    });

    // Risky tier — only when wcagRiskyFixes is also on.
    if (this._riskyEnabled) {
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => fixHeadingOrder(h));
      document.querySelectorAll('[role]').forEach(el => {
        fixInvalidAriaRole(el);
      });
      document.querySelectorAll('[aria-]').forEach(() => {}); // noop placeholder
      document.querySelectorAll('a[href], button, [role="button"], [role="link"]').forEach(el => {
        fixNestedInteractive(el);
        fixTargetSize(el);
      });
      // fixInvalidAriaAttr on all elements with aria- attributes
      document.querySelectorAll('*').forEach(el => {
        if (Array.from(el.attributes).some(a => a.name.startsWith('aria-'))) {
          fixInvalidAriaAttr(el);
        }
      });
    }
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
