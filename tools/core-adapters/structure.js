// structure.js — Gives the page a structure people can navigate by.
// Barrier: Pages built with generic containers (div-soup) lack ARIA landmarks and
// clear heading structure, preventing screen reader and keyboard users from jumping
// directly to main content, navigation, headers, footers, or specific sections.
//
// Suggested in onboarding for: vision, motor (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
// The outline opens from a 'Page outline' button that is the first thing Tab reaches
// after any skip link, visible when focused, so it covers nothing.
//
// Options:
//   landmarks: boolean (default true) — whether to infer and add missing ARIA landmarks.
//   outline: boolean (default true) — whether to provide the page outline panel.
//   maxLevel: number (default 6) — deepest heading level to include in the outline (1–6).
//
// Decisions:
//   • Adds missing ARIA landmarks (main, navigation, banner, contentinfo) only where
//     the page has none and the region is unambiguous.
//   • Gives a landmark role only to a div or section, never to a list (ul, ol) or a native element.
//   • A header or footer inside an article, section, aside, main, or nav is not the page's
//     banner or contentinfo: it neither counts as one nor stops a region from being main content.
//   • Never overwrites existing roles or native semantic elements.
//   • Provides an outline of the page's headings in an accessible dialog panel (s.panel)
//     opened from a 'Page outline' button (s.focus.entry).
//   • Lists headings in document order with levels (H1–H6), accessible names, and links.
//   • Choosing a heading moves focus to that heading (s.focus.region) and closes the panel.
//   • Closing the panel (via Escape or Close button) returns focus to the 'Page outline' button.
//   • Never changes headings' levels, tag names, or text content.
//   • The panel never covers the content it points to; it sits in a corner and closes on activation.
//   • Ends the session and returns false if there are no landmarks to add and no headings.
//
// What it cannot do:
//   • Cannot fix heading hierarchy or missing heading text in page content.
//   • Cannot infer landmarks on pages with ambiguous or fragmented layouts.

function isDivOrSection(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  return tag === 'DIV' || tag === 'SECTION';
}

function isPageHeader(el) {
  if (!el || el.tagName !== 'HEADER') return false;
  return !el.closest('article, section, aside, main, nav, [role="article"], [role="region"], [role="complementary"], [role="main"], [role="navigation"]');
}

function isPageFooter(el) {
  if (!el || el.tagName !== 'FOOTER') return false;
  return !el.closest('article, section, aside, main, nav, [role="article"], [role="region"], [role="complementary"], [role="main"], [role="navigation"]');
}

function hasBanner(doc) {
  if (doc.querySelector('[role="banner"]')) return true;
  for (const h of doc.querySelectorAll('header')) {
    if (isPageHeader(h)) return true;
  }
  return false;
}

function hasContentinfo(doc) {
  if (doc.querySelector('[role="contentinfo"]')) return true;
  for (const f of doc.querySelectorAll('footer')) {
    if (isPageFooter(f)) return true;
  }
  return false;
}

function hasMain(doc) {
  return Boolean(doc.querySelector('main, [role="main"]'));
}

function hasNavigation(doc) {
  return Boolean(doc.querySelector('nav, [role="navigation"]'));
}

function isLandmark(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === 'MAIN' || tag === 'NAV' || tag === 'ASIDE') return true;
  if (tag === 'HEADER' && isPageHeader(el)) return true;
  if (tag === 'FOOTER' && isPageFooter(el)) return true;
  const role = (el.getAttribute('role') || '').toLowerCase();
  return ['main', 'banner', 'contentinfo', 'navigation', 'complementary'].includes(role);
}

function isInsideLandmark(el) {
  let p = el.parentElement;
  while (p && p !== el.ownerDocument.body && p !== el.ownerDocument.documentElement) {
    if (isLandmark(p)) return true;
    p = p.parentElement;
  }
  return false;
}

function containsPageLandmarks(el) {
  if (el.querySelector('main, [role="main"], [role="banner"], [role="contentinfo"]')) return true;
  for (const h of el.querySelectorAll('header')) {
    if (isPageHeader(h)) return true;
  }
  for (const f of el.querySelectorAll('footer')) {
    if (isPageFooter(f)) return true;
  }
  return false;
}

const MAIN_ID = /^(main|content|main-?content|primary|main-area)$/i;

