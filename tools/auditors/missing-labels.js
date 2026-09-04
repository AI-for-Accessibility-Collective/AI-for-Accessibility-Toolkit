import { isVisible, wasProcessed, hasAccessibleName, getAccessibleName } from '../utils/dom.js';

// Link text that says nothing about where the link goes. WCAG 2.4.4 (Link
// Purpose, In Context) is the rule this serves, but the check does not read
// the context: it is an exact match of the link's accessible name against
// this English word list after trimming and lower-casing, so a "Read more"
// link that already carries a descriptive aria-label passes. "Read more →",
// "click here to learn more" and every non-English page pass too. Heuristic,
// English-only, best-effort.
const AMBIGUOUS_LINK_TEXTS = [
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
  return Array.from(document.querySelectorAll('a[href]'))
    .filter(link => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;

      const text = getAccessibleName(link).toLowerCase();
      return text && AMBIGUOUS_LINK_TEXTS.includes(text);
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

    // Has a name of its own: an aria-labelledby that resolves (one that
    // points at a missing or empty element is not a label), an aria-label,
    // the value of a submit, reset or button input, the alt of an image
    // input, or a title
    if (getAccessibleName(input)) return false;

    // Has associated label via for attribute
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return false;
    }

    // Is inside a label
    if (input.closest('label')) return false;

    return true;
  });
}

// Find iframes without titles
export function findUntitledIframes() {
  return Array.from(document.querySelectorAll('iframe'))
    .filter(iframe => {
      if (wasProcessed(iframe)) return false;

      // title, aria-label, or an aria-labelledby that resolves; an iframe's
      // fallback content is not a name
      return !hasAccessibleName(iframe);
    });
}
