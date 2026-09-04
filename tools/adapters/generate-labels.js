import { inferLabel } from '../utils/ai.js';
import { markProcessed, hasAccessibleName, isVisible } from '../utils/dom.js';
import { IFRAME_PATTERNS } from '../constants.js';
import { REFUSAL_RE } from '../utils/ai-output.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// ---------------------------------------------------------------------------
// Junk-name guard — skip name-derived labels for names like q, s, utf8,
// csrf*, token, id (common hidden/CSRF field names that produce bad labels
// if used verbatim as an accessible name).
// ---------------------------------------------------------------------------
const JUNK_NAME_RE = /^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken)$/i;

export function isJunkName(name) {
  return !name || JUNK_NAME_RE.test(name.trim());
}

// ---------------------------------------------------------------------------
// AI confidence gate for inferLabel output — 1-60 chars, no newlines, not a
// refusal. Mirrors the trust tiering used for AI-generated alt text: an
// unfiltered "I cannot determine this" written as aria-label is worse than
// leaving the element unlabeled. REFUSAL_RE is shared with the other output
// gates via utils/ai-output.js; the check here is unchanged.
// ---------------------------------------------------------------------------

export function isValidLabel(label) {
  if (!label || typeof label !== 'string') return false;
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return false;
  if (/\n/.test(trimmed)) return false;
  if (REFUSAL_RE.test(trimmed)) return false;
  return true;
}

// Generate label for empty or ambiguous link
export async function generateLinkLabel(link) {
  if (link.dataset.ai4a11yProcessed) return null;
  // AI-gated: only spend a call on elements that actually lack a name, and
  // skip ones that became invisible since axe's snapshot was taken.
  if (!isVisible(link)) return null;
  if (hasAccessibleName(link)) return null;
  markProcessed(link, 'pending');

  const href = link.href || '';
  const existingText = link.textContent?.trim() || '';

  // Try to infer from context first
  const context = getContextForElement(link);

  // inferLabel throws when no AI provider is configured (the norm without an
  // API key). Unguarded, the throw leaves the marker stuck at 'pending' — and
  // since 'pending' reads as truthy, the element is skipped forever with no
  // retry. Catch it and mark 'failed' like every sibling adapter does.
  let label;
  try {
    label = await inferLabel({
      elementType: 'link',
      html: link.outerHTML?.substring(0, 500) || '',
      context: [existingText, href, context].filter(Boolean).join(' | ')
    });
  } catch (e) {
    console.warn('[AI4A11y] Link label inference failed:', e.message);
    markProcessed(link, 'failed');
    return null;
  }

  if (isValidLabel(label)) {
    const trimmed = label.trim();
    link.setAttribute('aria-label', trimmed);
    markProcessed(link, 'done');
    incrementStat('labels');
    logFix('link label', link, existingText || '(empty)', trimmed);
    console.log('[AI4A11y] Generated link label:', trimmed);
    return trimmed;
  }

  markProcessed(link, 'failed');
  return null;
}

// Generate label for empty button
export async function generateButtonLabel(button) {
  if (button.dataset.ai4a11yProcessed) return null;
  if (!isVisible(button)) return null;
  if (hasAccessibleName(button)) return null;
  markProcessed(button, 'pending');

  // First, try to infer from common patterns
  const inferred = inferButtonLabel(button);
  if (inferred) {
    button.setAttribute('aria-label', inferred);
    markProcessed(button, 'done');
    incrementStat('labels');
    logFix('button label', button, '(empty)', inferred);
    return inferred;
  }

  // Fall back to AI
  const context = getContextForElement(button);

  let label;
  try {
    label = await inferLabel({
      elementType: 'button',
      html: button.outerHTML?.substring(0, 500) || '',
      context
    });
  } catch (e) {
    console.warn('[AI4A11y] Button label inference failed:', e.message);
    markProcessed(button, 'failed');
    return null;
  }

  if (isValidLabel(label)) {
    const trimmed = label.trim();
    button.setAttribute('aria-label', trimmed);
    markProcessed(button, 'done');
    incrementStat('labels');
    logFix('button label', button, '(empty)', trimmed);
    return trimmed;
  }

  markProcessed(button, 'failed');
  return null;
}

