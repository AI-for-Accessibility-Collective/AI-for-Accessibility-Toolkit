import { markProcessed } from '../utils/dom.js';
import {
  VALID_ARIA_ATTRS,
  VALID_ARIA_ROLES,
  DEPRECATED_ROLES
} from '../constants.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// ---------------------------------------------------------------------------
// BCP-47 structural validator — replaces a hardcoded ~38-language allowlist
// (which force-corrected legitimate but less-common codes like "cy" Welsh or
// "eu" Basque to "en", silently mislabeling the page for a screen reader).
// We only validate STRUCTURE — a syntactically valid tag is trusted as-is,
// never second-guessed against a fixed list. Examples: en, pt-BR, zh-Hant,
// sr-Cyrl-RS -> valid. english, en_US (before normalise), empty -> invalid.
// ---------------------------------------------------------------------------
export function isValidBcp47(tag) {
  if (!tag || typeof tag !== 'string') return false;
  const t = tag.trim();
  if (!t) return false;
  const parts = t.split('-');
  // Primary language subtag: 2-3 alpha (e.g. en, pt, zho).
  if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) return false;
  for (let i = 1; i < parts.length; i++) {
    // Each subtag: 1-8 alphanumeric chars (covers script, region, variant).
    if (!/^[a-zA-Z0-9]{1,8}$/.test(parts[i])) return false;
  }
  return true;
}

// Attempt to normalise a broken lang value to a valid BCP-47 tag.
// Returns null when no sensible normalisation is possible.
function normaliseLang(raw) {
  if (!raw) return null;
  const attempt = raw.replace(/_/g, '-'); // en_US -> en-US
  return isValidBcp47(attempt) ? attempt : null;
}

// Fix invalid language attribute
export function fixInvalidLang(element) {
  const currentLang = element.getAttribute('lang');
  if (!currentLang) return;

  // Never rewrite a structurally valid tag (pt-BR, fa, zh-Hant all stay).
  if (isValidBcp47(currentLang)) return;

  const fixed = normaliseLang(currentLang);
  if (!fixed) {
    // Cannot fix — leave it; guessing would risk corrupting it further.
    console.warn('[AI4A11y] Could not normalise lang attribute:', currentLang);
    return;
  }

  element.setAttribute('lang', fixed);
  incrementStat('wcag');
  logFix('lang', element, currentLang, fixed);
  console.log('[AI4A11y] Normalised lang attribute:', currentLang, '->', fixed);
}

// Fix missing lang attribute — intentional no-op. Guessing the page language
// (from URL patterns, defaulting to "en", etc.) produces a confidently wrong
// answer more often than it helps: a screen reader mispronouncing a whole
// page because of an incorrect guess is worse than no lang attribute at all,
// which most screen readers already fall back on gracefully (using the OS/
// user's own language setting). Kept as a function (rather than deleted) so
// the axeHandlers map entry for 'html-has-lang' still resolves.
export function fixMissingLang(_element) {
  console.info('[AI4A11y] fixMissingLang: no-op (no reliable language signal to guess from)');
}

// Fix duplicate IDs
export function fixDuplicateId(element) {
  const originalId = element.id;
  const newId = `${originalId}_${randomSuffix()}`;

  // Rename the SECOND+ duplicate element only. Do NOT re-point any
  // for/aria-labelledby/aria-describedby/etc. references: getElementById (and
  // browsers' own duplicate-id resolution) already resolves those references
  // to the FIRST occurrence of the id, which is the correct target. Blasting
  // every matching reference over to the newly-renamed element would move
  // references that were already pointing at the right place onto the wrong
  // one — breaking wiring that worked before this "fix" ran.
  element.id = newId;
  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('duplicate-id', element, originalId, newId);
  console.log('[AI4A11y] Renamed duplicate ID:', originalId, '->', newId);
}

// Fix skipped heading levels
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

    // Move children to preserve event listeners
    while (element.firstChild) {
      newHeading.appendChild(element.firstChild);
    }

    // Copy attributes
    for (const attr of element.attributes) {
      newHeading.setAttribute(attr.name, attr.value);
    }

    element.replaceWith(newHeading);
    incrementStat('wcag');
    logFix('heading-order', newHeading, `h${currentLevel}`, `h${newLevel}`);
    console.log(`[AI4A11y] Fixed heading: h${currentLevel} -> h${newLevel}`);
  }
}

// Fix positive tabindex
export function fixPositiveTabindex(element) {
  const oldVal = element.getAttribute('tabindex');
  element.setAttribute('tabindex', '0');
  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('tabindex', element, oldVal, '0');
  console.log('[AI4A11y] Fixed positive tabindex');
}

