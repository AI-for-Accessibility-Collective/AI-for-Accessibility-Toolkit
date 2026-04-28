import { simplifyText as aiSimplifyText, summarizeText as aiSummarizeText } from '../utils/ai.js';
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Simplify complex text for easier reading
export async function simplifyText(element) {
  if (element.dataset.ai4a11ySimplified) return null;
  element.dataset.ai4a11ySimplified = 'pending';

  // Skip tables or elements containing tables (data should not be simplified)
  if (element.tagName === 'TABLE' || element.querySelector('table')) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  const originalText = element.textContent?.trim();
  // Min 100 chars, max 10000 chars to prevent API overload
  if (!originalText || originalText.length < 100 || originalText.length > 10000) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  try {
    const simplified = await aiSimplifyText(originalText);

    if (simplified) {

      // Store original
      element.dataset.ai4a11yOriginal = originalText;
      element.classList.add('ai4a11y-simplified');

      // Create text container to avoid toggle button destruction on text swap
      const textContainer = document.createElement('span');
      textContainer.className = 'ai4a11y-text-content';
      textContainer.textContent = simplified;

      // Add toggle button
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

      // Clear element and add container + button
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

// Add summary to long content
export async function summarizeContent(element) {
  if (element.dataset.ai4a11ySummarize) return null;
  element.dataset.ai4a11ySummarize = 'pending';

  // Skip pure data tables - they don't need prose summaries
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

      // Create summary box (build DOM to prevent XSS)
      const summaryBox = document.createElement('div');
      summaryBox.className = 'ai4a11y-summary-box';
      summaryBox.setAttribute('role', 'region');
      summaryBox.setAttribute('aria-label', 'Summary');

      const header = document.createElement('div');
      header.className = 'ai4a11y-summary-header';
      const icon = document.createElement('span');
      icon.className = 'ai4a11y-summary-icon';
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
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

// Restore original text
export function restoreOriginal(element) {
  const original = element.dataset.ai4a11yOriginal;
  if (original) {
    element.textContent = original;
    delete element.dataset.ai4a11yOriginal;
    delete element.dataset.ai4a11ySimplified;
  }
}
