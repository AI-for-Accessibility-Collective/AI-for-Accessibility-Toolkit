// Page structure: gives the page a structure people can navigate by.
// Adds missing landmarks (main, navigation, banner, contentinfo) with ARIA roles
// only where the page has none and the region is unambiguous, and an outline of
// the page's headings in a panel (s.panel) opened with Alt+Shift+O, where choosing
// a heading moves focus to it and closing gives focus back.
// Never changes headings' levels or text.
//
// For vision and motor barriers: screen reader users needing signposting and
// wayfinding by landmarks, and keyboard/switch/eye-gaze users needing to jump
// straight to sections without tedious sequential scrolling or tabbing.
//
// Suggested in onboarding for: vision, motor (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing. Alt+Shift+O opens the outline.
//
// Developer options (passed to enable()):
//   maxLevel: number (1-6, default 6) - deepest heading level to include in the outline.
//   landmarks: boolean (default true) - whether to detect and repair missing landmarks.
//   outline: boolean (default true) - whether to register the outline panel and shortcut.
//
// Key decisions:
//   - Adds landmarks only where the page has none: if a main, banner, contentinfo,
//     or navigation landmark already exists natively or via ARIA, no role is added.
//   - Region must be unambiguous: excludes elements with existing roles, avoids
//     swallowing other landmarks, ignores cookie/promo notices for banners, and
//     requires a high link-to-text density for navigation so prose is never mislabeled.
//   - Only one of each landmark type is added to prevent duplicate unlabelled landmarks.
//   - Never alters heading tags, levels, or text content in the host page.
//   - Uses s.panel to build a lightweight dialog panel with an accessible name,
//     a Close button, and automatic focus management.
//   - Activating an outline item moves focus directly to that heading via s.focus.region,
//     scrolling it into view (respecting reduced motion) and closing the panel so content
//     is never obscured.
//   - Escape dismisses the panel and returns focus to the trigger/previous active element.
//   - Applies once in enable(); returns false when there are no missing landmarks to add
//     and no headings to outline.
//   - Fully reversible: all attribute changes and panel elements are tracked in the session
//     and cleanly undone by disable() (s.end()).
//
// What it cannot do:
//   - Cannot generate headings where the author wrote none in markup or text.
//   - Cannot resolve landmark roles when the page layout structure is completely ambiguous.
//   - Cannot inspect headings or content inside cross-origin iframes or closed shadow roots.

const LANDMARK_SELECTOR =
  'header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';

const SHELL_SELECTOR =
  'header, footer, main, [role="banner"], [role="contentinfo"], [role="main"]';

const MAIN_ID = /^(main|content|main-?content|primary)$/i;
const HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar)\b/i;
const NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo/i;
const FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon|copyright)\b/i;
const COPYRIGHT_RE = /©|\(c\)\s*\d|copyright|all rights reserved/i;
const NAV_HINT = /(^|[-_])(nav(bar|igation)?|menu)([-_]|$)/i;

function isMainCandidate(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (['header', 'footer', 'nav', 'aside', 'script', 'style', 'noscript', 'template', 'svg', 'iframe'].includes(tag)) {
    return false;
  }
  if (el.getAttribute('role')) return false;
  if (el.hasAttribute('data-ai4a11y-ui')) return false;
  if ((el.textContent?.trim().length || 0) <= 100) return false;
  if (el.querySelector(SHELL_SELECTOR)) return false;
  if (el.closest(LANDMARK_SELECTOR)) return false;
  return true;
}

const isNamedMain = (el) =>
  MAIN_ID.test(el.id || '') ||
  (el.classList && (el.classList.contains('main') || el.classList.contains('content')));