function isMainCandidate(el) {
  if (!isDivOrSection(el)) return false;
  if (el.getAttribute('role')) return false;
  if (isInsideLandmark(el)) return false;
  if (containsPageLandmarks(el)) return false;
  const isNamed = MAIN_ID.test(el.id || '') || (el.classList && (el.classList.contains('main') || el.classList.contains('content')));
  const textLen = el.textContent?.trim().length || 0;
  if (!isNamed && textLen <= 100) return false;
  if (isNamed && textLen <= 20) return false;
  return true;
}

function findMain(doc) {
  if (hasMain(doc)) return null;
  const body = doc.body;
  if (!body) return null;

  let candidates = Array.from(body.children).filter(isMainCandidate);

  if (candidates.length === 0) {
    const shell = Array.from(body.children).find((el) =>
      isDivOrSection(el) &&
      !isInsideLandmark(el) &&
      (el.textContent?.trim().length || 0) > 100 &&
      containsPageLandmarks(el)
    );
    if (shell) {
      candidates = Array.from(shell.children).filter(isMainCandidate);
    }
  }

  if (candidates.length === 0) {
    const namedEls = Array.from(body.querySelectorAll('div, section')).filter(isMainCandidate);
    candidates = namedEls.filter((el) =>
      MAIN_ID.test(el.id || '') ||
      (el.classList && (el.classList.contains('main') || el.classList.contains('content')))
    );
  }

  if (candidates.length === 0) return null;

  const named = candidates.filter((el) =>
    MAIN_ID.test(el.id || '') ||
    (el.classList && (el.classList.contains('main') || el.classList.contains('content')))
  );
  const pool = named.length > 0 ? named : candidates;
  return pool.reduce((a, b) => ((a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b));
}

const HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar|site-header|page-header)\b/i;
const NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo|modal|dialog/i;

function findBanner(doc) {
  if (hasBanner(doc)) return null;
  const candidates = Array.from(doc.querySelectorAll('div, section'))
    .filter(isDivOrSection)
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => !isInsideLandmark(e))
    .filter((e) => {
      const hintStr = (e.className || '') + ' ' + (e.id || '');
      return HEADER_HINT.test(hintStr) && !NOT_HEADER.test(hintStr);
    })
    .filter((e) => !e.querySelector('main, [role="main"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 2500);

  return candidates[0] || null;
}

const FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon|site-info)\b/i;
const COPYRIGHT_RE = /©|\(c\)\s*\d|copyright|all rights reserved/i;

