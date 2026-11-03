// Focus and keyboard — makes keyboard navigation visible, reliable and reachable.
//
// What it does:
//   Removes keyboard barriers for people with motor or low-vision disabilities.
//   Provides a high-contrast focus indicator (>= 3:1 contrast against adjacent
//   surfaces) on every focusable element using s.highlight.focusRing, including
//   elements where page author CSS specifies outline: none. Injects an
//   accessible "Skip to main content" link as the first tab stop on the page,
//   moving keyboard focus directly to the main content region without layout
//   shift. Automatically scrolls focused elements into view when obscured
//   beneath fixed or sticky headers (WCAG 2.4.11).
//
// Suggested in onboarding for:
//   motor, vision (a suggestion only, never a gate).
//
// The person's settings it reads:
//   motionReducer (true | false): when true, scrolling to main or out from
//   under fixed headers uses instant scrolling ('auto') instead of smooth
//   scrolling, respecting preferences for reduced motion.
//
// What the person can adjust:
//   Nothing (on or off).
//
// Options (developer defaults):
//   color: 'auto' (default) or CSS color string for the focus ring outline.
//   width: 3 (default, pixels 2-8) for the focus ring width.
//   skipLinkText: 'Skip to main content' (default) text for the skip link.
//   margin: 16 (default, pixels) clearance below fixed headers on scroll.
//
// Decisions it makes:
//   - Places the skip link container as the first child of <body> using an
//     out-of-flow wrapper (position: fixed; top: 0; left: 0; width: 0; height: 0)
//     so it is the very first Tab stop without altering DOM flow layout or
//     triggering grid/flex row shifts on <body>.
//   - Uses s.focus.region(main) to move focus to main, which temporarily applies
//     tabindex="-1" only when needed and cleans it up on blur, never setting
//     tabindex > 0 or disrupting natural tab order.
//   - Detects fixed/sticky header obstruction via both DOM querying and
//     document.elementsFromPoint to ensure elements are completely unobscured
//     (WCAG 2.4.11) while respecting motionReducer.
//   - Relies strictly on the session building blocks (s.highlight.focusRing,
//     s.focus.region, s.css, s.insert, s.listen) so disable() restores the DOM
//     and styles completely without leftovers.
//
// What it cannot do:
//   - Cannot repair broken non-semantic click handlers on un-focusable <div>
//     tags lacking keyboard interaction handlers.
//   - Cannot scroll elements inside rigid, non-scrollable overflow containers.

