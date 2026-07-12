export function isVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function hasAccessibleName(el) {
  if (el.getAttribute('aria-label')) return true;
  if (el.getAttribute('title')) return true;
  if (el.textContent?.trim()) return true;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target?.textContent?.trim()) return true;
  }
  return false;
}

export function getAccessibleName(el) {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  if (el.getAttribute('title')) return el.getAttribute('title');

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target?.textContent?.trim()) return target.textContent.trim();
  }

  return el.textContent?.trim() || '';
}

// ---------------------------------------------------------------------------
// Namespaced processed-marks
//
// Each adapter passes its own namespace so adapters never skip each other's
// elements silently (the old shared 'data-ai4a11yProcessed' flag caused this).
//
// State machine per (element, namespace):
//   'pending' — in flight; wasProcessed returns true (don't enqueue again)
//   'done'    — successfully processed; wasProcessed returns true
//   'failed'  — errored; wasProcessed returns FALSE so the next sweep retries
//
// Attribute name: data-ai4a11y-<namespace>
// ---------------------------------------------------------------------------

function _attrName(ns) {
  return `data-ai4a11y-${ns}`;
}

/**
 * Mark an element's processing state for a given namespace.
 * @param {Element} el
 * @param {'done'|'pending'|'failed'} state
 * @param {string} [ns='shared']
 */
export function markProcessed(el, state = 'done', ns = 'shared') {
  el.setAttribute(_attrName(ns), state);
}

/**
 * Returns true only when the element has been successfully processed (done)
 * or is currently in flight (pending) — so the sweep won't enqueue it again.
 * 'failed' returns false, making the element retryable on the next sweep.
 * @param {Element} el
 * @param {string} [ns='shared']
 */
export function wasProcessed(el, ns = 'shared') {
  const state = el.getAttribute(_attrName(ns));
  return state === 'done' || state === 'pending';
}

export const isProcessed = wasProcessed;

/**
 * Returns the raw state string ('done'|'pending'|'failed'|null).
 * @param {Element} el
 * @param {string} [ns='shared']
 */
export function getProcessedState(el, ns = 'shared') {
  return el.getAttribute(_attrName(ns));
}

/**
 * Remove all processed-marks for a given namespace from the whole document,
 * or (when ns is omitted) remove all ai4a11y-* marks across every namespace.
 * Used by the 'rescan' path so a fresh sweep can re-visit all elements.
 * @param {string} [ns]  If omitted, clears every data-ai4a11y-* attribute.
 */
export function clearMarks(ns) {
  if (ns) {
    document.querySelectorAll(`[${_attrName(ns)}]`).forEach(el => el.removeAttribute(_attrName(ns)));
  } else {
    // Collect all unique ai4a11y attribute names present in the document,
    // then remove them — avoids hard-coding the namespace list.
    const attrs = new Set();
    document.querySelectorAll('[data-ai4a11y-alt],[data-ai4a11y-labels],[data-ai4a11y-contrast],[data-ai4a11y-wcag],[data-ai4a11y-simplify],[data-ai4a11y-captions],[data-ai4a11y-shared]').forEach(el => {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-ai4a11y-')) attrs.add(attr.name);
      }
    });
    // Also sweep any stragglers via a broader selector.
    document.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-ai4a11y-') && !attr.name.startsWith('data-ai4a11y-gif') && !attr.name.startsWith('data-ai4a11y-was') && !attr.name.startsWith('data-ai4a11y-original') && !attr.name.startsWith('data-ai4a11y-show') && !attr.name.startsWith('data-ai4a11y-generated')) {
          el.removeAttribute(attr.name);
        }
      }
    });
  }
}

// Keep legacy clearAllMarks so nothing outside our migration breaks.
export function clearAllMarks() {
  clearMarks();
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function escapeSelector(str) {
  return CSS.escape(str);
}

export function injectCSS(id, css) {
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export function removeCSS(id) {
  document.getElementById(id)?.remove();
}
