// structure.js — Gives the page a structure people can navigate by:
// adds missing landmarks (main, navigation, banner, contentinfo) with ARIA roles
// only where the page has none and the region is unambiguous, and provides an
// outline of the page's headings in an accessible panel (s.panel) opened from a
// 'Page outline' button (s.focus.entry).
//
// Barrier: Unstructured pages (div-soup, missing landmarks) prevent screen reader
// and keyboard users from navigating by landmark regions. People with motor, visual,
// or cognitive barriers who cannot easily skim or scroll long pages need clear
// signposting and heading navigation to reach relevant sections directly.
//
// Suggested in onboarding for: vision, motor (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
// The outline opens from a 'Page outline' button that is the first thing Tab reaches
// after any skip link, visible when focused, so it covers nothing.
//
// Options:
//   maxLevel: Deepest heading level to include in the outline (1 to 6, default 6).
//
// Decisions:
//   • Adds missing landmarks (main, navigation, banner, contentinfo) using ARIA roles
//     only where the page has none and candidate regions are unambiguous.
//   • Never overwrites an existing ARIA role, and never assigns landmark roles to
//     native landmark elements (<header>, <main>, <footer>, <nav>, <aside>).
//   • Banner (site header) requires header-like class or id naming, rejects consent/cookie
//     bars, rejects blocks containing main, and requires text length < 2000 characters.
//   • Contentinfo (footer) requires footer-like class/id or copyright notice near end,
//     rejects blocks containing header/main/nav, and requires text length < 1500 characters.
//   • Navigation requires token-based nav naming, at least 3 links, link density > 0.4,
//     and is only added to the primary nav candidate when no navigation landmark exists.
//   • Main landmark requires top-level content block with > 100 characters of text,
//     neither containing nor contained inside other landmarks; prefers blocks named
//     main/content, falling back to the largest content block.
//   • The 'Page outline' button uses s.focus.entry({ label: 'Page outline', onActivate }),
//     placing it first in tab order after any skip link, visible only when focused.
//   • The outline panel is built with s.panel({ kind: 'dialog', label: 'Page outline' }),
//     providing a dialog with its own Close button and accessible name.
//   • Choosing a heading item in the outline closes the panel and moves focus to the
//     target heading with s.focus.region(heading). Escape closes the panel and returns
//     focus to the 'Page outline' button.
//   • Never changes headings' levels or text.
//   • The panel never covers the content it points to: upon choosing a heading, the panel
//     closes immediately and scrolls the heading into view.
//   • If no landmarks are missing and no headings exist on the page, enable() returns false.
//
// What it cannot do:
//   • Cannot infer landmarks where page containers lack structural or semantic hints.
//   • Does not fix improper heading hierarchies or generate missing heading text.

const LANDMARK_SELECTOR = 'header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';
const SHELL_SELECTOR = 'header, footer, main, [role="banner"], [role="contentinfo"], [role="main"]';
const MAIN_ID = /^(main|content|main-?content|primary)$/i;

const HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar)\b/i;
const NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo/i;
const FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon|copyright)\b/i;
const COPYRIGHT_RE = /©|\(c\)\s*\d|copyright|all rights reserved/i;

function hint(re, el) {
  return re.test(el.className || '') || re.test(el.id || '');
}

function looksLikeNav(el) {
  const cls = Array.from(el.classList || []).some((c) => /(?:^|[-_])nav(?:bar|igation)?(?:[-_]|$)/i.test(c));
  const id = /(?:^|[-_])nav(?:bar|igation)?(?:[-_]|$)/i.test(el.id || '');
  return (cls || id) && !/cookie|consent|privacy|notice|alert|promo/i.test((el.className || '') + ' ' + (el.id || ''));
}

