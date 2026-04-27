import { isVisible, wasProcessed, hasAccessibleName } from '../utils/dom.js';

// Find links without accessible names
export function findEmptyLinks() {
  return Array.from(document.querySelectorAll('a[href]'))
    .filter(link => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;

      return !hasAccessibleName(link);
    });
}

// Find links with ambiguous text
export function findAmbiguousLinks() {
  const ambiguousTexts = [
    'click here',
    'here',
    'read more',
    'more',
    'learn more',
    'continue',
    'link',
    'this',
    'this link'
  ];

  return Array.from(document.querySelectorAll('a[href]'))
    .filter(link => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;

      const text = link.textContent?.trim().toLowerCase();
      return text && ambiguousTexts.includes(text);
    });
}

// Find buttons without accessible names
export function findEmptyButtons() {
  const buttons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('[role="button"]')
  ];

  return buttons.filter(btn => {
    if (wasProcessed(btn)) return false;
    if (!isVisible(btn)) return false;

    return !hasAccessibleName(btn);
  });
}

// Find form inputs without labels
export function findUnlabeledInputs() {
  const inputs = document.querySelectorAll('input, select, textarea');

  return Array.from(inputs).filter(input => {
    if (wasProcessed(input)) return false;
    if (!isVisible(input)) return false;

    // Skip hidden inputs
    if (input.type === 'hidden') return false;

    // Has aria-label or aria-labelledby
    if (input.getAttribute('aria-label')) return false;
    if (input.getAttribute('aria-labelledby')) return false;

    // Has associated label via for attribute
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return false;
    }

    // Is inside a label
    if (input.closest('label')) return false;

    // Has title attribute
    if (input.title) return false;

    return true;
  });
}

// Find iframes without titles
export function findUntitledIframes() {
  return Array.from(document.querySelectorAll('iframe'))
    .filter(iframe => {
      if (wasProcessed(iframe)) return false;

      return !iframe.title && !iframe.getAttribute('aria-label');
    });
}
