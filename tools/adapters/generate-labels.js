import { inferLabel } from '../utils/ai.js';
import { markProcessed, getAccessibleName } from '../utils/dom.js';
import { IFRAME_PATTERNS } from '../constants.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Generate label for empty or ambiguous link
export async function generateLinkLabel(link) {
  if (link.dataset.ai4a11yProcessed) return null;
  markProcessed(link, 'pending');

  const href = link.href || '';
  const existingText = link.textContent?.trim() || '';

  // Try to infer from context first
  const context = getContextForElement(link);

  const label = await inferLabel({
    elementType: 'link',
    html: link.outerHTML?.substring(0, 500) || '',
    context: [existingText, href, context].filter(Boolean).join(' | ')
  });

  if (label) {
    link.setAttribute('aria-label', label);
    markProcessed(link, 'done');
    incrementStat('labels');
    logFix('link label', link, existingText || '(empty)', label);
    console.log('[AI4A11y] Generated link label:', label);
    return label;
  }

  markProcessed(link, 'failed');
  return null;
}

// Generate label for empty button
export async function generateButtonLabel(button) {
  if (button.dataset.ai4a11yProcessed) return null;
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

  const label = await inferLabel({
    elementType: 'button',
    html: button.outerHTML?.substring(0, 500) || '',
    context
  });

  if (label) {
    button.setAttribute('aria-label', label);
    markProcessed(button, 'done');
    incrementStat('labels');
    logFix('button label', button, '(empty)', label);
    return label;
  }

  markProcessed(button, 'failed');
  return null;
}

// Generate title for iframe
export async function generateIframeTitle(iframe) {
  if (iframe.dataset.ai4a11yProcessed) return null;
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
  markProcessed(input, 'pending');

  // Try placeholder
  if (input.placeholder) {
    input.setAttribute('aria-label', input.placeholder);
    markProcessed(input, 'done');
    incrementStat('labels');
    logFix('form label', input, '(empty)', input.placeholder);
    return input.placeholder;
  }

  // Try name attribute
  if (input.name) {
    const label = input.name
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();
    input.setAttribute('aria-label', label);
    markProcessed(input, 'done');
    incrementStat('labels');
    logFix('form label', input, '(empty)', label);
    return label;
  }

  // Try nearby text
  const nearbyText = getNearbyText(input);
  if (nearbyText) {
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
