// Check if element is visible
export function isVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Check if element has accessible name
export function hasAccessibleName(el) {
  if (el.getAttribute('aria-label')) return true;
  if (el.getAttribute('title')) return true;
  if (el.textContent?.trim()) return true;

  // Verify aria-labelledby target actually exists and has content
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target?.textContent?.trim()) return true;
  }

  return false;
}

// Get accessible name of element
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

// Mark element as processed by AI4A11y
export function markProcessed(el, status = 'done') {
  el.dataset.ai4a11yProcessed = status;
}

// Check if element was already processed
export function wasProcessed(el) {
  return !!el.dataset.ai4a11yProcessed;
}

// Clear all AI4A11y processing marks
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

// Sleep utility
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Escape CSS selector
export function escapeSelector(str) {
  return CSS.escape(str);
}
