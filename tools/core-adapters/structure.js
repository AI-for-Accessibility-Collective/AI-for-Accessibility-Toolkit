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
//   ai: Boolean. Whether to ask the toolkit's model where the page does not say (below). Defaults
//     to true. With false it never asks, and adds only what the rules decide alone (as with no model).
//
// Decisions:
//   • Adds missing landmarks (main, navigation, banner, contentinfo) with ARIA roles only
//     where the page has none and the region is unambiguous.
//   • Gives a landmark role only to a <div> or <section>, never to a list (ul, ol) or a native element.
//   • The rules decide from what the page says: roles, native elements, where a part is in the
//     page, how much text it shows and how many links. A class name or id never decides anything.
//     Where the rules leave more than one part, or a div whose role only its content could tell,
//     the adapter asks the toolkit's model (s.ai.choose) with the parts the rules found; the model
//     sees their names among what they contain, as a clue. When it cannot tell, or there is no
//     model (ai: false, the budget spent), the adapter does less: it adds no landmark. Each
//     question is asked at most once per enable(), and its answer is cached for the page.
//     enable() is synchronous when there is nothing to ask.
//   • The page's banner and contentinfo are what the browser exposes (page.landmarks): an element
//     with that role, or a header or footer not inside an article, section, aside, main or nav (or
//     an element with role article, complementary, main or navigation). A header or footer inside
//     those, or an explicit banner or contentinfo role there, neither counts as one nor stops a
//     region from being the main content. Where the page has one, the model is never asked.
//   • Navigation, where the page has none: the divs and sections around a list of links (a ul or ol
//     of three or more linked items, or a div of three or more links), dense with links, outermost.
//     The model is asked which is the site's menu; that one only becomes navigation.
//   • Main is decided next: divs and sections showing more than 100 characters, not inside a
//     landmark; a wrapper with nothing of its own around one of them is that one. Never one that
//     takes the page's last banner or contentinfo while another does not (main takes the headers
//     and footers inside it out of the page's, as the browser scopes them). One left is main; of
//     several, the model is asked which is the main content (at most 12: the outermost first).
//   • Where main would take the page's only header or footer, the page does not say whose they
//     are: the site's, or the content's (an article's title and date). The adapter asks about each
//     one, and makes the region main only if every one is the content's.
//   • Banner and contentinfo, only where the page has none left once main is decided, and only when
//     it has a main: the outermost top-level divs and sections before main (for banner) or after
//     it (for contentinfo), not inside an article, section, aside, main, nav or region, under 2000
//     (1500) characters. The model is asked which is the whole site's header (footer); a notice, a
//     cookie message, an entry-header or a copyright line is its to tell apart, not a name rule's.
//   • Takes the outermost candidate, never a part of it.
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
//   • Without the model it names no div banner, contentinfo or navigation, and makes a div main only
//     where it is the one region left: on most pages without landmarks it then offers the outline only.
//   • Does not reorder headings or synthesize missing heading levels in author content.

// Inside these a banner or contentinfo does not count, even by an explicit role (the brief; the
// browser scopes only header and footer elements there).
const SCOPE = 'article, aside, main, nav, section, [role="article"], [role="complementary"], [role="main"], [role="navigation"]';
// Where the adapter adds no banner or contentinfo of its own.
const NON_TOP_ANCESTOR = `${SCOPE}, [role="region"]`;
// Inside these no region is the main content.
const LANDMARK_ANCESTOR = 'article, [role="article"], header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';
const MAIN = 'main, [role="main"]';
// The most options one question gives the model (s.ai.choose takes 12).
const MAX_OPTIONS = 12;

// The questions, for s.ai.choose. Each is asked at most once per enable(), and the block caches its
// answer for the page. A spec's fixed answers name them by these words.
const ASK = {
  navigation: "Which of these is the site's menu: links for getting around the site or this page?",
  main: "Which of these is the page's main content: what this page is for, without the site's header, menus or footer around it?",
  banner: "Which of these is the whole site's header: the site's name or logo, often with its menu or search? Not a notice, an alert or a cookie message.",
  contentinfo: "Which of these is the whole site's footer: the site's own links, contact details or copyright, at the end of the page?",
};

const textLength = (el) => el.textContent?.trim().length || 0;
const outermost = (list) => list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
const thenable = (v) => Boolean(v && typeof v.then === 'function');
// f(v), at once when v is a value, after it when v is a promise: enable() stays synchronous while
// there is nothing to ask.
const then = (v, f) => (thenable(v) ? v.then(f) : f(v));
const all = (values, f) => (values.some(thenable) ? Promise.all(values).then(f) : f(values));
const sum = (list) => list.reduce((a, b) => a + b, 0);

