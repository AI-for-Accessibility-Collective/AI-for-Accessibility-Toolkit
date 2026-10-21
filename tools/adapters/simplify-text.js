import { simplifyText as aiSimplifyText, summarizeText as aiSummarizeText, announce, getAIProvider } from '../utils/ai.js';
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

// Rewrites kept for the session, and the ones on their way: switching the
// adapter off and on again, or the same text twice on a page, costs no
// second AI call. Kept per provider, since another host gives other answers.
const memories = new WeakMap(); // provider -> { done: Map, asking: Map }
const MEMORY_MAX = 200;
function memoryFor() {
  const p = getAIProvider() || memoryFor;
  if (!memories.has(p)) memories.set(p, { done: new Map(), asking: new Map() });
  return memories.get(p);
}
function rewrite(text) {
  const m = memoryFor();
  if (m.done.has(text)) return Promise.resolve(m.done.get(text));
  if (!m.asking.has(text)) {
    m.asking.set(text, Promise.resolve().then(() => aiSimplifyText(text)).finally(() => m.asking.delete(text)));
  }
  return m.asking.get(text);
}
function keep(text, simplified) {
  const m = memoryFor();
  if (m.done.size >= MEMORY_MAX) m.done.delete(m.done.keys().next().value);
  m.done.set(text, simplified);
}

// The "Show original" button's focus ring is a box-shadow: pages that switch
// the focus outline off with !important cannot hide it.
const STYLE_ID = 'ai4a11y-simplify-styles';
function addStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = '.ai4a11y-toggle-original{margin-left:.5em;font-size:.85em;cursor:pointer}' +
    '.ai4a11y-toggle-original:focus-visible{outline:2px solid #1a5fb4;outline-offset:2px;box-shadow:0 0 0 2px #fff,0 0 0 4px #1a5fb4}';
  (document.head || document.documentElement).appendChild(style);
}

// One message for a batch of rewrites instead of one per paragraph.
let rewritten = 0, sayTimer = null;
function tell() {
  rewritten++;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    announce(`Rewrote ${rewritten} passage${rewritten === 1 ? '' : 's'} in plainer words. Each has a Show original button.`);
    rewritten = 0;
  }, 400);
}

// Children whose text is not prose the reader sees: element.textContent
// includes a <style> or <script> body, a <noscript> or <template>, and
// anything carrying the hidden attribute or aria-hidden="true". Measuring
// the floor and the ratio against that would reject a faithful rewrite of
// the visible prose and mark the element failed for good, and the model
// would be sent text the reader never saw.
// FLAG(review): only those markers. Text hidden by CSS alone (display:none
// from a stylesheet or a class) is still counted, because reading it back
// needs getComputedStyle on every node, which is a layout cost on a pass
// that runs over every candidate on the page.
const NOT_PROSE_SEL = 'style, script, noscript, template, [hidden], [aria-hidden="true"]';

// The visible prose of an element: its text with the children above removed,
// trimmed. Computed on a clone so the page is untouched. This is what is
// sent to the model, what the length checks measure, and what the CLI's
// candidate selection counts.
export function proseText(element) {
  if (!element || typeof element.cloneNode !== 'function') return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll(NOT_PROSE_SEL).forEach((n) => n.remove());
  return clone.textContent?.trim() || '';
}

// Simplify complex text for easier reading
export async function simplifyText(element) {
  if (element.dataset.ai4a11ySimplified) return null;
  element.dataset.ai4a11ySimplified = 'pending';

  // Skip tables or elements containing tables (data should not be simplified)
  if (element.tagName === 'TABLE' || element.querySelector('table')) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  const originalText = proseText(element);
  // Min 100 chars, max 10000 chars to prevent API overload
  if (!originalText || originalText.length < 100 || originalText.length > 10000) {
    element.dataset.ai4a11ySimplified = 'skipped';
    return null;
  }

  try {
    const simplified = await rewrite(originalText);
    // Switched off while the answer was on its way.
    if (element.dataset.ai4a11ySimplified !== 'pending') return null;

    // Gate the answer before it replaces what the reader sees. A refusal
    // sentence or a fragment would stand in for the whole passage with no
    // sign that anything was lost. Rejected answers degrade like null.
    const rejected = simplified == null ? null
      : rejectRewrite(simplified, originalText, { minRatio: MIN_SIMPLIFIED_RATIO, maxRatio: MAX_SIMPLIFIED_RATIO });
    if (rejected) {
      console.warn(`[AI4A11y] simplifyText: rejected model output (${rejected})`);
    }

    if (simplified && !rejected) {
      keep(originalText, simplified);
      addStyles();

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
      // type=button: inside a form, a plain <button> would submit it.
      toggleBtn.type = 'button';
      toggleBtn.className = 'ai4a11y-toggle-original';
      toggleBtn.textContent = 'Show original';
      // The label says what a press does next, so it carries no
      // aria-pressed: "Show simplified, pressed" contradicts itself.
      toggleBtn.onclick = () => {
        const showingOriginal = element.dataset.ai4a11yShowOriginal === 'true';
        if (showingOriginal) {
          originalWrapper.style.display = 'none';
          textContainer.style.display = '';
          toggleBtn.textContent = 'Show original';
          element.dataset.ai4a11yShowOriginal = 'false';
        } else {
          textContainer.style.display = 'none';
          originalWrapper.style.display = '';
          toggleBtn.textContent = 'Show simplified';
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
      tell();
      return simplified;
    }

    element.dataset.ai4a11ySimplified = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to simplify:', e);
    if (element.dataset.ai4a11ySimplified === 'pending') element.dataset.ai4a11ySimplified = 'failed';
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

  const text = proseText(element);
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
    // The button about to go has focus: keep the keyboard in this paragraph.
    const toggle = element.querySelector('.ai4a11y-toggle-original');
    if (toggle && toggle === document.activeElement && !element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
      element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
      queueMicrotask(() => { try { element.focus({ preventScroll: true }); } catch { /* not focusable */ } });
    }
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
  if (!element.getAttribute('class')) element.removeAttribute('class');
  if (typeof document !== 'undefined' && !document.querySelector('.ai4a11y-simplified')) document.getElementById(STYLE_ID)?.remove();
}
