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
  return el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || '';
}

export function markProcessed(el, status = 'done') {
  el.dataset.ai4a11yProcessed = status;
}

export function wasProcessed(el) {
  return !!el.dataset.ai4a11yProcessed;
}

export const isProcessed = wasProcessed;

export function clearAllMarks() {
  document.querySelectorAll('[data-ai4a11y-processed]').forEach(el => {
    delete el.dataset.ai4a11yProcessed;
  });
  document.querySelectorAll('[data-ai4a11y-described]').forEach(el => {
    delete el.dataset.ai4a11yDescribed;
  });
  document.querySelectorAll('[data-ai4a11y-simplified]').forEach(el => {
    delete el.dataset.ai4a11ySimplified;
  });
  document.querySelectorAll('[data-ai4a11y-summarize]').forEach(el => {
    delete el.dataset.ai4a11ySummarize;
  });
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
