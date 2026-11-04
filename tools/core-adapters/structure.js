// structure.js — Gives the page a structure people can navigate by: adds missing
// ARIA landmarks and provides an on-page heading outline panel.
// Barrier: Blind, low-vision, and motor-impaired users struggle to navigate pages
// lacking landmark regions or to skim and jump between sections on long, dense pages.
//
// Suggested in onboarding for: vision, motor (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
// The outline opens from a 'Page outline' button that is the first thing Tab reaches
// after any skip link, visible when focused, so it covers nothing.
//
// Options:
//   outline: Boolean. Whether to provide the page outline panel and button. Defaults to true.
//   landmarks: Boolean. Whether to discover and add missing ARIA landmarks. Defaults to true.
//   maxLevel: Number. Maximum heading level (1 to 6) to include in the outline. Defaults to 6.
//
// Decisions:
//   • Adds missing landmarks (main, navigation, banner, contentinfo) with ARIA roles only
//     where the page has none and the region is unambiguous.
//   • Gives a landmark role only to a <div> or <section>, never to a list (ul, ol) or a native element.
//   • The page's banner and contentinfo are found the way the browser finds them: an element with
//     that role, or a header or footer with no role, not inside an article, section, aside, main or
//     nav (or an element with role article, complementary, main or navigation). A header or footer
//     inside those neither counts as one nor stops a region from being the main content.
//   • Main is decided first: a region made main takes the headers and footers inside it out of the
//     page's (the browser scopes them to it). So main may hold a stray header or footer, never the
//     page's last banner or contentinfo, unless the region the adapter would name banner or
//     contentinfo, outside it, takes its place. Banner and contentinfo are then added only if the
//     page has none left.
//   • Banner and contentinfo candidates follow the same rule as header and footer: not inside an
//     article, section, aside, main or nav. A contentinfo candidate never holds every banner.
//   • Takes the outermost candidate, never a part of it.
//   • A copyright line alone does not make a footer (requires a footer hint).
//   • The 'Page outline' button is added via s.focus.entry({ label: 'Page outline', onActivate }).
//   • The heading outline is displayed in an accessible dialog panel (s.panel).
//   • Headings' levels and text are never modified.
//   • Gives headings ids only when the outline is opened, generating ids with s.setAttr so they
//     are cleanly restored when the session ends.
//   • Choosing a heading link moves focus to that heading (s.focus.region) and closes the panel.
//   • Escape closes the panel and focus returns to the 'Page outline' entry button.
//   • The panel never covers the content it points to; it has an accessible name and a Close button.
//   • If there are no landmarks to add and no outline asked for (or no headings on the page),
//     ends the session and returns false.
//
// What it cannot do:
//   • Cannot invent landmarks for arbitrary layouts where regions are ambiguous or absent.
//   • Does not reorder headings or synthesize missing heading levels in author content.

// Inside these a header or footer is not the page's banner or contentinfo (as Chrome computes it;
// it does not scope by role="region").
const SCOPE = 'article, aside, main, nav, section, [role="article"], [role="complementary"], [role="main"], [role="navigation"]';
// Where the adapter adds no banner or contentinfo of its own.
const NON_TOP_ANCESTOR = `${SCOPE}, [role="region"]`;
const HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar)\b/i;
const NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo/i;
const FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon)\b/i;
const NAV_HINT = /\b(nav|navbar|navigation)\b/i;
const MAIN_ID = /^(main|content|main[-_]?content|primary)$/i;

function hint(re, el) {
  const cls = el.getAttribute('class') || '';
  const id = el.getAttribute('id') || '';
  return re.test(cls) || re.test(id);
}

function looksLikeNav(el) {
  const cls = el.getAttribute('class') || '';
  const id = el.getAttribute('id') || '';
  if (NAV_HINT.test(id)) return true;
  return cls.split(/\s+/).some((c) => /nav(bar|igation)?([-_]|$)/i.test(c));
}

// The page's banners ('banner') or contentinfos ('contentinfo') as it is now: what the browser
// exposes, except that an explicit role inside SCOPE does not count either (the brief).
function pageLandmarks(doc, role) {
  const tag = role === 'banner' ? 'header' : 'footer';
  return [...doc.querySelectorAll(`${tag}, [role="${role}"]`)].filter((el) => {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit ? explicit !== role : el.localName !== tag) return false;
    return !el.parentElement?.closest(SCOPE);
  });
}

