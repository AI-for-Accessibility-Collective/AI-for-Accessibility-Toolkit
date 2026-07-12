import { computeAccessibleName } from 'dom-accessibility-api';
import { inferLabel } from '../../utils/ai.js';
import { markProcessed, wasProcessed, isVisible } from '../../utils/dom.js';
import { IFRAME_PATTERNS } from '../../utils/constants.js';
import { registerSweep } from '../../utils/observe.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

// ---------------------------------------------------------------------------
// Junk-name guard: skip name-derived labels from names like q, s, utf8,
// csrf*, token, id (common hidden/CSRF field names that produce bad labels).
// ---------------------------------------------------------------------------
const JUNK_NAME_RE = /^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken)$/i;

export function isJunkName(name) {
  return !name || JUNK_NAME_RE.test(name.trim());
}

// ---------------------------------------------------------------------------
// ACCNAME gate: returns true when the element has NO accessible name.
// Uses dom-accessibility-api for spec-compliant ACCNAME computation.
// ---------------------------------------------------------------------------
export function lacksAccessibleName(el) {
  try {
    const name = computeAccessibleName(el);
    return name.trim() === '';
  } catch {
    return true; // treat error as "no name" — safer to label than to skip
  }
}

// ---------------------------------------------------------------------------
// Confidence gate for inferLabel output:
// - Must be 1–60 characters
// - No newlines
// - Not a refusal pattern
// ---------------------------------------------------------------------------
const REFUSAL_RE = /^(i (cannot|can't|am unable|don't know)|sorry|unable to|n\/a|unknown|no label|not (sure|available)|unsure)/i;

