import { markProcessed } from '../utils/dom.js';
import { logFix, incrementStat } from '../stats.js';
import {
  VALID_LANGS,
  VALID_ARIA_ATTRS,
  VALID_ARIA_ROLES,
  DEPRECATED_ROLES,
  ARIA_REQUIRED_ATTRS
} from '../constants.js';

// Fix invalid language attribute
export function fixInvalidLang(element) {
  const currentLang = element.getAttribute('lang');
  if (!currentLang) return;

  const baseLang = currentLang.split('-')[0].toLowerCase();
  const newLang = VALID_LANGS.has(baseLang) ? baseLang : 'en';

  element.setAttribute('lang', newLang);
  incrementStat('wcag');
  logFix('lang', element, currentLang, newLang);
  console.log('[AI4A11y] Fixed lang attribute');
}

// Fix missing lang attribute
export function fixMissingLang(element) {
  element.setAttribute('lang', detectLanguage());
  incrementStat('wcag');
  logFix('lang', element, '(missing)', element.getAttribute('lang'));
  console.log('[AI4A11y] Added lang attribute');
}

// Fix duplicate IDs
export function fixDuplicateId(element) {
  const originalId = element.id;
  const newId = `${originalId}_${randomSuffix()}`;

  // Update references before changing ID
  updateIdReferences(originalId, newId);

  element.id = newId;
  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('duplicate-id', element, originalId, newId);
  console.log('[AI4A11y] Fixed duplicate ID:', originalId);
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
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('aria-') && !VALID_ARIA_ATTRS.has(attr.name)) {
      element.removeAttribute(attr.name);
      console.log('[AI4A11y] Removed invalid ARIA attr:', attr.name);
    }
  }
  incrementStat('wcag');
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

// Fix missing required ARIA attributes
export function fixMissingAriaAttrs(element) {
  const role = element.getAttribute('role');
  if (role && ARIA_REQUIRED_ATTRS[role]) {
    for (const [attr, value] of Object.entries(ARIA_REQUIRED_ATTRS[role])) {
      if (!element.hasAttribute(attr) && value !== '') {
        element.setAttribute(attr, value);
        console.log('[AI4A11y] Added required ARIA attr:', attr);
      }
    }
    incrementStat('wcag');
  }
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

// Fix small touch targets
export function fixTargetSize(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width >= 44 && rect.height >= 44) return;

  const needWidth = Math.max(0, (44 - rect.width) / 2);
  const needHeight = Math.max(0, (44 - rect.height) / 2);
  const display = getComputedStyle(element).display;

  element.style.boxSizing = 'border-box';
  element.style.padding = `${needHeight}px ${needWidth}px`;
  element.style.minWidth = '44px';
  element.style.minHeight = '44px';

  if (display === 'inline') {
    element.style.display = 'inline-block';
  }

  incrementStat('wcag');
  logFix('target-size', element, `${Math.round(rect.width)}x${Math.round(rect.height)}`, '44x44');
  console.log('[AI4A11y] Increased touch target size');
}

// Fix viewport meta
export function fixViewportMeta(element) {
  const oldContent = element.getAttribute('content') || '';
  let content = oldContent;
  content = content.replace(/maximum-scale\s*=\s*[\d.]+/gi, 'maximum-scale=5');
  content = content.replace(/user-scalable\s*=\s*no/gi, 'user-scalable=yes');
  element.setAttribute('content', content);
  incrementStat('wcag');
  logFix('viewport', element, oldContent, content);
  console.log('[AI4A11y] Fixed viewport meta');
}

// Remove meta refresh
export function removeMetaRefresh(element) {
  const oldContent = element.getAttribute('content') || '';
  element.remove();
  incrementStat('wcag');
  logFix('meta-refresh', element, oldContent, '(removed)');
  console.log('[AI4A11y] Removed meta refresh');
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

// Helper: Detect page language
function detectLanguage() {
  const meta = document.querySelector('meta[http-equiv="content-language"]');
  if (meta?.content) return meta.content.split('-')[0];

  const patterns = {
    '/es/': 'es', '/fr/': 'fr', '/de/': 'de',
    '/zh/': 'zh', '/ja/': 'ja', '/ko/': 'ko'
  };

  for (const [pattern, lang] of Object.entries(patterns)) {
    if (location.href.includes(pattern)) return lang;
  }

  return 'en';
}

// Helper: Random suffix for IDs
function randomSuffix() {
  return Math.random().toString(36).substring(2, 7);
}

// Helper: Update all references to an ID
function updateIdReferences(oldId, newId) {
  const attrs = ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'headers', 'list'];

  for (const attr of attrs) {
    document.querySelectorAll(`[${attr}]`).forEach(el => {
      const val = el.getAttribute(attr);
      if (val) {
        const ids = val.split(/\s+/);
        const updated = ids.map(id => id === oldId ? newId : id);
        if (updated.join(' ') !== val) {
          el.setAttribute(attr, updated.join(' '));
        }
      }
    });
  }
}

// Axe rule ID to handler mapping
export const axeHandlers = {
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