function ensureMain(s, doc) {
  if (doc.querySelector('main, [role="main"]')) return false;
  const level = doc.body ? Array.from(doc.body.children) : [];
  let candidates = level.filter(isMainCandidate);

  // If the only candidate is a layout wrapper or shell containing landmarks or named main
  if (candidates.length === 0) {
    const shell = level.find(
      (el) =>
        !el.closest(LANDMARK_SELECTOR) &&
        (el.textContent?.trim().length || 0) > 100 &&
        el.querySelector(LANDMARK_SELECTOR)
    );
    if (shell) candidates = Array.from(shell.children).filter(isMainCandidate);
  } else if (candidates.length === 1 && !isNamedMain(candidates[0])) {
    const inner = Array.from(candidates[0].children).filter(isMainCandidate);
    if (inner.length > 0) candidates = inner;
  }

  if (candidates.length === 0) return false;

  const named = candidates.filter(isNamedMain);
  const chosen = (named.length ? named : candidates).reduce((a, b) =>
    (a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b
  );
  s.setAttr(chosen, 'role', 'main');
  return true;
}

function ensureBanner(s, doc) {
  if (doc.querySelector('header, [role="banner"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, td, aside'))
    .filter((e) => !e.getAttribute('role') && !e.hasAttribute('data-ai4a11y-ui'))
    .filter((e) => !e.closest(LANDMARK_SELECTOR))
    .filter((e) => !e.querySelector('main, [role="main"]'))
    .filter(
      (e) =>
        (HEADER_HINT.test(e.className || '') || HEADER_HINT.test(e.id || '')) &&
        !NOT_HEADER.test(e.className || '') &&
        !NOT_HEADER.test(e.id || '')
    )
    .filter((e) => (e.textContent?.trim().length || 0) < 2000);

  const el = candidates[0];
  if (!el) return false;
  s.setAttr(el, 'role', 'banner');
  return true;
}

function ensureContentinfo(s, doc) {
  if (doc.querySelector('footer, [role="contentinfo"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, td, aside'))
    .filter((e) => !e.getAttribute('role') && !e.hasAttribute('data-ai4a11y-ui'))
    .filter((e) => !e.closest(LANDMARK_SELECTOR))
    .filter(
      (e) =>
        (FOOTER_HINT.test(e.className || '') || FOOTER_HINT.test(e.id || '')) ||
        COPYRIGHT_RE.test((e.textContent || '').slice(-400))
    )
    .filter((e) => !e.querySelector('main, [role="main"], nav, [role="navigation"], header, [role="banner"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 1500);

  const el = candidates[candidates.length - 1];
  if (!el) return false;
  s.setAttr(el, 'role', 'contentinfo');
  return true;
}

function ensureNavigation(s, doc) {
  if (doc.querySelector('nav, [role="navigation"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, ul'))
    .filter((e) => !e.getAttribute('role') && !e.hasAttribute('data-ai4a11y-ui'))
    .filter((e) => !e.closest(LANDMARK_SELECTOR))
    .filter((e) => !e.querySelector('main, [role="main"], header, [role="banner"], footer, [role="contentinfo"]'))
    .filter((e) => {
      const hasNavClass = Array.from(e.classList || []).some((c) => NAV_HINT.test(c));
      const hasNavId = NAV_HINT.test(e.id || '');
      if (!hasNavClass && !hasNavId) return false;
      if (NOT_HEADER.test(e.className || '') || NOT_HEADER.test(e.id || '')) return false;
      const links = e.querySelectorAll('a').length;
      const textLength = e.textContent?.trim().length || 1;
      return links >= 3 && (links * 15) / textLength > 0.4;
    });

  if (!candidates.length) return false;
  const primary = candidates.find((e) => /(primary|main|site|top)/i.test((e.id || '') + ' ' + (e.className || '')));
  const chosen = primary || candidates[0];
  s.setAttr(chosen, 'role', 'navigation');
  return true;
}

export default {
  s: null,
  panel: null,

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());
    const doc = document;
    const maxLevel = Math.max(1, Math.min(6, Number(options.maxLevel) || 6));
    const doLandmarks = options.landmarks !== false;
    const doOutline = options.outline !== false;

    let landmarksAdded = 0;
    if (doLandmarks) {
      if (ensureBanner(s, doc)) landmarksAdded++;
      if (ensureContentinfo(s, doc)) landmarksAdded++;
      if (ensureNavigation(s, doc)) landmarksAdded++;
      if (ensureMain(s, doc)) landmarksAdded++;
    }

    const getHeadings = () =>
      s.page
        .headings({ maxLevel })
        .filter(
          (h) =>
            h.el.getAttribute('role') !== 'presentation' &&
            h.el.getAttribute('role') !== 'none'
        );

    const availableHeadings = doOutline ? getHeadings() : [];
    if (landmarksAdded === 0 && availableHeadings.length === 0) {
      s.end();
      return false;
    }

    if (doOutline) {
      s.css(
        'structure-outline-style',
        `
.ai4a11y-outline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ai4a11y-outline-item {
  margin: 0;
  padding: 0;
}
.ai4a11y-outline-btn {
  all: revert;
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 6px 10px;
  box-sizing: border-box;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  line-height: 1.4;
}
.ai4a11y-outline-btn:hover {
  background: rgba(128, 128, 128, 0.15);
}
.ai4a11y-outline-btn:focus-visible {
  outline: 3px solid currentColor !important;
  outline-offset: 2px !important;
}
.ai4a11y-outline-level {
  display: inline-block;
  font-size: 0.85em;
  font-weight: 700;
  opacity: 0.8;
  flex-shrink: 0;
  min-width: 24px;
}
.ai4a11y-outline-text {
  flex-grow: 1;
  word-break: break-word;
}
.ai4a11y-outline-empty {
  margin: 0;
  padding: 8px 0;
  font-style: italic;
  opacity: 0.8;
}
`
      );

      const panel = (this.panel = s.panel({
        kind: 'dialog',
        label: 'Page outline',
        focus: 'always',
        corner: 'bottom-right',
        width: 360,
      }));

      const renderOutline = () => {
        panel.body.replaceChildren();
        const headings = getHeadings();
        if (headings.length === 0) {
          const empty = s.el('p', {
            text: 'No headings on this page.',
            attrs: { class: 'ai4a11y-outline-empty' },
          });
          panel.body.append(empty);
          return;
        }

        const list = s.el('ul', {
          attrs: { role: 'list', class: 'ai4a11y-outline-list' },
        });

        for (const heading of headings) {
          const li = s.el('li', {
            attrs: {
              class: 'ai4a11y-outline-item',
              'data-level': heading.level,
              style: `padding-left: ${(heading.level - 1) * 12}px;`,
            },
          });
          const btn = s.el('button', {
            attrs: {
              type: 'button',
              class: 'ai4a11y-outline-btn',
              'data-level': heading.level,
            },
          });
          const badge = s.el('span', {
            text: `H${heading.level}`,
            attrs: { class: 'ai4a11y-outline-level' },
          });
          const title = s.el('span', {
            text: heading.text || '(Untitled)',
            attrs: { class: 'ai4a11y-outline-text' },
          });
          btn.append(badge, title);

          s.listen(btn, 'click', (e) => {
            e.preventDefault();
            s.focus.region(heading.el);
            panel.close();
          });

          li.append(btn);
          list.append(li);
        }
        panel.body.append(list);
      };

      s.keys.shortcut({ code: 'KeyO', alt: true, shift: true }, () => {
        if (panel.isOpen) {
          panel.close();
        } else {
          renderOutline();
          panel.open(doc.activeElement);
        }
      });
    }

    return true;
  },

  disable() {
    this.s?.end();
    this.panel = null;
  },
};