// The page's banners ('banner') or contentinfos ('contentinfo') as it is now: what the browser
// exposes (page.landmarks), except one inside SCOPE by an explicit role (the brief).
function pageLandmarks(page, role) {
  return page.landmarks(role).filter((el) => !el.parentElement?.closest(SCOPE));
}

function hasNavigation(doc) {
  return doc.querySelector('nav, [role="navigation"]') !== null;
}

// A list of links: a ul or ol with three or more items holding a link (half its items at least),
// or a div or section with three or more links of its own (its children).
function isLinkList(el) {
  if (el.matches('ul, ol')) {
    const items = [...el.children].filter((c) => c.localName === 'li');
    const linked = items.filter((li) => li.querySelector('a[href]')).length;
    return linked >= 3 && linked * 2 >= items.length;
  }
  return [...el.children].filter((c) => c.matches('a[href]')).length >= 3;
}

// The divs and sections around a list of links, where the page has no navigation: the outermost,
// dense with links (as many links as a short text has words), in page order.
function navCandidates(doc, page) {
  const found = new Set();
  for (const list of doc.querySelectorAll('ul, ol, div, section')) {
    if (!isLinkList(list)) continue;
    const box = list.matches('div, section') ? list : list.parentElement?.closest('div, section');
    if (!box || box.getAttribute('role') || box.closest('nav, [role="navigation"]') || page.isOurs(box)) continue;
    const links = box.querySelectorAll('a[href]').length;
    if (links >= 3 && (links * 15) / (textLength(box) || 1) > 0.5) found.add(box);
  }
  return outermost([...found]).slice(0, MAX_OPTIONS);
}

// The regions that may be the main content: divs and sections showing text (more than 100
// characters), not inside a landmark. A wrapper with nothing of its own around one of them is that
// one: the outermost stays.
function mainCandidates(doc, page) {
  const loose = [...doc.querySelectorAll('div, section')].filter((el) => {
    if (el.getAttribute('role') || page.isOurs(el)) return false;
    if (textLength(el) <= 100 || el.closest(LANDMARK_ANCESTOR)) return false;
    // What it shows, where the browser lays the page out: a menu's hidden panels are not text.
    return typeof el.innerText !== 'string' || el.innerText.replace(/\s+/g, ' ').trim().length > 100;
  });
  const set = new Set(loose);
  const nearest = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return p;
    return null;
  };
  return loose.filter((el) => {
    const outer = nearest(el);
    return !outer || textLength(outer) !== textLength(el);
  });
}

// At most MAX_OPTIONS of them for the model: the outermost first, then those inside, the larger
// first at each depth; in page order.
function mainOptions(pool) {
  if (pool.length <= MAX_OPTIONS) return pool;
  const set = new Set(pool);
  const depth = (el) => {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) d++;
    return d;
  };
  const ranked = pool.map((el, i) => ({ el, i, d: depth(el), n: textLength(el) }))
    .sort((a, b) => a.d - b.d || b.n - a.n)
    .slice(0, MAX_OPTIONS);
  return ranked.sort((a, b) => a.i - b.i).map((x) => x.el);
}

// Whether the page keeps a banner (or contentinfo) once el is main: one of its own outside el, or
// it had none to lose.
function keeps(el, found) {
  return found.length === 0 || found.some((x) => !el.contains(x));
}

// The page's banners and contentinfos region would take, of each kind it would take them all of.
function takes(region, banners, footers) {
  const kind = (found, what) => (found.length && !keeps(region, found) ? found.map((el) => ({ el, what })) : []);
  return [...kind(banners, 'header'), ...kind(footers, 'footer')];
}

// The outermost top-level divs and sections showing something, before (or after) main: not inside
// a landmark or region, not holding main, under maxText characters.
function chromeCandidates(doc, page, main, where, maxText) {
  const found = [...doc.querySelectorAll('div, section')].filter((el) => {
    if (el.getAttribute('role') || page.isOurs(el)) return false;
    if (el.parentElement?.closest(NON_TOP_ANCESTOR)) return false;
    if (el.closest('[role="banner"], [role="contentinfo"]')) return false;
    if (el.contains(main) || el.querySelector(MAIN)) return false;
    const position = main.compareDocumentPosition(el);
    if (!(position & (where === 'before' ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING))) return false;
    const n = textLength(el);
    return (n > 0 || el.querySelector('img, svg')) && n < maxText;
  });
  const top = outermost(found);
  return where === 'before' ? top.slice(0, MAX_OPTIONS) : top.slice(-MAX_OPTIONS);
}

// Navigation, where the page has none: the list of links the model says is the site's menu.
function addNavigation(s, doc, page, ask) {
  if (hasNavigation(doc)) return 0;
  const options = navCandidates(doc, page);
  if (!options.length) return 0;
  return then(ask(ASK.navigation, options, { context: `The page's title: "${doc.title}"` }), (el) => {
    if (!el?.isConnected || s.ended || hasNavigation(doc)) return 0;
    s.setAttr(el, 'role', 'navigation');
    return 1;
  });
}

