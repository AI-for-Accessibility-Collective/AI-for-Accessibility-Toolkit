// focus-keyboard.js — Makes keyboard navigation visible and reliable.
// Barrier: People navigating with a keyboard or switch device cannot see where focus
// is when focus indicators are absent, subtle, or suppressed by CSS; cannot bypass
// repetitive navigation blocks without a skip link; or lose sight of focused controls
// when sticky or fixed headers/footers obscure them.
//
// Suggested in onboarding for: motor, vision (a suggestion only, never a gate).
// The person's settings it reads: motionReducer (smooth vs instant scrolling to main).
// What the person can adjust: nothing (the shortcut, if the person gives it to this
// adapter, turns it on and off; the toolkit does that).
//
// Options:
//   color: Focus indicator color (e.g. '#1a5fb4'). Defaults to 'auto', which chooses
//          a high-contrast color passing >= 3:1 against background colors.
//   width: Focus indicator width in pixels. Defaults to 3.
//   skipLabel: Text for the skip link button. Defaults to 'Skip to main content'.
//   to: Custom target element for the skip link. Defaults to page main content.
//   margin: Clearance margin in pixels for keepVisible. Defaults to 8.
//
// Decisions:
//   • Uses s.highlight.focusRing for dual-ring focus styling (outline + box-shadow)
//     that passes >= 3:1 contrast against both light and dark surfaces and beats
//     site styles (like outline: none !important) without covering element content.
//   • Injects 'Skip to main content' link via s.focus.skipLink() as the first item
//     in the tab order; skips injection if the page already has a functional skip link.
//   • Uses s.focus.keepVisible() to automatically adjust scroll-padding and scroll
//     newly focused elements out from underneath sticky or fixed headers/footers
//     with a single scroll step.
//   • Evaluates focusable elements and main landmarks; if neither is present,
//     gracefully disables itself and returns false.
//   • Leaves the page's original tab order intact and never sets tabindex > 0.
//   • Respects personal motionReducer preferences by relying on building block
//     smooth/instant scroll resolution.
//
// What it cannot do:
//   • Cannot fix broken focus traps inside inaccessible third-party modals.
//   • Cannot invent interactive roles for custom non-semantic divs that lack keyboard
//     handlers or tabindex attributes.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());

    const doc = document;
    const root = doc.body || doc.documentElement;
    if (!root) {
      this.disable();
      return false;
    }

    // Count only what a person can focus (not disabled, not type=hidden, not tabindex -1, not contenteditable=false)
    const isFocusable = (el) => {
      if (!el || (s.page?.isOurs && s.page.isOurs(el))) return false;
      if (el.disabled || el.hasAttribute('disabled')) return false;
      if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.getAttribute('type') === 'hidden')) return false;
      if (el.getAttribute('tabindex') === '-1') return false;
      if (el.getAttribute('contenteditable') === 'false') return false;
      return true;
    };

    const candidates = root.querySelectorAll(
      'a[href], area[href], button, input, select, textarea, details, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]'
    );
    let hasFocusable = false;
    for (const el of candidates) {
      if (isFocusable(el)) {
        hasFocusable = true;
        break;
      }
    }

    const mainTarget = this.options.to || (s.page ? s.page.main() : null);
    const hasMain = !!(mainTarget && mainTarget !== doc.body && mainTarget !== doc.documentElement);

    if (!hasFocusable && !hasMain) {
      this.disable();
      return false;
    }

    s.highlight.focusRing({
      color: this.options.color,
      width: this.options.width,
    });

    s.focus.skipLink({
      label: this.options.skipLabel,
      to: this.options.to,
    });

    s.focus.keepVisible({
      margin: this.options.margin ?? this.options.keepVisibleMargin ?? 8,
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
