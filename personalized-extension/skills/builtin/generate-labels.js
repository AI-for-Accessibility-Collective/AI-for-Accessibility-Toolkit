import { inferLabel } from '../../utils/ai.js';
import { markProcessed, getAccessibleName } from '../../utils/dom.js';
import { IFRAME_PATTERNS } from '../../utils/constants.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

export async function generateLinkLabel(link) {
  if (link.dataset.ai4a11yProcessed) return null;
  markProcessed(link, 'pending');

  const href = link.href || '';
  const existingText = link.textContent?.trim() || '';
  const context = getContextForElement(link);

  // inferLabel throws with no AI provider; unguarded, the marker stays
  // 'pending' (truthy) and the link is skipped forever. Mark 'failed' instead.
  let label;
  try {
    label = await inferLabel({
      url: href,
      elementType: 'link',
      existingText,
      context
    });
  } catch (e) {
    console.warn('[AI4A11y] Link label inference failed:', e.message);
    markProcessed(link, 'failed');
    return null;
  }

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

export async function generateButtonLabel(button) {
  if (button.dataset.ai4a11yProcessed) return null;
  markProcessed(button, 'pending');

  const inferred = inferButtonLabel(button);
  if (inferred) {
    button.setAttribute('aria-label', inferred);
    markProcessed(button, 'done');
    incrementStat('labels');
    logFix('button label', button, '(empty)', inferred);
    return inferred;
  }

  const context = getContextForElement(button);
  const svgContent = button.querySelector('svg')?.outerHTML || '';

  let label;
  try {
    label = await inferLabel({
      elementType: 'button',
      context,
      svgContent
    });
  } catch (e) {
    console.warn('[AI4A11y] Button label inference failed:', e.message);
    markProcessed(button, 'failed');
    return null;
  }

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

export async function generateIframeTitle(iframe) {
  if (iframe.dataset.ai4a11yProcessed) return null;
  markProcessed(iframe, 'pending');

  const src = iframe.src || '';

  for (const [pattern, title] of Object.entries(IFRAME_PATTERNS)) {
    if (src.includes(pattern)) {
      iframe.setAttribute('title', title);
      markProcessed(iframe, 'done');
      incrementStat('labels');
      logFix('iframe title', iframe, '(empty)', title);
      return title;
    }
  }

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

export async function generateFormLabel(input) {
  if (input.dataset.ai4a11yProcessed) return null;
  markProcessed(input, 'pending');

  if (input.placeholder) {
    input.setAttribute('aria-label', input.placeholder);
    markProcessed(input, 'done');
    incrementStat('labels');
    logFix('form label', input, '(empty)', input.placeholder);
    return input.placeholder;
  }

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

function getContextForElement(el) {
  const parent = el.parentElement;
  if (!parent) return '';

  const clone = parent.cloneNode(true);
  clone.querySelectorAll('script, style').forEach(s => s.remove());

  return clone.textContent?.trim().substring(0, 200) || '';
}

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

export const axeHandlers = {
  'link-name': generateLinkLabel,
  'button-name': generateButtonLabel,
  'frame-title': generateIframeTitle,
  'label': generateFormLabel,
  'select-name': generateFormLabel
};

export const GenerateLabels = {
  enabled: false,

  async enable() {
    this.enabled = true;
    const links = document.querySelectorAll('a:not([aria-label])');
    for (const link of links) {
      if (!this.enabled) break;
      if (!link.textContent?.trim() && !link.getAttribute('aria-label')) {
        await generateLinkLabel(link);
      }
    }

    const buttons = document.querySelectorAll('button:not([aria-label])');
    for (const btn of buttons) {
      if (!this.enabled) break;
      if (!btn.textContent?.trim() && !btn.getAttribute('aria-label')) {
        await generateButtonLabel(btn);
      }
    }

    const iframes = document.querySelectorAll('iframe:not([title])');
    for (const iframe of iframes) {
      if (!this.enabled) break;
      await generateIframeTitle(iframe);
    }

    const inputs = document.querySelectorAll('input:not([aria-label]):not([id]), select:not([aria-label]):not([id]), textarea:not([aria-label]):not([id])');
    for (const input of inputs) {
      if (!this.enabled) break;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      if (!hasLabel) {
        await generateFormLabel(input);
      }
    }
  },

  disable() {
    this.enabled = false;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