// Main, where the page has none. Not a region that takes the page's last banner or contentinfo,
// while another does not. One such region is main by the rules; of several, the model says which.
// One that takes the page's only header or footer is main only if the model says they are its own.
function addMain(s, doc, page, ask) {
  if (doc.querySelector(MAIN)) return 0;
  const banners = pageLandmarks(page, 'banner');
  const footers = pageLandmarks(page, 'contentinfo');
  const found = mainCandidates(doc, page);
  if (!found.length) return 0;
  const keeping = found.filter((el) => keeps(el, banners) && keeps(el, footers));
  const pool = keeping.length ? keeping : found;
  const chosen = pool.length === 1 ? pool[0] : ask(ASK.main, mainOptions(pool), { context: `The page's title: "${doc.title}"` });
  return then(chosen, (region) => {
    if (!region?.isConnected || s.ended || doc.querySelector(MAIN)) return 0;
    const taken = takes(region, banners, footers);
    const make = (ok) => {
      if (!ok || s.ended || doc.querySelector(MAIN)) return 0;
      s.setAttr(region, 'role', 'main');
      return 1;
    };
    return taken.length ? then(contentsOwn(s, region, taken, ask), make) : make(true);
  });
}

// Banner and contentinfo, after main, which takes the headers and footers inside it out of the
// page's, as the browser does: only where the page has none left, and only a region before (or
// after) main that the model says is the whole site's header (or footer).
function addChrome(s, doc, page, ask) {
  const main = doc.querySelector(MAIN);
  if (!main) return 0;
  const one = (role, where, maxText) => {
    if (pageLandmarks(page, role).length) return 0;
    const options = chromeCandidates(doc, page, main, where, maxText);
    if (!options.length) return 0;
    return then(ask(ASK[role], options), (el) => {
      if (!el?.isConnected || s.ended || pageLandmarks(page, role).length) return 0;
      s.setAttr(el, 'role', role);
      return 1;
    });
  };
  return all([one('banner', 'before', 2000), one('contentinfo', 'after', 1500)], sum);
}

// Asks whose each landmark the region would take is; true when every one is the content's. false
// at once when there is no model to ask.
function contentsOwn(s, region, taken, ask) {
  if (!ask.can) return false;
  const answers = taken.map(({ el, what }) => ask(`This ${what} is the only one on the page, inside a part that may be the page's main content. Is it the ${what} of the whole site, or of the content it is in?`, [
    { value: 'site', about: `The whole site's ${what}: ${what === 'header' ? "the site's name or logo, a menu or search for the whole site" : "the site's links, contact details, copyright for the whole site"}.` },
    { value: 'content', about: `The ${what} of the content it is in: ${what === 'header' ? "that content's own title, author, date or summary" : "that content's own tags, author, date, share or comment links"}.` },
  ], { context: `The ${what}:\n${s.ai.outline(el, { maxChars: 900 })}\n\nThe part it is in:\n${s.ai.outline(region, { maxChars: 1000 })}` }));
  return Promise.all(answers).then((list) => list.every((a) => a === 'content'));
}

// The landmarks, in order: navigation, main, then banner and contentinfo. A number, or a promise
// of one while the model is asked.
function addLandmarks(s, doc, page, ask) {
  return then(addNavigation(s, doc, page, ask), (nav) =>
    then(addMain(s, doc, page, ask), (main) =>
      then(addChrome(s, doc, page, ask), (chrome) => nav + main + chrome)));
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
    let asking = null;
    if (this.options.landmarks !== false) {
      // Where the page does not say, the model may know from what its parts contain. With none
      // (no model, ai: false, the budget spent), or when it cannot tell, the adapter does less.
      const can = this.options.ai !== false && s.ai.available;
      const ask = (question, options, opts) => (can ? s.ai.choose(question, options, opts).catch(() => null) : null);
      ask.can = can;
      const added = addLandmarks(s, doc, this.toolkit.page, ask);
      if (thenable(added)) asking = added.catch(() => 0);
      else landmarksAdded = added;
    }

    const wantOutline = this.options.outline !== false;
    const maxLevel = this.options.maxLevel || 6;
    const headings = wantOutline ? this.toolkit.page.headings({ maxLevel }) : [];

    if (landmarksAdded === 0 && (!wantOutline || headings.length === 0)) {
      if (!asking) {
        this.disable();
        return false;
      }
      return asking.then((added) => {
        if (added) return true;
        this.disable();
        return false;
      });
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
  font-size: 16px !important;
  line-height: 1.4 !important;
}
.ai4a11y-outline-link:hover {
  background: rgba(0, 0, 0, 0.06) !important;
}
.ai4a11y-outline-level {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 16px !important;
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
    if (asking) return asking.then(() => true);
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
