import { simplifyText as aiSimplifyText, summarizeText as aiSummarizeText } from '../utils/ai.js';
import { rejectRewrite, startsWithRefusal } from '../utils/ai-output.js';

// Output gate bands. A plain-language rewrite does get shorter, since it
// drops jargon and filler, but a result under this share of the input has
// almost certainly dropped ideas, and the reader cannot see what is missing.
// A result over this multiple of the input is not a simplification either;
// it is usually preamble or explanation. A summary is short by design, so
// it has no ratio floor, but it cannot be longer than the text it
// summarizes, and it has a small absolute floor: "Ok." or "N/A" is not a
// summary, and with no ratio floor nothing else would stop it from becoming
// the Summary region.
// FLAG(review): 0.3, 2, 1 and 20 are judgment calls with no measured basis yet.
const MIN_SIMPLIFIED_RATIO = 0.3;
const MAX_SIMPLIFIED_RATIO = 2;
const MAX_SUMMARY_RATIO = 1;
const MIN_SUMMARY_CHARS = 20;

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

    // Gate the answer before it replaces what the reader sees. A refusal
    // sentence or a fragment would stand in for the whole passage with no
    // sign that anything was lost. Rejected answers degrade like null.
    const rejected = simplified == null ? null
      : rejectRewrite(simplified, originalText, { minRatio: MIN_SIMPLIFIED_RATIO, maxRatio: MAX_SIMPLIFIED_RATIO });
    if (rejected) {
      console.warn(`[AI4A11y] simplifyText: rejected model output (${rejected})`);
    }

    if (simplified && !rejected) {

      element.dataset.ai4a11yOriginal = originalText;
      element.classList.add('ai4a11y-simplified');

      // Wrap existing children in a hidden span to preserve DOM tree (links, images, etc.)
      const originalWrapper = document.createElement('span');
      originalWrapper.className = 'ai4a11y-original-content';
      originalWrapper.style.display = 'none';
      while (element.firstChild) {
        originalWrapper.appendChild(element.firstChild);
      }

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
          originalWrapper.style.display = 'none';
          textContainer.style.display = '';
          toggleBtn.textContent = 'Show original';
          toggleBtn.setAttribute('aria-pressed', 'false');
          element.dataset.ai4a11yShowOriginal = 'false';
        } else {
          textContainer.style.display = 'none';
          originalWrapper.style.display = '';
          toggleBtn.textContent = 'Show simplified';
          toggleBtn.setAttribute('aria-pressed', 'true');
          element.dataset.ai4a11yShowOriginal = 'true';
        }
      };

      element.appendChild(originalWrapper);
      element.appendChild(textContainer);
      element.appendChild(toggleBtn);

      element.dataset.ai4a11ySimplified = 'done';
      incrementStat('text');
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
    const excerpt = text.substring(0, 3000);
    const summary = await aiSummarizeText(excerpt);

    // A summary is short, so the shared refusal prefixes ("Sorry", "N/A",
    // "Unknown") are checked too; for a passage that short they are far
    // more likely a non-answer than the first word of content.
    const rejected = summary == null ? null
      : (startsWithRefusal(summary) ? 'reads as a refusal'
        : rejectRewrite(summary, excerpt, { maxRatio: MAX_SUMMARY_RATIO, minChars: MIN_SUMMARY_CHARS }));
    if (rejected) {
      console.warn(`[AI4A11y] summarizeContent: rejected model output (${rejected})`);
    }

    if (summary && !rejected) {

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
      incrementStat('text');
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
  const originalWrapper = element.querySelector('.ai4a11y-original-content');
  if (originalWrapper) {
    element.querySelector('.ai4a11y-text-content')?.remove();
    element.querySelector('.ai4a11y-toggle-original')?.remove();
    while (originalWrapper.firstChild) {
      element.appendChild(originalWrapper.firstChild);
    }
    originalWrapper.remove();
  }
  delete element.dataset.ai4a11yOriginal;
  delete element.dataset.ai4a11ySimplified;
  delete element.dataset.ai4a11yShowOriginal;
  element.classList.remove('ai4a11y-simplified');
}