function findContentinfo(doc) {
  if (hasContentinfo(doc)) return null;
  const candidates = Array.from(doc.querySelectorAll('div, section'))
    .filter(isDivOrSection)
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => !isInsideLandmark(e))
    .filter((e) => {
      const hintStr = (e.className || '') + ' ' + (e.id || '');
      if (/cookie|consent|banner|header/i.test(hintStr)) return false;
      return FOOTER_HINT.test(hintStr) || COPYRIGHT_RE.test((e.textContent || '').slice(-400));
    })
    .filter((e) => !e.querySelector('main, [role="main"], nav, [role="navigation"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 2500);

  return candidates[candidates.length - 1] || null;
}

const NAV_HINT = /\b(nav|navbar|navigation|site-nav|main-nav|primary-nav|menu-bar)\b/i;

function findNavigation(doc) {
  if (hasNavigation(doc)) return null;
  const candidates = Array.from(doc.querySelectorAll('div, section'))
    .filter(isDivOrSection)
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => !isInsideLandmark(e))
    .filter((e) => {
      const hintStr = (e.className || '') + ' ' + (e.id || '');
      return NAV_HINT.test(hintStr) && !/unavailable|navigate/i.test(hintStr);
    })
    .filter((e) => {
      const links = e.querySelectorAll('a').length;
      if (links < 2) return false;
      const textLen = e.textContent?.trim().length || 1;
      return (links * 15) / textLen > 0.2 || Boolean(e.querySelector('ul, ol'));
    });

  return candidates[0] || null;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());

    const doc = document;
    let landmarksAdded = 0;

    if (this.options.landmarks !== false) {
      const banner = findBanner(doc);
      if (banner) {
        s.setAttr(banner, 'role', 'banner');
        landmarksAdded++;
      }

      const nav = findNavigation(doc);
      if (nav) {
        s.setAttr(nav, 'role', 'navigation');
        landmarksAdded++;
      }

      const main = findMain(doc);
      if (main) {
        s.setAttr(main, 'role', 'main');
        landmarksAdded++;
      }

      const footer = findContentinfo(doc);
      if (footer) {
        s.setAttr(footer, 'role', 'contentinfo');
        landmarksAdded++;
      }
    }

    const maxLevel = typeof this.options.maxLevel === 'number' ? this.options.maxLevel : 6;
    const initialHeadings = s.page.headings({ maxLevel });

    if (landmarksAdded === 0 && initialHeadings.length === 0) {
      this.disable();
      return false;
    }

    if (this.options.outline !== false) {
      s.css(
        'ai4a11y-structure-styles',
        `
.ai4a11y-outline-list {
  list-style: none !important;
  margin: 0 !important;
  padding: 0 !important;
}
.ai4a11y-outline-item {
  margin: 2px 0 !important;
  list-style: none !important;
}
.ai4a11y-outline-item[data-level="1"] { padding-left: 0 !important; }
.ai4a11y-outline-item[data-level="2"] { padding-left: 12px !important; }
.ai4a11y-outline-item[data-level="3"] { padding-left: 24px !important; }
.ai4a11y-outline-item[data-level="4"] { padding-left: 36px !important; }
.ai4a11y-outline-item[data-level="5"] { padding-left: 48px !important; }
.ai4a11y-outline-item[data-level="6"] { padding-left: 60px !important; }

.ai4a11y-outline-link {
  all: revert !important;
  display: flex !important;
  align-items: baseline !important;
  gap: 8px !important;
  min-height: 28px !important;
  padding: 4px 6px !important;
  color: #0b3d91 !important;
  background: transparent !important;
  text-decoration: underline !important;
  border-radius: 4px !important;
  font: 500 14px/1.4 system-ui, -apple-system, sans-serif !important;
  box-sizing: border-box !important;
}
.ai4a11y-outline-link:hover {
  background: rgba(0, 0, 0, 0.05) !important;
  text-decoration: none !important;
}
.ai4a11y-outline-link:focus-visible {
  outline: 3px solid #1a5fb4 !important;
  outline-offset: 2px !important;
}
.ai4a11y-outline-level {
  display: inline-block !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  line-height: 1 !important;
  padding: 2px 5px !important;
  background: #e2e8f0 !important;
  color: #1e293b !important;
  border-radius: 3px !important;
  flex-shrink: 0 !important;
  text-decoration: none !important;
}
.ai4a11y-outline-text {
  flex-grow: 1 !important;
  word-break: break-word !important;
}
.ai4a11y-outline-empty {
  margin: 8px 0 !important;
  font-style: italic !important;
  color: #4b5563 !important;
}
`
      );

      const panel = s.panel({
        kind: 'dialog',
        label: 'Page outline',
        corner: 'bottom-right',
        width: 340,
        theme: 'page',
      });

      let headingIdSeq = 0;
      const renderOutline = () => {
        panel.body.replaceChildren();
        const currentHeadings = s.page.headings({ maxLevel });
        if (currentHeadings.length === 0) {
          const empty = s.el('p', {
            text: 'No headings on this page',
            attrs: { class: 'ai4a11y-outline-empty' },
          });
          panel.body.append(empty);
          return;
        }

        const list = s.el('ul', {
          attrs: {
            role: 'list',
            class: 'ai4a11y-outline-list',
          },
        });

        for (const h of currentHeadings) {
          if (!h.el.id) {
            let hid = `ai4a11y-heading-${++headingIdSeq}`;
            while (doc.getElementById(hid)) {
              hid = `ai4a11y-heading-${++headingIdSeq}`;
            }
            s.setAttr(h.el, 'id', hid);
          }

          const item = s.el('li', {
            attrs: {
              class: 'ai4a11y-outline-item',
              'data-level': String(h.level),
            },
          });

          const link = s.el('a', {
            attrs: {
              class: 'ai4a11y-outline-link',
              href: `#${h.el.id}`,
              'data-level': String(h.level),
            },
          });

          const badge = s.el('span', {
            text: `H${h.level}`,
            attrs: { class: 'ai4a11y-outline-level' },
          });

          const textSpan = s.el('span', {
            text: h.text || `Heading level ${h.level}`,
            attrs: { class: 'ai4a11y-outline-text' },
          });

          link.append(badge, ' ', textSpan);

          s.listen(link, 'click', (e) => {
            e.preventDefault();
            s.focus.region(h.el);
            panel.close();
          });

          item.append(link);
          list.append(item);
        }

        panel.body.append(list);
      };

      renderOutline();

      const entryBtn = s.focus.entry({
        label: 'Page outline',
        onActivate: () => {
          renderOutline();
          panel.open(entryBtn);
        },
      });
    }

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