// Fix target="_blank" without rel
export function fixTargetBlank(element) {
  const rel = element.getAttribute('rel') || '';
  const parts = rel.split(/\s+/).filter(Boolean);

  if (!parts.includes('noopener')) parts.push('noopener');
  if (!parts.includes('noreferrer')) parts.push('noreferrer');

  element.setAttribute('rel', parts.join(' '));
  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('target-blank', element, rel || '(empty)', parts.join(' '));
  console.log('[AI4A11y] Added rel="noopener noreferrer"');
}

// Fix invalid ARIA attributes
export function fixInvalidAriaAttr(element) {
  let fixed = false;
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('aria-') && !VALID_ARIA_ATTRS.has(attr.name)) {
      element.removeAttribute(attr.name);
      fixed = true;
      console.log('[AI4A11y] Removed invalid ARIA attr:', attr.name);
    }
  }
  // Only count it as a fix (and log a stat) when something actually changed —
  // the old unconditional incrementStat() inflated the WCAG count on every
  // call, including elements with no invalid aria-* attributes at all.
  if (fixed) incrementStat('wcag');
}

// Fix invalid ARIA role
export function fixInvalidAriaRole(element) {
  const role = element.getAttribute('role');
  if (role && !VALID_ARIA_ROLES.has(role)) {
    element.removeAttribute('role');
    incrementStat('wcag');
    logFix('aria-role', element, role, '(removed)');
    console.log('[AI4A11y] Removed invalid role:', role);
  }
}

// Fix deprecated ARIA role
export function fixDeprecatedRole(element) {
  const role = element.getAttribute('role');
  if (role && DEPRECATED_ROLES[role]) {
    element.setAttribute('role', DEPRECATED_ROLES[role]);
    incrementStat('wcag');
    logFix('aria-role', element, role, DEPRECATED_ROLES[role]);
    console.log('[AI4A11y] Replaced deprecated role:', role);
  }
}

// Fix missing required ARIA attributes — intentional no-op. Backfilling a
// default value for a missing required ARIA state attribute (e.g.
// aria-checked="false" on a custom checkbox we don't actually know the state
// of) tells a screen reader user something that may not be true — an
// actively misleading "fix", not a safe one. There's no safe default for
// widget state we don't control. Kept as a function (rather than deleted) so
// the 'aria-required-attr' axeHandlers entry still resolves.
export function fixMissingAriaAttrs(_element) {
  console.info('[AI4A11y] fixMissingAriaAttrs: no-op (backfilling ARIA state would lie to screen readers)');
}

// Fix nested interactive elements
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
    logFix('nested-interactive', span, 'button', 'span');
    console.log('[AI4A11y] Replaced nested button with span');
  } else if (element.tagName === 'A') {
    element.removeAttribute('href');
    element.setAttribute('role', 'presentation');
    incrementStat('wcag');
    logFix('nested-interactive', element, 'a[href]', 'a[role=presentation]');
    console.log('[AI4A11y] Made nested link non-interactive');
  }
}

// Touch-target threshold in CSS px. WCAG 2.5.8 Target Size (Minimum, AA)
// asks for 24x24; 44x44 is the WCAG 2.5.5 Target Size (Enhanced, AAA) size,
// and the one big-targets.js aims for too, so the two adapters agree.
export const TARGET_SIZE_PX = 44;

// Fix small touch targets
export function fixTargetSize(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width >= TARGET_SIZE_PX && rect.height >= TARGET_SIZE_PX) return;

  const needWidth = Math.max(0, (TARGET_SIZE_PX - rect.width) / 2);
  const needHeight = Math.max(0, (TARGET_SIZE_PX - rect.height) / 2);
  const display = getComputedStyle(element).display;

  element.style.boxSizing = 'border-box';
  element.style.padding = `${needHeight}px ${needWidth}px`;
  element.style.minWidth = `${TARGET_SIZE_PX}px`;
  element.style.minHeight = `${TARGET_SIZE_PX}px`;

  if (display === 'inline') {
    element.style.display = 'inline-block';
  }

  incrementStat('wcag');
  logFix('target-size', element, `${Math.round(rect.width)}x${Math.round(rect.height)}`, `${TARGET_SIZE_PX}x${TARGET_SIZE_PX}`);
  console.log('[AI4A11y] Increased touch target size');
}

// Fix viewport meta
export function fixViewportMeta(element) {
  const oldContent = element.getAttribute('content') || '';
  let content = oldContent;
  content = content.replace(/maximum-scale\s*=\s*[\d.]+/gi, 'maximum-scale=5');
  // Both user-scalable=no AND user-scalable=0 lock zoom.
  content = content.replace(/user-scalable\s*=\s*(no|0)/gi, 'user-scalable=yes');
  if (content === oldContent) return; // nothing to fix — avoid a spurious log entry
  element.setAttribute('content', content);
  incrementStat('wcag');
  logFix('viewport', element, oldContent, content);
  console.log('[AI4A11y] Fixed viewport meta');
}

