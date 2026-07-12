import { simplifyText as aiSimplifyText, summarizeText as aiSummarizeText } from '../../utils/ai.js';
import { markProcessed, isVisible } from '../../utils/dom.js';
import { registerSweep } from '../../utils/observe.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

// ---------------------------------------------------------------------------
// Cache: per (url, hash-of-original) → simplified text.
// Prefer chrome.storage.session when available (survives open tabs, cleared on
// browser restart); fall back to a module-level Map (in-page memory).
// ---------------------------------------------------------------------------
const _memCache = new Map();

function _cacheKey(url, originalText) {
  // Fast djb2-style hash so we don't store the full original text as a key.
  let hash = 5381;
  for (let i = 0; i < Math.min(originalText.length, 2000); i++) {
    hash = ((hash << 5) + hash) ^ originalText.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return `ai4a11y-simplify:${url}:${hash}`;
}

async function _cacheGet(key) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const result = await chrome.storage.session.get(key);
      return result[key] ?? null;
    }
  } catch { /* session API unavailable */ }
  return _memCache.get(key) ?? null;
}

async function _cacheSet(key, value) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: value });
      return;
    }
  } catch { /* session API unavailable */ }
  _memCache.set(key, value);
}

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

// Landmark roles whose descendants should be skipped for budget preservation.
const SKIP_ROLES = new Set(['navigation', 'banner', 'contentinfo']);
const SKIP_TAGS = new Set(['NAV', 'FOOTER', 'HEADER', 'ASIDE']);

