// focus-keyboard.js — Makes keyboard use visible and possible with focus styling, skip navigation, and sticky clearance.
// Barrier: People using keyboard navigation or switches often cannot see where
// focus is due to low-contrast or suppressed focus outlines (e.g. outline: none),
// must tab through repetitive header navigation on every page when no skip link
// is present, and lose sight of focused controls that get hidden under fixed or sticky bars (WCAG 2.4.11).
//
// Suggested in onboarding for: motor, vision (a suggestion only, never a gate).
// The person's settings it reads: motionReducer (scrolls into view without animation).
// What the person can adjust: nothing (the shortcut, if given to this adapter, turns it on and off).
//
// Options:
//   color: Focus ring outline/shadow color. Defaults to 'auto' (#1a5fb4).
//   width: Focus ring stroke width in pixels (clamped 2–8). Defaults to 3.
//   skipLinkLabel: Visible text on the skip button. Defaults to 'Skip to main content'.
//   to: Custom landmark target element to skip to. Defaults to env.page.main().
//   margin: Clearance margin in pixels for keepVisible. Defaults to 8.
//
// Decisions:
//   • Uses s.highlight.focusRing() to guarantee a high-contrast focus indicator (>= 3:1)
//     on all focusable elements (:focus-visible), beating site-level outline: none via box-shadow.
//   • Injects a single 'Skip to main content' link (s.focus.skipLink()) at the start of the tab order,
//     skipping injection if the page already has a working skip link in the first 3 focusable elements.
//   • Uses s.focus.keepVisible() to detect fixed/sticky headers or footers obscuring the focused element
//     and scroll it into clear view in a single scroll adjustment without altering tab order.
//   • Never modifies the page's original tab order and never introduces tabindex > 0.
//   • Temporary tabindex="-1" applied during region navigation is immediately cleared on blur or disable.
//   • All added UI and styles are cleanly and completely reverted on disable().
//   • Returns false when the page contains no focusable elements and no main content region.
//
// What it cannot do:
//   • Cannot fix broken internal keyboard traps or non-standard custom controls that do not listen to standard key events.
//   • Cannot invent a meaningful skip destination when the page contains no recognizable main landmark or content.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const doc = document;
    if (!doc || (!doc.body && !doc.documentElement)) return false;

    const hasFocusable = !!doc.querySelector(
      'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]'
    );
    const hasMain = !!doc.querySelector('main, [role="main"], article, #main, #content, .content');
    if (!hasFocusable && !hasMain) return false;

    const s = (this.s = this.toolkit.session());

    s.highlight.focusRing({
      color: this.options.color,
      width: this.options.width,
    });

    s.focus.skipLink({
      label: this.options.skipLinkLabel,
      to: this.options.to,
    });

    s.focus.keepVisible({
      margin: this.options.margin,
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