function hasNavigation(doc) {
  return doc.querySelector('nav, [role="navigation"]') !== null;
}

// The outermost top-level divs and sections named like a banner (re) or contentinfo.
function hintCandidates(doc, re, maxText, ok) {
  const found = [...doc.querySelectorAll('div, section')].filter((el) => {
    if (el.getAttribute('role')) return false;
    if (el.parentElement?.closest(NON_TOP_ANCESTOR)) return false;
    if (el.closest('[role="banner"], [role="contentinfo"]')) return false;
    if (el.querySelector('main, [role="main"]')) return false;
    if (!hint(re, el) || !ok(el)) return false;
    return (el.textContent?.trim().length || 0) < maxText;
  });
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

// Whether every one of found is inside el (and there is one): a contentinfo there would bury
// the page's banner.
function holdsAll(el, found) {
  return found.length > 0 && found.every((x) => el.contains(x));
}

// Whether the page keeps a banner (or contentinfo) once el is main: one of its own (found) outside
// el, or the adapter's candidate (hint) outside el; or it had none to lose.
function keeps(el, found, hint) {
  if (found.some((x) => !el.contains(x))) return true;
  return hint ? !el.contains(hint) : found.length === 0;
}

function addNavigation(s, doc) {
  if (hasNavigation(doc)) return false;
  let candidates = [...doc.querySelectorAll('div, section')].filter((el) => {
    if (el.getAttribute('role')) return false;
    if (el.closest('nav, [role="navigation"]')) return false;
    if (!looksLikeNav(el)) return false;
    const links = el.querySelectorAll('a').length;
    const textLength = el.textContent?.trim().length || 1;
    if (links < 3 || (links * 15) / textLength <= 0.5) return false;
    return true;
  });
  candidates = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
  if (candidates.length === 0) return false;
  let count = 0;
  for (const target of candidates) {
    s.setAttr(target, 'role', 'navigation');
    count++;
  }
  return count > 0;
}

// bannerHint, footerHint: the regions the adapter would name banner and contentinfo, or null.
function addMain(s, doc, bannerHint, footerHint) {
  if (doc.querySelector('main, [role="main"]')) return false;

  const LANDMARK_ANCESTOR = 'article, [role="article"], header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';
  const banners = pageLandmarks(doc, 'banner');
  const footers = pageLandmarks(doc, 'contentinfo');

  let candidates = [...doc.querySelectorAll('div, section')].filter((el) => {
    if (el.getAttribute('role')) return false;
    if ((el.textContent?.trim().length || 0) <= 100) return false;
    if (el.closest(LANDMARK_ANCESTOR)) return false;
    if (bannerHint?.contains(el) || footerHint?.contains(el)) return false;
    return keeps(el, banners, bannerHint) && keeps(el, footers, footerHint);
  });

  if (candidates.length === 0) return false;

  const named = candidates.filter((el) => {
    const id = el.getAttribute('id') || '';
    if (MAIN_ID.test(id)) return true;
    const cls = el.getAttribute('class') || '';
    return cls.split(/\s+/).some((c) => MAIN_ID.test(c));
  });

  const pool = named.length > 0 ? named : candidates;
  const outermost = pool.filter((el) => !pool.some((other) => other !== el && other.contains(el)));
  if (outermost.length === 0) return false;

  const target = outermost.reduce((a, b) =>
    (a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b
  );

  s.setAttr(target, 'role', 'main');
  return true;
}

export default {
  s: null,
  options: null,
  toolkit: null,
  panel: null,
  entryBtn: null,

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const doc = document;

    let landmarksAdded = 0;
    if (this.options.landmarks !== false) {
      const banners = pageLandmarks(doc, 'banner');
      const bannerHint = hintCandidates(doc, HEADER_HINT, 2000, (el) => !hint(NOT_HEADER, el))[0] || null;
      const footerHint = hintCandidates(doc, FOOTER_HINT, 1500, (el) => !holdsAll(el, banners)).at(-1) || null;
      if (addNavigation(s, doc)) landmarksAdded++;
      if (addMain(s, doc, bannerHint, footerHint)) landmarksAdded++;
      // After main, which scopes the headers and footers inside it, as the browser does.
      if (bannerHint && pageLandmarks(doc, 'banner').length === 0) {
        s.setAttr(bannerHint, 'role', 'banner');
        landmarksAdded++;
      }
      if (footerHint && pageLandmarks(doc, 'contentinfo').length === 0
        && !footerHint.closest('[role="banner"]') && !holdsAll(footerHint, pageLandmarks(doc, 'banner'))) {
        s.setAttr(footerHint, 'role', 'contentinfo');
        landmarksAdded++;
      }
    }

    const wantOutline = this.options.outline !== false;
    const maxLevel = this.options.maxLevel || 6;
    const headings = wantOutline ? this.toolkit.page.headings({ maxLevel }) : [];

    if (landmarksAdded === 0 && (!wantOutline || headings.length === 0)) {
      this.disable();
      return false;
    }

    if (wantOutline && headings.length > 0) {
      s.css('structure-outline', `
.ai4a11y-outline-list {
  list-style: none !important;
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 2px !important;
}
.ai4a11y-outline-item {
  margin: 0 !important;
  padding: 0 !important;
  list-style: none !important;
}
.ai4a11y-outline-item[data-level="1"] { padding-left: 0 !important; }
.ai4a11y-outline-item[data-level="2"] { padding-left: 12px !important; }
.ai4a11y-outline-item[data-level="3"] { padding-left: 24px !important; }
.ai4a11y-outline-item[data-level="4"] { padding-left: 36px !important; }
.ai4a11y-outline-item[data-level="5"] { padding-left: 48px !important; }
.ai4a11y-outline-item[data-level="6"] { padding-left: 60px !important; }
.ai4a11y-outline-link {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  min-height: 32px !important;
  padding: 4px 8px !important;
  border-radius: 4px !important;
  color: inherit !important;
  text-decoration: underline !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
}
.ai4a11y-outline-link:hover {
  background: rgba(0, 0, 0, 0.06) !important;
}
.ai4a11y-outline-level {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  line-height: 1 !important;
  padding: 2px 5px !important;
  border: 1px solid currentColor !important;
  border-radius: 3px !important;
  flex-shrink: 0 !important;
  letter-spacing: 0.5px !important;
}
.ai4a11y-outline-text {
  word-break: break-word !important;
}
`);

      this.panel = s.panel({
        kind: 'dialog',
        label: 'Page outline',
        corner: 'bottom-right',
        width: 360,
      });

      this.entryBtn = s.focus.entry({
        label: 'Page outline',
        onActivate: () => this.openOutline(),
      });
    }
  },

  openOutline() {
    if (!this.panel) return;
    if (this.panel.isOpen) {
      this.panel.close();
      return;
    }
    this.renderOutline();
    this.panel.open(this.entryBtn);
  },

  renderOutline() {
    const s = this.s;
    if (!s || s.ended || !this.panel) return;
    const doc = document;
    const maxLevel = this.options.maxLevel || 6;
    const headings = this.toolkit.page.headings({ maxLevel });

    this.panel.body.replaceChildren();

    if (headings.length === 0) {
      const empty = s.el('p', { text: 'No headings on this page' });
      this.panel.body.append(empty);
      return;
    }

    const list = s.el('ul', {
      attrs: {
        class: 'ai4a11y-outline-list',
        role: 'list',
      },
    });

    let n = 0;
    for (const h of headings) {
      if (!h.el.id) {
        let id;
        do {
          id = `ai4a11y-heading-${++n}`;
        } while (doc.getElementById(id));
        s.setAttr(h.el, 'id', id);
      }

      const item = s.el('li', {
        attrs: {
          class: 'ai4a11y-outline-item',
          'data-level': String(h.level),
        },
      });

      const link = s.el('a', {
        attrs: {
          href: `#${h.el.id}`,
          class: 'ai4a11y-outline-link',
          'data-level': String(h.level),
        },
      });

      const badge = s.el('span', {
        text: `H${h.level}`,
        attrs: { class: 'ai4a11y-outline-level' },
      });

      const textSpan = s.el('span', {
        text: h.text || h.el.textContent.replace(/\s+/g, ' ').trim(),
        attrs: { class: 'ai4a11y-outline-text' },
      });

      link.append(badge, textSpan);

      s.listen(link, 'click', (e) => {
        e.preventDefault();
        s.focus.region(h.el);
        this.panel.close();
      });

      item.append(link);
      list.append(item);
    }

    this.panel.body.append(list);
  },

  disable() {
    this.s?.end();
    this.s = null;
    this.panel = null;
    this.entryBtn = null;
  },
};