// Remove meta refresh — intentional no-op. By document_idle (when content
// scripts run) the browser has already read and armed the
// http-equiv="refresh" timer during HTML parsing; removing the <meta>
// element afterward does not cancel that already-scheduled navigation. The
// old version removed the element and logged "Removed meta refresh" anyway —
// a fix that silently didn't work is worse than one that admits it can't.
// Kept as a function (rather than deleted) so the 'meta-refresh'
// axeHandlers entry still resolves.
export function removeMetaRefresh(_element) {
  console.info('[AI4A11y] removeMetaRefresh: no-op (the refresh timer is already armed by document_idle; removing the tag cannot cancel it)');
}

// Replace obsolete elements
export function replaceObsoleteElement(element) {
  const tag = element.tagName.toLowerCase();
  const replacement = tag === 'blink' ? 'span' : 'div';
  const newEl = document.createElement(replacement);

  while (element.firstChild) {
    newEl.appendChild(element.firstChild);
  }

  element.replaceWith(newEl);
  incrementStat('wcag');
  logFix('obsolete', newEl, `<${tag}>`, `<${replacement}>`);
  console.log(`[AI4A11y] Replaced <${tag}> with <${replacement}>`);
}

// Helper: Random suffix for IDs
function randomSuffix() {
  return Math.random().toString(36).substring(2, 7);
}

// ---------------------------------------------------------------------------
// Safety tiers, keyed by axe rule id. Every axeHandlers entry has one.
//
//   safe   Runs whenever the adapter is on. Adds or normalises an attribute
//          the page left wrong, and leaves the page's structure alone.
//   risky  Changes structure or removes author markup: re-tags a heading,
//          strips aria-* attributes or a role, unwraps a nested control, or
//          pads a control's box (which can push it into its neighbours). A
//          wrong guess here is felt by the very people the fix is for, so a
//          risky fix runs only when the `wcagRiskyFixes` setting (see
//          settingsMeta in toolkit/registry/tools.js) is true. Off by default.
//
// The named fix functions above are the raw fixes and do not check the
// setting; the gate is applied when they are placed in axeHandlers, so every
// dispatcher that goes through the map gets the default-off behaviour.
// ---------------------------------------------------------------------------
export const fixTiers = {
  'html-has-lang': 'safe',
  'html-lang-valid': 'safe',
  'valid-lang': 'safe',
  'duplicate-id': 'safe',
  'duplicate-id-aria': 'safe',
  'duplicate-id-active': 'safe',
  'heading-order': 'risky',
  'tabindex': 'safe',
  'aria-valid-attr': 'risky',
  'aria-roles': 'risky',
  'aria-allowed-role': 'risky',
  'aria-deprecated-role': 'safe',
  'aria-required-attr': 'safe',
  'nested-interactive': 'risky',
  'target-size': 'risky',
  'meta-viewport': 'safe',
  'meta-viewport-large': 'safe',
  'meta-refresh': 'safe',
  'blink': 'safe',
  'marquee': 'safe'
};

export function isRiskyFix(ruleId) {
  return fixTiers[ruleId] === 'risky';
}

// Wrap a risky fix so it runs only when settings.wcagRiskyFixes === true.
// Returns false when it skipped, so a host can count and report the skips.
// Safe fixes are returned as they are (they ignore a settings argument).
function gate(ruleId, fix) {
  if (!isRiskyFix(ruleId)) return fix;
  return function gatedFix(element, settings) {
    if (settings?.wcagRiskyFixes === true) return fix(element);
    console.info(`[AI4A11y] Skipped risky fix ${ruleId} (wcagRiskyFixes is off)`);
    return false;
  };
}

// Axe rule ID to handler mapping. Handlers take (element, settings); the
// settings object is the active profile's tools (the CLI passes
// getActiveProfileSettings(); a host with no settings may omit it).
const rawHandlers = {
  'html-has-lang': fixMissingLang,
  'html-lang-valid': fixInvalidLang,
  'valid-lang': fixInvalidLang,
  'duplicate-id': fixDuplicateId,
  'duplicate-id-aria': fixDuplicateId,
  'duplicate-id-active': fixDuplicateId,
  'heading-order': fixHeadingOrder,
  'tabindex': fixPositiveTabindex,
  'aria-valid-attr': fixInvalidAriaAttr,
  'aria-roles': fixInvalidAriaRole,
  'aria-allowed-role': fixInvalidAriaRole,
  'aria-deprecated-role': fixDeprecatedRole,
  'aria-required-attr': fixMissingAriaAttrs,
  'nested-interactive': fixNestedInteractive,
  'target-size': fixTargetSize,
  'meta-viewport': fixViewportMeta,
  'meta-viewport-large': fixViewportMeta,
  'meta-refresh': removeMetaRefresh,
  'blink': replaceObsoleteElement,
  'marquee': replaceObsoleteElement
};

export const axeHandlers = Object.fromEntries(
  Object.entries(rawHandlers).map(([ruleId, fix]) => [ruleId, gate(ruleId, fix)])
);
