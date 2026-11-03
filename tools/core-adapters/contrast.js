// contrast.js — Raises text contrast to at least WCAG AA where the page falls short.
// Barrier: Low-contrast text is difficult or impossible for people with low vision
// or color vision deficiencies to read against its background.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: contrastMode, darkMode.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Contrast',
// settings contrastMode): up goes to the next mode (more contrast in the page's own colours,
// then yellow on black), down to the previous, then off; saved for this site and announced.
//
// Options:
//   contrastMode: Initial contrast mode if not set in person's profile ('light', 'yellow-black', or 'none').
//                 Defaults to 'light' (more contrast in the page's own colours).
//
// Decisions:
//   • Measures text colour against its real background using s.page.textContrast(el), which
//     climbs up and blends semi-transparent ancestor layers.
//   • In 'light' mode (default), only text elements below WCAG AA (4.5:1, or 3:1 for large text)
//     are adjusted, darkening or lightening the text colour while keeping its hue.
//   • Leaves text that already meets the ratio alone, and images, video and canvas untouched.
//   • In 'yellow-black' mode, applies yellow on black to all text via a single stylesheet (s.css).
//   • Yellow-black never removes background images (icons and sprites stay) and never styles inside an <svg>.
//   • Each mode lives in its own s.group(); switching modes ends the active group, restoring
//     the page before the next mode applies, without hand-written undo logic.
//   • The person's darkMode setting reflects a preference and is not assumed to be the page's background.
//   • An element hidden when it is first seen is measured when it is shown, never marked done while hidden.
//   • Measures each element once, and handles text added later (s.watch.added) without flicker.
//   • Listens for shortcut adjustments (s.keys.adjust) and profile changes (s.profile.onChange).
//
// What it cannot do:
//   • Cannot reliably determine effective contrast over image backgrounds or complex gradients
//     (leaves text over background images untouched rather than guessing).
//   • Does not modify text embedded in raster images or video frames.

const YELLOW_BLACK_CSS = `
html, body {
  background-color: #000000 !important;
  color: #ffff00 !important;
}
*:not(img):not(video):not(canvas):not(svg):not(svg *):not(picture):not(picture *):not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *) {
  background-color: #000000 !important;
  color: #ffff00 !important;
  border-color: #ffff00 !important;
}
a:not(svg *):not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *),
a:not(svg *):not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *):visited {
  color: #ffff00 !important;
  text-decoration: underline !important;
}
:focus-visible {
  outline: 3px solid #ffff00 !important;
  outline-offset: 2px !important;
}
`;

function getNextMode(current) {
  if (current === 'none') return 'light';
  if (current === 'light') return 'yellow-black';
  return 'yellow-black';
}

function getPrevMode(current) {
  if (current === 'yellow-black') return 'light';
  if (current === 'light') return 'none';
  return 'none';
}

function announceMode(s, mode) {
  if (mode === 'yellow-black') {
    s.announce('Yellow on black contrast on this site.');
  } else if (mode === 'light') {
    s.announce("More contrast in the page's own colours on this site.");
  } else if (mode === 'none') {
    s.announce('Contrast off on this site.');
  }
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    // The person's settings
    const contrastPref = s.profile.get('contrastMode');
    // Read darkMode preference (noted: profile darkMode is not the page's background)
    const darkPref = s.profile.get('darkMode');

    let currentGroup = null;
    let activeMode = null;

    const setupYellowBlack = (group) => {
      group.css('yellow-black', YELLOW_BLACK_CSS);
    };

    const setupLight = (group) => {
      const measured = new WeakSet();

      let io = null;
      if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function') {
        io = new window.IntersectionObserver((entries) => {
          for (const entry of entries) {
            const target = entry.target;
            if (s.page.isVisible(target)) {
              io.unobserve(target);
              checkElement(target);
            }
          }
        });
        group.onEnd(() => io.disconnect());
      }

      const checkElement = (el) => {
        if (!el || measured.has(el)) return;
        if (el.matches && el.matches('script, style, noscript, template, svg, svg *, math, math *, canvas, iframe, object, [data-ai4a11y-ui], [data-ai4a11y-ui] *')) return;

        if (!s.page.isVisible(el)) {
          if (io) io.observe(el);
          return;
        }

        measured.add(el);

        const info = s.page.textContrast(el);
        if (info && info.fix) {
          group.setStyle(el, 'color', info.fix, 'important');
        }
      };

      const collectTextParents = (sub, set) => {
        if (!sub || !sub.isConnected) return;
        if (sub.matches && sub.matches('script, style, noscript, template, svg, svg *, math, math *, canvas, iframe, object, [data-ai4a11y-ui], [data-ai4a11y-ui] *')) return;

        const doc = sub.ownerDocument || document;
        const walker = doc.createTreeWalker(sub, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('script, style, noscript, template, svg, math, canvas, iframe, object, [data-ai4a11y-ui]')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          set.add(n.parentElement);
        }
      };

      const processBatch = (list) => {
        const elements = new Set();
        for (const item of list) {
          collectTextParents(item, elements);
        }
        for (const el of elements) {
          checkElement(el);
        }
      };

      const root = document.body || document.documentElement;
      if (root) {
        processBatch([root]);

        group.watch.added(
          root,
          (batchList) => {
            processBatch(batchList);
          },
          { types: ['childList', 'attributes'], batch: true }
        );
      }
    };

    const applyMode = (mode) => {
      const targetMode = (mode === 'yellow-black' || mode === 'none') ? mode : 'light';
      if (activeMode === targetMode) return;

      if (currentGroup) {
        currentGroup.end();
        currentGroup = null;
      }
      activeMode = targetMode;

      if (targetMode === 'none') {
        return;
      }

      currentGroup = s.group();

      if (targetMode === 'yellow-black') {
        setupYellowBlack(currentGroup);
      } else if (targetMode === 'light') {
        setupLight(currentGroup);
      }
    };

    // Determine initial mode: profile setting wins, then options, falling back to 'light'
    let initialMode = contrastPref;
    if (initialMode === undefined) {
      initialMode = this.options.contrastMode || 'light';
    }
    applyMode(initialMode);

    // Follow profile changes made elsewhere
    s.profile.onChange((personal, changed) => {
      if (changed && 'contrastMode' in changed) {
        applyMode(changed.contrastMode);
      }
    });

    // Provide shortcut adjustment
    s.keys.adjust({
      label: 'Contrast',
      settings: ['contrastMode'],
      up: async () => {
        const next = getNextMode(activeMode);
        if (next !== activeMode) {
          const r = await s.profile.set({ contrastMode: next });
          if (r && r.applied) {
            announceMode(s, next);
          }
        }
      },
      down: async () => {
        const prev = getPrevMode(activeMode);
        if (prev !== activeMode) {
          const r = await s.profile.set({ contrastMode: prev });
          if (r && r.applied) {
            announceMode(s, prev);
          }
        }
      },
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