export default {
  enable(options, toolkit) {
    if (this.s && !this.s.ended) return true;
    const s = (this.s = toolkit.session());
    const doc = document;
    const win = window;

    // Detect if page has anything focusable or main content to operate on
    const hasFocusable = doc.querySelector('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])');
    const main = s.page.main() || doc.querySelector('main, [role="main"], article, #main, #content, .content');

    if (!hasFocusable && !main) {
      s.end();
      this.s = null;
      return false;
    }

    const opts = options || {};
    const ringColor = opts.color || 'auto';
    const ringWidth = opts.width || 3;
    const skipLinkText = opts.skipLinkText || 'Skip to main content';
    const headerMargin = typeof opts.margin === 'number' ? opts.margin : 16;

    const isReducedMotion = () => {
      const personal = s.profile.get();
      if (personal && personal.motionReducer) return true;
      if (toolkit.personal && toolkit.personal.motionReducer) return true;
      try {
        return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    };

    // 1. Strong focus indicator on every focusable element (>= 3:1 contrast)
    s.highlight.focusRing({ color: ringColor, width: ringWidth });

    // 2. Skip to main content link (first in tab order)
    if (main) {
      if (!main.id) {
        s.setAttr(main, 'id', 'ai4a11y-main-content');
      }

      s.css('skip-link-styles', `
[data-ai4a11y-skip-container] {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}
[data-ai4a11y-skip-link] {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
  border: 0 !important;
  pointer-events: none !important;
}
[data-ai4a11y-skip-link]:focus,
[data-ai4a11y-skip-link]:focus-visible {
  position: fixed !important;
  top: 10px !important;
  left: 10px !important;
  width: auto !important;
  height: auto !important;
  min-width: 44px !important;
  min-height: 44px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 10px 18px !important;
  margin: 0 !important;
  overflow: visible !important;
  clip: auto !important;
  clip-path: none !important;
  border-radius: 999px !important;
  border: 2px solid #1a5fb4 !important;
  background-color: #ffffff !important;
  color: #1a5fb4 !important;
  font-family: system-ui, -apple-system, sans-serif !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  line-height: 1.4 !important;
  text-decoration: underline !important;
  text-underline-offset: 3px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2) !important;
  pointer-events: auto !important;
  z-index: 2147483647 !important;
}
      `);

      const container = s.el('div', { attrs: { 'data-ai4a11y-skip-container': '' } });
      const skipLink = s.el('a', {
        text: skipLinkText,
        attrs: {
          href: '#' + main.id,
          'data-ai4a11y-skip-link': '',
        },
      });

      s.listen(skipLink, 'click', (e) => {
        e.preventDefault();
        s.focus.region(main);
      });

      s.append(container, skipLink);
      const parent = doc.body || doc.documentElement;
      s.insert(parent, container, parent.firstChild);
    }

    // 3. Scroll focused element into view when hidden under fixed headers (WCAG 2.4.11)
    function ensureVisible(el) {
      if (!s.alive() || !el || el.nodeType !== 1 || !el.isConnected) return;
      if (el === doc.body || el === doc.documentElement) return;
      if (s.page.isOurs(el)) return;

      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;

      let maxCoverBottom = 0;
      let minCoverTop = win.innerHeight;

      // Check fixed or sticky headers and navigation bars
      const candidates = doc.querySelectorAll('header, nav, [role="banner"], [role="navigation"], [class*="header" i], [class*="nav" i], [class*="sticky" i], [class*="fixed" i]');
      for (const h of candidates) {
        if (h === el || h.contains(el) || el.contains(h)) continue;
        if (s.page.isOurs(h)) continue;
        const st = win.getComputedStyle(h);
        if (st.position === 'fixed' || st.position === 'sticky') {
          const hr = h.getBoundingClientRect();
          // Header across the top
          if (hr.top <= 10 && hr.bottom > 0 && hr.left < r.right && hr.right > r.left) {
            if (hr.bottom > r.top) {
              maxCoverBottom = Math.max(maxCoverBottom, hr.bottom);
            }
          }
          // Footer / banner across the bottom
          if (hr.bottom >= win.innerHeight - 10 && hr.top < win.innerHeight && hr.left < r.right && hr.right > r.left) {
            if (hr.top < r.bottom) {
              minCoverTop = Math.min(minCoverTop, hr.top);
            }
          }
        }
      }

      // Check elementsFromPoint covering the element
      try {
        const testX = Math.max(1, Math.min(win.innerWidth - 2, r.left + Math.min(r.width / 2, 20)));
        const testY = Math.max(1, Math.min(win.innerHeight - 2, r.top + Math.min(r.height / 2, 5)));
        const stack = doc.elementsFromPoint(testX, testY) || [];
        for (const item of stack) {
          if (item === el || el.contains(item)) break;
          if (item.contains(el) || s.page.isOurs(item)) continue;
          let cur = item;
          while (cur && cur !== doc.body && cur !== doc.documentElement) {
            const st = win.getComputedStyle(cur);
            if (st.position === 'fixed' || st.position === 'sticky') {
              const cr = cur.getBoundingClientRect();
              if (cr.top <= 10 && cr.bottom > r.top && cr.left < r.right && cr.right > r.left) {
                maxCoverBottom = Math.max(maxCoverBottom, cr.bottom);
              }
              break;
            }
            cur = cur.parentElement;
          }
        }
      } catch {
        // elementsFromPoint might fail in edge contexts
      }

      const behavior = isReducedMotion() ? 'auto' : 'smooth';

      let scroller = el.parentElement;
      while (scroller && scroller !== doc.body && scroller !== doc.documentElement) {
        const oy = win.getComputedStyle(scroller).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight) {
          break;
        }
        scroller = scroller.parentElement;
      }
      const scrollTarget = (scroller && scroller !== doc.body && scroller !== doc.documentElement && scroller.scrollTop > 0) ? scroller : win;

      if (maxCoverBottom > r.top) {
        const diff = maxCoverBottom - r.top + headerMargin;
        scrollTarget.scrollBy({ top: -diff, behavior });
      } else if (minCoverTop < r.bottom && minCoverTop < win.innerHeight) {
        const diff = r.bottom - minCoverTop + headerMargin;
        scrollTarget.scrollBy({ top: diff, behavior });
      }
    }

    s.listen(doc, 'focusin', (e) => {
      ensureVisible(e.target);
      s.frame(() => ensureVisible(e.target));
    }, true);

    if (doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement) {
      ensureVisible(doc.activeElement);
    }

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