export function isValidLabel(label) {
  if (!label || typeof label !== 'string') return false;
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return false;
  if (/\n/.test(trimmed)) return false;
  if (REFUSAL_RE.test(trimmed)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------
function getContextForElement(el) {
  const parent = el.parentElement;
  if (!parent) return '';
  const clone = parent.cloneNode(true);
  clone.querySelectorAll('script, style').forEach(s => s.remove());
  return clone.textContent?.trim().substring(0, 200) || '';
}

function inferButtonLabel(button) {
  const className = button.className?.toLowerCase() || '';
  const patterns = {
    close: ['close', 'dismiss', 'x-btn', 'btn-close'],
    menu: ['menu', 'hamburger', 'nav-toggle'],
    search: ['search', 'find'],
    submit: ['submit', 'send'],
    play: ['play'],
    pause: ['pause'],
    next: ['next', 'forward', 'arrow-right'],
    previous: ['prev', 'back', 'arrow-left'],
    expand: ['expand', 'more', 'dropdown'],
    collapse: ['collapse', 'less'],
    settings: ['settings', 'config', 'gear', 'cog'],
    delete: ['delete', 'remove', 'trash'],
    edit: ['edit', 'pencil'],
    share: ['share'],
    like: ['like', 'heart', 'favorite'],
    copy: ['copy', 'clipboard']
  };
  for (const [label, keywords] of Object.entries(patterns)) {
    if (keywords.some(kw => className.includes(kw))) {
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Link label
// ---------------------------------------------------------------------------
export async function generateLinkLabel(link) {
  if (wasProcessed(link, 'labels')) return null;
  if (!isVisible(link)) return null;
  if (!lacksAccessibleName(link)) return null;

  markProcessed(link, 'pending', 'labels');

  try {
    const href = link.href || '';
    const existingText = link.textContent?.trim() || '';
    const context = getContextForElement(link);

    const label = await inferLabel({ url: href, elementType: 'link', existingText, context });

    if (isValidLabel(label)) {
      link.setAttribute('aria-label', label.trim());
      link.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(link, 'done', 'labels');
      incrementStat('labels');
      logFix('link label', link, existingText || '(empty)', label.trim());
      return label.trim();
    }

    markProcessed(link, 'failed', 'labels');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] generateLinkLabel error:', e);
    markProcessed(link, 'failed', 'labels');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Button label
// ---------------------------------------------------------------------------
export async function generateButtonLabel(button) {
  if (wasProcessed(button, 'labels')) return null;
  if (!isVisible(button)) return null;
  if (!lacksAccessibleName(button)) return null;

  markProcessed(button, 'pending', 'labels');

  try {
    // Deterministic class-based inference first.
    const inferred = inferButtonLabel(button);
    if (inferred) {
      button.setAttribute('aria-label', inferred);
      button.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(button, 'done', 'labels');
      incrementStat('labels');
      logFix('button label', button, '(empty)', inferred);
      return inferred;
    }

    const context = getContextForElement(button);
    const svgContent = button.querySelector('svg')?.outerHTML || '';

    const label = await inferLabel({ elementType: 'button', context, svgContent });

    if (isValidLabel(label)) {
      button.setAttribute('aria-label', label.trim());
      button.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(button, 'done', 'labels');
      incrementStat('labels');
      logFix('button label', button, '(empty)', label.trim());
      return label.trim();
    }

    markProcessed(button, 'failed', 'labels');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] generateButtonLabel error:', e);
    markProcessed(button, 'failed', 'labels');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Iframe title (deterministic — no ACCNAME gate needed here; title IS the name)
// ---------------------------------------------------------------------------
export async function generateIframeTitle(iframe) {
  if (wasProcessed(iframe, 'labels')) return null;
  if (!isVisible(iframe)) return null;
  // Gate: no existing title attribute means no accessible name for iframes.
  if (iframe.getAttribute('title')?.trim()) return null;

  markProcessed(iframe, 'pending', 'labels');

  try {
    const src = iframe.src || '';

    for (const [pattern, title] of Object.entries(IFRAME_PATTERNS)) {
      if (src.includes(pattern)) {
        iframe.setAttribute('title', title);
        iframe.setAttribute('data-ai4a11y-generated', 'label');
        markProcessed(iframe, 'done', 'labels');
        incrementStat('labels');
        logFix('iframe title', iframe, '(empty)', title);
        return title;
      }
    }

    try {
      const url = new URL(src);
      const title = `Embedded content from ${url.hostname}`;
      iframe.setAttribute('title', title);
      iframe.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(iframe, 'done', 'labels');
      incrementStat('labels');
      logFix('iframe title', iframe, '(empty)', title);
      return title;
    } catch {
      const title = 'Embedded content';
      iframe.setAttribute('title', title);
      iframe.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(iframe, 'done', 'labels');
      return title;
    }
  } catch (e) {
    console.warn('[AI4A11y] generateIframeTitle error:', e);
    markProcessed(iframe, 'failed', 'labels');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Form input label
// Selector: input (excl. hidden), select, textarea — no :not([id]) exclusion.
// ACCNAME gate covers label[for], wrapping label, aria-label, placeholder.
// Junk-name guard skips token/csrf/id-like names.
// ---------------------------------------------------------------------------
export async function generateFormLabel(input) {
  if (wasProcessed(input, 'labels')) return null;
  if (!isVisible(input)) return null;
  if (!lacksAccessibleName(input)) return null;

  markProcessed(input, 'pending', 'labels');

  try {
    // Cascade 1: placeholder (most common meaningful hint).
    if (input.placeholder && !isJunkName(input.placeholder)) {
      const label = input.placeholder.trim();
      input.setAttribute('aria-label', label);
      input.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(input, 'done', 'labels');
      incrementStat('labels');
      logFix('form label', input, '(empty)', label);
      return label;
    }

    // Cascade 2: input name attribute (human-readable, junk-guarded).
    if (input.name && !isJunkName(input.name)) {
      const label = input.name
        .replace(/[-_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .trim();
      if (label) {
        input.setAttribute('aria-label', label);
        input.setAttribute('data-ai4a11y-generated', 'label');
        markProcessed(input, 'done', 'labels');
        incrementStat('labels');
        logFix('form label', input, '(empty)', label);
        return label;
      }
    }

    // Cascade 3: nearby text heuristic (preceding/following sibling or parent).
    const nearbyText = _getNearbyText(input);
    if (nearbyText && !isJunkName(nearbyText)) {
      input.setAttribute('aria-label', nearbyText);
      input.setAttribute('data-ai4a11y-generated', 'label');
      markProcessed(input, 'done', 'labels');
      incrementStat('labels');
      logFix('form label', input, '(empty)', nearbyText);
      return nearbyText;
    }

    markProcessed(input, 'skipped', 'labels');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] generateFormLabel error:', e);
    markProcessed(input, 'failed', 'labels');
    return null;
  }
}

function _getNearbyText(input) {
  const prev = input.previousElementSibling;
  const next = input.nextElementSibling;
  const parent = input.parentElement;

  if (prev?.textContent?.trim()) return prev.textContent.trim().replace(/:$/, '');
  if (next?.textContent?.trim()) return next.textContent.trim().replace(/:$/, '');
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(e => e.remove());
    const text = clone.textContent?.trim();
    if (text && text.length < 50) return text.replace(/:$/, '');
  }
  return null;
}

// ---------------------------------------------------------------------------
// axeHandlers — keyed by axe rule id, used by the optional axe-driven path.
// ---------------------------------------------------------------------------
export const axeHandlers = {
  'link-name': generateLinkLabel,
  'button-name': generateButtonLabel,
  'frame-title': generateIframeTitle,
  'label': generateFormLabel,
  'select-name': generateFormLabel
};

// ---------------------------------------------------------------------------
// Public adapter object
// ---------------------------------------------------------------------------
export const GenerateLabels = {
  enabled: false,
  _unregisterSweep: null,

  async enable() {
    this.enabled = true;
    await this._sweep();

    if (!this._unregisterSweep) {
      this._unregisterSweep = registerSweep('generate-labels', async () => {
        if (!this.enabled) return;
        await this._sweep();
      }, { debounceMs: 600 });
    }
  },

  async _sweep() {
    // Links: those without any accessible name.
    for (const link of document.querySelectorAll('a')) {
      if (!this.enabled) break;
      await generateLinkLabel(link);
    }

    // Buttons.
    for (const btn of document.querySelectorAll('button')) {
      if (!this.enabled) break;
      await generateButtonLabel(btn);
    }

    // Iframes.
    for (const iframe of document.querySelectorAll('iframe')) {
      if (!this.enabled) break;
      await generateIframeTitle(iframe);
    }

    // Form controls: input (excl. hidden), select, textarea.
    for (const input of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (!this.enabled) break;
      await generateFormLabel(input);
    }
  },

  disable() {
    this.enabled = false;
    if (this._unregisterSweep) {
      this._unregisterSweep();
      this._unregisterSweep = null;
    }
    // Revert all AI-generated label writes.
    document.querySelectorAll('[data-ai4a11y-generated="label"]').forEach(el => {
      el.removeAttribute('aria-label');
      if (el.tagName === 'IFRAME') el.removeAttribute('title');
      el.removeAttribute('data-ai4a11y-generated');
      el.removeAttribute('data-ai4a11y-labels');
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
