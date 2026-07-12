import { simplifyText as aiSimplifyText, summarizeText as aiSummarizeText } from '../../utils/ai.js';
import { markProcessed } from '../../utils/dom.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

export async function simplifyText(element) {
  if (element.dataset.ai4a11ySimplified) return null;
  element.dataset.ai4a11ySimplified = 'pending';

  if (element.tagName === 'TABLE' || element.querySelector('table')) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  const originalText = element.textContent?.trim();
  if (!originalText || originalText.length < 100 || originalText.length > 10000) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  try {
    const simplified = await aiSimplifyText(originalText);

    if (simplified) {
      element.dataset.ai4a11yOriginal = originalText;
      element.classList.add('ai4a11y-simplified');

      const textContainer = document.createElement('span');
      textContainer.className = 'ai4a11y-text-content';
      textContainer.textContent = simplified;

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'ai4a11y-toggle-original';
      toggleBtn.textContent = 'Show original';
      toggleBtn.setAttribute('aria-pressed', 'false');
      toggleBtn.onclick = () => {
        const showingOriginal = element.dataset.ai4a11yShowOriginal === 'true';
        if (showingOriginal) {
          textContainer.textContent = simplified;
          toggleBtn.textContent = 'Show original';
          toggleBtn.setAttribute('aria-pressed', 'false');
          element.dataset.ai4a11yShowOriginal = 'false';
        } else {
          textContainer.textContent = originalText;
          toggleBtn.textContent = 'Show simplified';
          toggleBtn.setAttribute('aria-pressed', 'true');
          element.dataset.ai4a11yShowOriginal = 'true';
        }
      };

      element.textContent = '';
      element.appendChild(textContainer);
      element.appendChild(toggleBtn);

      element.dataset.ai4a11ySimplified = 'done';
      incrementStat('wcag');
      logFix('simplify', element, '(complex)', '(simplified)');
      console.log('[AI4A11y] Simplified text');
      return simplified;
    }

    element.dataset.ai4a11ySimplified = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to simplify:', e);
    element.dataset.ai4a11ySimplified = 'failed';
    return null;
  }
}

export async function summarizeContent(element) {
  if (element.dataset.ai4a11ySummarize) return null;
  element.dataset.ai4a11ySummarize = 'pending';

  if (element.tagName === 'TABLE') {
    element.dataset.ai4a11ySummarize = 'skipped';
    return null;
  }

  const text = element.textContent?.trim();
  if (!text || text.length < 500) {
    element.dataset.ai4a11ySummarize = 'skipped';
    return null;
  }

  try {
    const summary = await aiSummarizeText(text.substring(0, 3000));

    if (summary) {
      const summaryBox = document.createElement('div');
      summaryBox.className = 'ai4a11y-summary-box';
      summaryBox.setAttribute('role', 'region');
      summaryBox.setAttribute('aria-label', 'Summary');

      const header = document.createElement('div');
      header.className = 'ai4a11y-summary-header';
      const icon = document.createElement('span');
      icon.className = 'ai4a11y-summary-icon';
      icon.textContent = '📋';
      const headerText = document.createElement('span');
      headerText.textContent = 'Summary';
      header.appendChild(icon);
      header.appendChild(headerText);

      const content = document.createElement('div');
      content.className = 'ai4a11y-summary-content';
      content.textContent = summary;

      summaryBox.appendChild(header);
      summaryBox.appendChild(content);

      element.insertBefore(summaryBox, element.firstChild);
      element.dataset.ai4a11ySummarize = 'done';
      incrementStat('wcag');
      logFix('summarize', element, '(long)', '(summarized)');
      return summary;
    }

    element.dataset.ai4a11ySummarize = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to summarize:', e);
    element.dataset.ai4a11ySummarize = 'failed';
    return null;
  }
}

export function restoreOriginal(element) {
  const original = element.dataset.ai4a11yOriginal;
  if (original) {
    element.textContent = original;
    delete element.dataset.ai4a11yOriginal;
    delete element.dataset.ai4a11ySimplified;
  }
}

export const SimplifyText = {
  enabled: false,

  async enable() {
    this.enabled = true;
    const blocks = Array.from(document.querySelectorAll('p, li, td'))
      .filter(el => !el.dataset.ai4a11ySimplified && !el.querySelector('p, div') && el.textContent.length > 100);

    for (const el of blocks.slice(0, 20)) {
      if (!this.enabled) break;
      await simplifyText(el);
    }
  },

  disable() {
    this.enabled = false;
    document.querySelectorAll('[data-ai4a11y-original]').forEach(el => {
      restoreOriginal(el);
    });
    document.querySelectorAll('.ai4a11y-summary-box').forEach(el => el.remove());
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