function ensureBanner(s, doc, page) {
  if (doc.querySelector('header, [role="banner"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, td, aside'))
    .filter((e) => !page.isOurs(e) && page.isVisible(e))
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => hint(HEADER_HINT, e) && !hint(NOT_HEADER, e))
    .filter((e) => !e.closest(LANDMARK_SELECTOR))
    .filter((e) => !e.querySelector('main, [role="main"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 2000);
  const el = candidates[0];
  if (!el) return false;
  s.setAttr(el, 'role', 'banner');
  return true;
}

function ensureContentinfo(s, doc, page) {
  if (doc.querySelector('footer, [role="contentinfo"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, td, aside'))
    .filter((e) => !page.isOurs(e) && page.isVisible(e))
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => !e.closest(LANDMARK_SELECTOR))
    .filter((e) => hint(FOOTER_HINT, e) || COPYRIGHT_RE.test((e.textContent || '').slice(-400)))
    .filter((e) => !e.querySelector('main, [role="main"], nav, [role="navigation"], header, [role="banner"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 1500);
  const el = candidates[candidates.length - 1];
  if (!el) return false;
  s.setAttr(el, 'role', 'contentinfo');
  return true;
}

function ensureNavigation(s, doc, page) {
  if (doc.querySelector('nav, [role="navigation"]')) return false;
  const candidates = Array.from(doc.querySelectorAll('div, section, ul, ol'))
    .filter((e) => !page.isOurs(e) && page.isVisible(e))
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => !e.closest('nav, [role="navigation"], main, [role="main"]'))
    .filter((e) => !e.querySelector('main, [role="main"]'))
    .filter((e) => looksLikeNav(e))
    .filter((e) => {
      const links = e.querySelectorAll('a').length;
      const textLen = e.textContent?.trim().length || 1;
      return links >= 3 && (links * 15) / textLen > 0.4 && textLen < 2500;
    });
  const el = candidates[0];
  if (!el) return false;
  s.setAttr(el, 'role', 'navigation');
  return true;
}

function ensureMain(s, doc, page) {
  if (doc.querySelector('main, [role="main"]')) return false;

  const isCandidate = (el) => {
    if (page.isOurs(el) || !page.isVisible(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (['header', 'footer', 'nav', 'aside', 'script', 'style', 'noscript'].includes(tag)) return false;
    if (el.getAttribute('role')) return false;
    if ((el.textContent?.trim().length || 0) <= 100) return false;
    if (el.querySelector(SHELL_SELECTOR)) return false;
    if (el.closest(LANDMARK_SELECTOR)) return false;
    return true;
  };

  let level = doc.body ? Array.from(doc.body.children) : [];
  let candidates = level.filter(isCandidate);
  if (candidates.length === 0) {
    const shell = level.find((el) =>
      !el.closest(LANDMARK_SELECTOR) &&
      (el.textContent?.trim().length || 0) > 100 &&
      el.querySelector(LANDMARK_SELECTOR)
    );
    if (shell) candidates = Array.from(shell.children).filter(isCandidate);
  }
  if (candidates.length === 0) return false;

  const named = candidates.filter((el) =>
    MAIN_ID.test(el.id || '') ||
    (el.classList && (el.classList.contains('main') || el.classList.contains('content')))
  );
  const main = (named.length ? named : candidates).reduce((a, b) =>
    (a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b
  );

  s.setAttr(main, 'role', 'main');
  return true;
}

function fixAllLandmarks(s, doc, page) {
  let count = 0;
  if (ensureBanner(s, doc, page)) count++;
  if (ensureNavigation(s, doc, page)) count++;
  if (ensureContentinfo(s, doc, page)) count++;
  if (ensureMain(s, doc, page)) count++;
  return count;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const doc = document;
    const page = this.toolkit.page;
    const maxLevel = Math.max(1, Math.min(6, Number(this.options.maxLevel) || 6));

    const fixedCount = fixAllLandmarks(s, doc, page);
    const initialHeadings = page.headings({ maxLevel })
      .filter((h) => h.text && h.text.trim())
      .filter((h) => h.el.getAttribute('role') !== 'presentation' && h.el.getAttribute('role') !== 'none');

    if (fixedCount === 0 && initialHeadings.length === 0) {
      return false;
    }

    if (initialHeadings.length > 0) {
      const panel = s.panel({
        kind: 'dialog',
        label: 'Page outline',
        corner: 'bottom-right',
        width: 360,
      });

      s.css('ai4a11y-structure-styles', `
        .ai4a11y-outline-link:focus,
        .ai4a11y-outline-link:focus-visible {
          outline: 3px solid #0b3d91 !important;
          outline-offset: 2px !important;
        }
        .ai4a11y-outline-link:hover {
          background: rgba(11, 61, 145, 0.08) !important;
        }
      `);

      let idCounter = 0;
      const renderOutline = () => {
        const headings = page.headings({ maxLevel })
          .filter((h) => h.text && h.text.trim())
          .filter((h) => h.el.getAttribute('role') !== 'presentation' && h.el.getAttribute('role') !== 'none');
        panel.body.replaceChildren();

        if (headings.length === 0) {
          const emptyMsg = s.el('p', {
            text: 'No headings on this page',
            attrs: { class: 'ai4a11y-outline-empty' },
          });
          emptyMsg.style.cssText = 'margin: 0; padding: 8px 0; color: inherit;';
          panel.body.append(emptyMsg);
          return;
        }

        const nav = s.el('nav', {
          attrs: {
            'aria-label': 'Headings',
            class: 'ai4a11y-outline-nav',
          },
        });
        const list = s.el('ol', {
          attrs: {
            role: 'list',
            class: 'ai4a11y-outline-list',
          },
        });
        list.style.cssText = 'list-style: none; margin: 0; padding: 0;';

        for (const { el, level, text } of headings) {
          if (!el.id) {
            let id;
            do {
              id = `ai4a11y-heading-${++idCounter}`;
            } while (doc.getElementById(id));
            s.setAttr(el, 'id', id);
          }

          const li = s.el('li', {
            attrs: {
              class: 'ai4a11y-outline-item',
              'data-level': String(level),
            },
          });
          li.style.cssText = `margin: 4px 0; padding-left: ${(level - 1) * 16}px;`;

          const link = s.el('a', {
            attrs: {
              href: `#${el.id}`,
              class: 'ai4a11y-outline-link',
              'data-level': String(level),
            },
          });
          link.style.cssText = 'display: inline-flex; align-items: baseline; gap: 8px; min-height: 28px; padding: 4px 8px; color: #0b3d91; text-decoration: underline; border-radius: 4px; box-sizing: border-box;';

          const badge = s.el('span', {
            text: `H${level}`,
            attrs: { class: 'ai4a11y-outline-level' },
          });
          badge.style.cssText = 'font-weight: 700; font-size: 0.85em; opacity: 0.85; flex-shrink: 0;';

          const labelSpan = s.el('span', {
            text,
            attrs: { class: 'ai4a11y-outline-text' },
          });

          link.append(badge, labelSpan);
          li.append(link);
          list.append(li);
        }

        nav.append(list);
        panel.body.append(nav);
      };

      const jumpToHeading = (target) => {
        panel.close();
        s.focus.region(target);
      };

      s.listen(panel.body, 'click', (e) => {
        const link = e.target.closest('a.ai4a11y-outline-link');
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute('href');
        if (!href || !href.startsWith('#')) return;
        const target = doc.getElementById(href.slice(1));
        if (target) {
          jumpToHeading(target);
        }
      });

      s.listen(panel.body, 'keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          const link = e.target.closest('a.ai4a11y-outline-link');
          if (!link) return;
          e.preventDefault();
          const href = link.getAttribute('href');
          if (!href || !href.startsWith('#')) return;
          const target = doc.getElementById(href.slice(1));
          if (target) {
            jumpToHeading(target);
          }
        }
      });

      const entryBtn = s.focus.entry({
        label: 'Page outline',
        onActivate: () => {
          renderOutline();
          panel.open(entryBtn);
        },
      });

      this.panel = panel;
      this.entryBtn = entryBtn;
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
    this.panel = null;
    this.entryBtn = null;
  },
};