// Generate title for iframe
export async function generateIframeTitle(iframe) {
  if (iframe.dataset.ai4a11yProcessed) return null;
  if (!isVisible(iframe)) return null;
  // hasAccessibleName() covers title/aria-label/aria-labelledby — title IS
  // the accessible name for an iframe, so this is the right gate.
  if (hasAccessibleName(iframe)) return null;
  markProcessed(iframe, 'pending');

  const src = iframe.src || '';

  // Try pattern matching first
  for (const [pattern, title] of Object.entries(IFRAME_PATTERNS)) {
    if (src.includes(pattern)) {
      iframe.setAttribute('title', title);
      markProcessed(iframe, 'done');
      incrementStat('labels');
      logFix('iframe title', iframe, '(empty)', title);
      return title;
    }
  }

  // Extract hostname as fallback
  try {
    const url = new URL(src);
    const title = `Embedded content from ${url.hostname}`;
    iframe.setAttribute('title', title);
    markProcessed(iframe, 'done');
    incrementStat('labels');
    logFix('iframe title', iframe, '(empty)', title);
    return title;
  } catch {
    const title = 'Embedded content';
    iframe.setAttribute('title', title);
    markProcessed(iframe, 'done');
    return title;
  }
}

// Generate label for form input
export async function generateFormLabel(input) {
  if (input.dataset.ai4a11yProcessed) return null;
  if (!isVisible(input)) return null;
  if (hasAccessibleName(input)) return null;
  markProcessed(input, 'pending');

  // Try placeholder (junk-guarded: CSRF/token-style values make bad labels)
  if (input.placeholder && !isJunkName(input.placeholder)) {
    const label = input.placeholder.trim();
    input.setAttribute('aria-label', label);
    markProcessed(input, 'done');
    incrementStat('labels');
    logFix('form label', input, '(empty)', label);
    return label;
  }

  // Try name attribute (junk-guarded)
  if (input.name && !isJunkName(input.name)) {
    const label = input.name
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
    if (label) {
      input.setAttribute('aria-label', label);
      markProcessed(input, 'done');
      incrementStat('labels');
      logFix('form label', input, '(empty)', label);
      return label;
    }
  }

  // Try nearby text
  const nearbyText = getNearbyText(input);
  if (nearbyText && !isJunkName(nearbyText)) {
    input.setAttribute('aria-label', nearbyText);
    markProcessed(input, 'done');
    incrementStat('labels');
    logFix('form label', input, '(empty)', nearbyText);
    return nearbyText;
  }

  markProcessed(input, 'skipped');
  return null;
}

// Infer button label from class names and icons
function inferButtonLabel(button) {
  const className = button.className?.toLowerCase() || '';
  const svgPaths = button.querySelector('svg path')?.getAttribute('d') || '';

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

// Get surrounding text context
function getContextForElement(el) {
  const parent = el.parentElement;
  if (!parent) return '';

  const clone = parent.cloneNode(true);
  clone.querySelectorAll('script, style').forEach(s => s.remove());

  return clone.textContent?.trim().substring(0, 200) || '';
}

// Get text from nearby siblings
function getNearbyText(input) {
  const prev = input.previousElementSibling;
  const next = input.nextElementSibling;
  const parent = input.parentElement;

  if (prev?.textContent?.trim()) {
    return prev.textContent.trim().replace(/:$/, '');
  }

  if (next?.textContent?.trim()) {
    return next.textContent.trim().replace(/:$/, '');
  }

  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(e => e.remove());
    const text = clone.textContent?.trim();
    if (text && text.length < 50) return text.replace(/:$/, '');
  }

  return null;
}

// Axe rule ID to handler mapping
export const axeHandlers = {
  'link-name': generateLinkLabel,
  'button-name': generateButtonLabel,
  'frame-title': generateIframeTitle,
  'label': generateFormLabel,
  'select-name': generateFormLabel
};
