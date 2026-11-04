// focus-keyboard.js — Makes keyboard use visible and possible with a strong focus
// indicator, a skip link, and scroll-into-view under fixed headers.
// Barrier: Subtle or missing focus indicators, absence of bypass mechanisms (skip links),
// and fixed or sticky headers obscuring active controls make keyboard and switch navigation
// difficult or impossible for people with motor, vision, or cognitive disabilities.
//
// Suggested in onboarding for: motor, vision (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (the shortcut, if the person gives it to this adapter,
// turns it on and off; the toolkit does that).
//
// Options:
//   to: An element or CSS selector string identifying the main content target
//       for the skip link. Defaults to undefined (resolving via s.page.main()).
//   label: Text label for the skip link. Defaults to 'Skip to main content'.
//   color: Ring color for the focus indicator ('auto' or CSS color). Defaults to 'auto'.
//   width: Outline width in pixels for the focus ring (2 to 8). Defaults to 3.
//   margin: Clearance margin in pixels for keepVisible scroll padding. Defaults to 8.
//
// Decisions:
//   • Counts only elements a person can focus (excludes disabled controls, case-insensitive
//     type=hidden, tabindex < 0, non-control elements with contenteditable="false", and the
//     toolkit's own UI elements; counts SVG links, and details without summary).
//   • Parses tabindex numerically: any value below 0 is negative and not sequentially focusable.
//   • Detects whether a valid main content region exists (or resolves options.to if given).
//   • If the page has no focusable elements and no main content, ends the session and returns false.
//   • Applies a high-contrast focus indicator (s.highlight.focusRing) with >= 3:1 contrast
//     against both dark and light backgrounds, placed outside the element so it covers nothing.
//   • Injects a skip link (s.focus.skipLink) as the first item in the tab order, unless
//     the page already has a working skip link that reaches the main content.
//   • Keeps focused elements visible from under fixed or sticky bars (s.focus.keepVisible)
//     in one scroll, never two (WCAG 2.4.11).
//   • Never modifies the page's natural tab order or introduces positive tabindex values (> 0).
//   • Respects motionReducer preference during skip link navigation and scrolling.
//   • Everything is restored to its exact original state on disable() via session cleanup.
//
// What it cannot do:
//   • Cannot fix pages where scripts cancel keyboard events or trap focus inside untrapped loops.
//   • Cannot inspect or alter content inside closed shadow roots or cross-origin iframes.

function isFocusable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.hasAttribute('data-ai4a11y-ui') || el.closest('[data-ai4a11y-ui]')) return false;
  if (el.disabled || el.hasAttribute('disabled')) return false;
  if (el.type === 'hidden' || el.getAttribute('type')?.toLowerCase() === 'hidden') return false;

  const rawTabindex = el.getAttribute('tabindex');
  const hasTabindex = rawTabindex !== null;
  const parsedTabindex = hasTabindex ? parseInt(rawTabindex, 10) : NaN;
  if (hasTabindex && !isNaN(parsedTabindex) && parsedTabindex < 0) return false;

  const tag = el.tagName?.toUpperCase();
  if (tag === 'A' || tag === 'AREA') {
    return el.hasAttribute('href') || el.hasAttribute('xlink:href') || (!isNaN(parsedTabindex) && parsedTabindex >= 0);
  }
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'IFRAME') {
    return true;
  }
  if (tag === 'INPUT') {
    return true;
  }
  if (tag === 'DETAILS') {
    return !el.querySelector('summary') || (!isNaN(parsedTabindex) && parsedTabindex >= 0);
  }
  if (tag === 'AUDIO' || tag === 'VIDEO') {
    return el.hasAttribute('controls') || (!isNaN(parsedTabindex) && parsedTabindex >= 0);
  }
  const ce = el.getAttribute('contenteditable');
  if (ce !== 'false' && (ce === '' || ce === 'true' || el.isContentEditable)) {
    return true;
  }
  if (hasTabindex && !isNaN(parsedTabindex) && parsedTabindex >= 0) {
    return true;
  }
  return false;
}

function countFocusable(doc) {
  const elements = doc.querySelectorAll(
    'a, area, button, input, select, textarea, summary, details, iframe, audio, video, [contenteditable], [tabindex]'
  );
  let count = 0;
  for (const el of elements) {
    if (isFocusable(el)) count++;
  }
  return count;
}

function getMainContent(doc, s, toOption) {
  if (toOption) {
    let resolved = null;
    if (typeof toOption === 'string') {
      try {
        resolved = doc.querySelector(toOption);
      } catch {
        resolved = null;
      }
    } else if (toOption && toOption.nodeType === 1) {
      resolved = toOption;
    }
    if (resolved && resolved !== doc.body && resolved !== doc.documentElement) {
      return resolved;
    }
    return null;
  }
  const main = s.page.main();
  if (main && main !== doc.body && main !== doc.documentElement) {
    return main;
  }
  return null;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const doc = document;

    const focusableCount = countFocusable(doc);
    const mainTarget = getMainContent(doc, s, this.options.to);

    if (focusableCount === 0 && !mainTarget) {
      this.disable();
      return false;
    }

    s.highlight.focusRing({
      color: this.options.color,
      width: this.options.width,
    });

    s.focus.skipLink({
      to: mainTarget || undefined,
      label: this.options.label,
    });

    s.focus.keepVisible({
      margin: this.options.margin,
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },

  isFocusable,
  countFocusable,
};