function _shouldSkip(el) {
  // Skip anything inside the reader-mode overlay to avoid double-burn.
  if (el.closest('#ai4a11y-reader-mode')) return true;
  // Walk up to check landmark ancestors.
  let cur = el.parentElement;
  while (cur && cur !== document.body) {
    if (SKIP_TAGS.has(cur.tagName)) return true;
    const role = cur.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    cur = cur.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Batched simplification: up to 5 elements per Gemini call.
// Elements joined by a sentinel delimiter; response split on same delimiter.
// On count mismatch → fall back to per-element calls.
// ---------------------------------------------------------------------------
const BATCH_DELIMITER = '\n---AI4A11Y_SPLIT---\n';

async function _simplifyBatch(elements) {
  const originals = elements.map(el => el.textContent?.trim() || '');
  const joined = originals.join(BATCH_DELIMITER);
  const prompt = `Simplify each of the following ${elements.length} text blocks to a 6th-grade reading level. Keep the meaning but use simpler words and shorter sentences. Return ONLY the simplified texts, each separated by exactly this delimiter: ---AI4A11Y_SPLIT---\n\n${joined}`;
  try {
    const raw = await aiSimplifyText(prompt, { raw: true });
    if (!raw) return null;
    const parts = raw.split(/\n?---AI4A11Y_SPLIT---\n?/);
    if (parts.length === elements.length) return parts.map(s => s.trim());
  } catch { /* fall through to per-element */ }
  return null;
}

// ---------------------------------------------------------------------------
// DOM-preserving wrapper: port from the legacy tools/adapters fork.
// Original child nodes are moved into a hidden <span>; simplified text goes
// into a sibling span; "Show original" button is placed AFTER the paragraph
// as a sibling (not inside — avoids invalid content model for <p>).
// ---------------------------------------------------------------------------
export async function simplifyText(element, simplified, paragraphIndex) {
  element.dataset.ai4a11ySimplified = 'done';
  element.classList.add('ai4a11y-simplified');

  // Wrap original children in a hidden span (live DOM nodes, not serialized).
  const originalWrapper = document.createElement('span');
  originalWrapper.className = 'ai4a11y-original-content';
  originalWrapper.setAttribute('hidden', '');
  while (element.firstChild) {
    originalWrapper.appendChild(element.firstChild);
  }

  const textContainer = document.createElement('span');
  textContainer.className = 'ai4a11y-text-content';
  textContainer.textContent = simplified;

  element.appendChild(originalWrapper);
  element.appendChild(textContainer);

  // Button goes AFTER the element as a sibling (not inside <p> — invalid).
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'ai4a11y-toggle-original';
  const label = `Show original text for paragraph ${paragraphIndex}`;
  toggleBtn.setAttribute('aria-label', label);
  toggleBtn.textContent = 'Show original';
  toggleBtn.setAttribute('aria-pressed', 'false');

  toggleBtn.onclick = () => {
    const showingOriginal = element.dataset.ai4a11yShowOriginal === 'true';
    if (showingOriginal) {
      originalWrapper.setAttribute('hidden', '');
      textContainer.removeAttribute('hidden');
      toggleBtn.textContent = 'Show original';
      toggleBtn.setAttribute('aria-label', label);
      toggleBtn.setAttribute('aria-pressed', 'false');
      element.dataset.ai4a11yShowOriginal = 'false';
    } else {
      textContainer.setAttribute('hidden', '');
      originalWrapper.removeAttribute('hidden');
      toggleBtn.textContent = 'Show simplified';
      toggleBtn.setAttribute('aria-label', `Show simplified text for paragraph ${paragraphIndex}`);
      toggleBtn.setAttribute('aria-pressed', 'true');
      element.dataset.ai4a11yShowOriginal = 'true';
    }
  };

  // Insert the button immediately after the element.
  if (element.nextSibling) {
    element.parentNode.insertBefore(toggleBtn, element.nextSibling);
  } else {
    element.parentNode.appendChild(toggleBtn);
  }

  incrementStat('wcag');
  logFix('simplify', element, '(complex)', '(simplified)');
}

export function restoreOriginal(element) {
  const originalWrapper = element.querySelector('.ai4a11y-original-content');
  if (originalWrapper) {
    element.querySelector('.ai4a11y-text-content')?.remove();
    // Move original children back to the element.
    while (originalWrapper.firstChild) {
      element.appendChild(originalWrapper.firstChild);
    }
    originalWrapper.remove();
  }
  // Remove the sibling toggle button if present.
  const sibling = element.nextSibling;
  if (sibling?.classList?.contains('ai4a11y-toggle-original')) {
    sibling.remove();
  }
  delete element.dataset.ai4a11yOriginal;
  delete element.dataset.ai4a11ySimplified;
  delete element.dataset.ai4a11yShowOriginal;
  element.classList.remove('ai4a11y-simplified');
}

// ---------------------------------------------------------------------------
// Public adapter object
// ---------------------------------------------------------------------------
export const SimplifyText = {
  enabled: false,
  _unregisterSweep: null,

  async enable() {
    this.enabled = true;

    // Read which modes are active directly from storage (compatible with
    // content.js calling enable() with no args for both autoSimplify and
    // autoSummarize).
    let autoSimplify = false;
    let autoSummarize = false;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const s = await chrome.storage.sync.get(['autoSimplify', 'autoSummarize']);
        autoSimplify = s.autoSimplify === true;
        autoSummarize = s.autoSummarize === true;
      }
    } catch { /* storage unavailable in test env */ }

    // When called with no storage context (e.g. direct enable() call without
    // either flag set), treat as autoSimplify=true so the adapter does something.
    if (!autoSimplify && !autoSummarize) autoSimplify = true;

    if (!this.enabled) return;

    if (autoSummarize) {
      await this._runSummarize();
    }

    if (!this.enabled) return;

    if (autoSimplify) {
      await this._runSimplify();
    }

    // Register sweep for late/dynamic content.
    if (!this._unregisterSweep) {
      this._unregisterSweep = registerSweep('simplify-text', async ({ reason }) => {
        if (!this.enabled) return;
        if (reason === 'urlchange') {
          // New page — re-run both modes.
          if (autoSummarize) await this._runSummarize();
          if (!this.enabled) return;
          if (autoSimplify) await this._runSimplify();
        } else {
          // Mutation — only simplify newly added paragraphs.
          if (autoSimplify) await this._runSimplify();
        }
      }, { debounceMs: 800 });
    }
  },

  async _runSummarize() {
    // Page-level summary: use document.body as the target.
    await summarizeContent(document.body);
  },

  async _runSimplify() {
    const url = typeof location !== 'undefined' ? location.href : '';

    // Candidate elements: p and li only (no td — data corruption risk).
    // Document order; skip boilerplate regions; skip already-processed.
    const candidates = Array.from(
      document.querySelectorAll('p, li')
    ).filter(el => {
      if (el.dataset.ai4a11ySimplified) return false;
      if (_shouldSkip(el)) return false;
      if (!isVisible(el)) return false;
      // Skip if the element itself contains block children (structural container).
      if (el.querySelector('p, div, section, article')) return false;
      const text = el.textContent?.trim() || '';
      return text.length >= 100 && text.length <= 10000;
    }).slice(0, 20); // first-20 cap in document order (content-first after landmark filter)

    if (candidates.length === 0) return;

    // Batch up to 5 at a time.
    for (let i = 0; i < candidates.length; i += 5) {
      if (!this.enabled) break;
      const batch = candidates.slice(i, i + 5);

      // Check cache for each element first.
      const toFetch = [];
      const cachedResults = [];
      for (const el of batch) {
        const originalText = el.textContent?.trim() || '';
        const key = _cacheKey(url, originalText);
        const cached = await _cacheGet(key);
        if (cached) {
          cachedResults.push({ el, simplified: cached, key });
        } else {
          toFetch.push({ el, originalText, key });
        }
      }

      // Apply cached results.
      for (const { el, simplified } of cachedResults) {
        if (!this.enabled) break;
        el.dataset.ai4a11ySimplified = 'pending';
        await simplifyText(el, simplified, i + batch.indexOf(el) + 1);
      }

      if (!this.enabled) break;

      // Fetch uncached in a batch call.
      if (toFetch.length > 0) {
        const batchResults = await _simplifyBatch(toFetch.map(t => t.el));
        if (batchResults && batchResults.length === toFetch.length) {
          for (let j = 0; j < toFetch.length; j++) {
            if (!this.enabled) break;
            const { el, key } = toFetch[j];
            const simplified = batchResults[j];
            if (simplified) {
              await _cacheSet(key, simplified);
              await simplifyText(el, simplified, i + batch.indexOf(el) + 1);
            } else {
              el.dataset.ai4a11ySimplified = 'failed';
            }
          }
        } else {
          // Fallback: per-element calls.
          for (const { el, originalText, key } of toFetch) {
            if (!this.enabled) break;
            el.dataset.ai4a11ySimplified = 'pending';
            try {
              const simplified = await aiSimplifyText(originalText);
              if (!this.enabled) break;
              if (simplified) {
                await _cacheSet(key, simplified);
                await simplifyText(el, simplified, i + toFetch.indexOf({ el, originalText, key }) + 1);
              } else {
                el.dataset.ai4a11ySimplified = 'failed';
              }
            } catch (e) {
              console.warn('[AI4A11y] Failed to simplify:', e);
              el.dataset.ai4a11ySimplified = 'failed';
            }
          }
        }
      }
    }
  },

  disable() {
    this.enabled = false;
    if (this._unregisterSweep) {
      this._unregisterSweep();
      this._unregisterSweep = null;
    }
    // Restore all simplified elements (DOM-preserving unwrap).
    document.querySelectorAll('[data-ai4a11y-simplified]').forEach(el => {
      restoreOriginal(el);
    });
    // Remove summary boxes.
    document.querySelectorAll('.ai4a11y-summary-box').forEach(el => el.remove());
    document.querySelectorAll('[data-ai4a11y-summarize]').forEach(el => {
      delete el.dataset.ai4a11ySummarize;
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

// ---------------------------------------------------------------------------
// summarizeContent: page-level summary box (the autoSummarize feature).
// Previously dead code — now called from _runSummarize().
// ---------------------------------------------------------------------------
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

    if (!SimplifyText.enabled) return null; // re-check after await

    if (summary) {
      const summaryBox = document.createElement('div');
      summaryBox.className = 'ai4a11y-summary-box';
      summaryBox.setAttribute('role', 'region');
      summaryBox.setAttribute('aria-label', 'Page Summary');

      const header = document.createElement('div');
      header.className = 'ai4a11y-summary-header';
      const headerText = document.createElement('span');
      headerText.textContent = 'Summary';
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

// ---------------------------------------------------------------------------
// Exported helpers for unit testing pure logic without a browser.
// ---------------------------------------------------------------------------
export { _cacheKey, _shouldSkip, BATCH_DELIMITER };
