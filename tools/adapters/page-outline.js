// Page Outline — builds an on-page heading navigator (a table of contents /
// skip menu) so users who cannot skim can jump straight to any section. From
// the co-design study: Daniel (screen reader) wanted "signposting, wayfinding"
// on long government pages, and Clive (eye gaze) pays per scroll — listing the
// page's h1–h3 headings as links turns a long scroll into one activation.
//
// The outline is a small "Page outline" button in the bottom-right corner
// that opens the list. Open all the time, a 320px panel pinned to the top
// right covered the site's own header (account, cart) and, on a phone, most
// of the page.
//
// Reversible by construction: the outline is a single injected <nav> we can
// remove, and every mutation to the page itself (a generated heading id, a
// tabindex added so focus() can land on the heading) is tracked in a Set so
// disable() restores the page exactly.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';

// Headings that are only styled as headings: role="heading", or the common
// .h1–.h6 utility classes (Bootstrap and many stores) on a div. A page built
// that way otherwise has an empty outline. Level comes from aria-level or the
// class number.
const STYLED_HEADINGS = '[role="heading"], .h1, .h2, .h3, .h4, .h5, .h6';

function levelOf(el) {
  const tag = /^H([1-6])$/.exec(el.tagName);
  if (tag) return Number(tag[1]);
  const aria = Number(el.getAttribute('aria-level'));
  if (aria >= 1) return aria;
  const cls = el.classList && [...el.classList].map((c) => /^h([1-6])$/.exec(c)).find(Boolean);
  if (cls) return Number(cls[1]);
  return 2; // role="heading" with no aria-level is level 2
}

export const PageOutline = {
  containerId: 'ai4a11y-page-outline',
  enabled: false,
  style: null,          // the scoped colour stylesheet (removed on disable)
  addedIds: null,       // Set of headings we gave a generated id (for exact restore)
  addedTabindex: null,  // Set of headings we gave tabindex="-1" (for exact restore)
  nav: null,
  toggleBtn: null,
  listBox: null,
  selector: 'h1, h2, h3',
  maxLevel: 3,
  _keyHandler: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.addedIds = new Set();
    this.addedTabindex = new Set();
    this.selector = options.selector || 'h1, h2, h3';
    this.maxLevel = options.selector ? 6 : 3;

    // Colour the panel's OWN elements defensively. Setting color on the <nav>
    // only reaches inherited text — but the outline's contents are <a>, and the
    // host page's own `a { color }` beats inheritance, so on a dark-themed site
    // the links keep the page's near-white link colour and vanish on the panel's
    // white background (measured 1.16:1 on DuckDuckGo dark). A scoped !important
    // sheet wins over the host stylesheet. Injected UI must paint its own colours.
    // The focus ring is ours too: a page that turns outlines off everywhere
    // would otherwise hide where the keyboard is inside the outline.
    this.style = injectStyle(`${this.containerId}-styles`, `
#${this.containerId} { background: #ffffff !important; color: #111111 !important; border-color: #333333 !important; }
#${this.containerId} p, #${this.containerId} li { color: #111111 !important; }
#${this.containerId} a,
#${this.containerId} a:link,
#${this.containerId} a:visited,
#${this.containerId} a:hover,
#${this.containerId} a:focus { color: #0b3d91 !important; background: transparent !important; text-decoration: underline !important; }
#${this.containerId} button { all: unset; box-sizing: border-box; display: block; cursor: pointer; padding: 8px 14px; font: 600 14px/1.4 system-ui, sans-serif !important; color: #111111 !important; }
#${this.containerId} :focus { outline: 3px solid #1a5fb4 !important; outline-offset: 2px !important; }
#${this.containerId} [hidden] { display: none !important; }`);

    const nav = document.createElement('nav');
    nav.id = this.containerId;
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Page outline');
    nav.style.cssText = 'position: fixed; bottom: 12px; right: 12px; max-width: min(320px, calc(100vw - 24px)); z-index: 2147483646; background: #fff; color: #111; border: 2px solid #333; border-radius: 8px; font: 14px/1.6 system-ui, sans-serif;';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Page outline';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `${this.containerId}-list`);
    toggle.addEventListener('click', () => this.setOpen(toggle.getAttribute('aria-expanded') !== 'true'));

    const box = document.createElement('div');
    box.id = `${this.containerId}-list`;
    box.hidden = true;
    box.style.cssText = 'max-height: 60vh; overflow: auto; padding: 0 14px 10px;';
    nav.append(toggle, box);
    this.nav = nav; this.toggleBtn = toggle; this.listBox = box;

    const count = this.render();

    // Escape closes the open list and puts focus back on its button.
    this._keyHandler = (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { this.setOpen(false); toggle.focus(); }
    };
    nav.addEventListener('keydown', this._keyHandler);

    // First in <body>, so it is early in the tab order and the reading order;
    // fixed, so it takes no slot in the page's own layout (see skip-links.js).
    try {
      const parent = document.body || document.documentElement;
      parent.insertBefore(nav, parent.firstChild);
    } catch { /* nowhere to mount; enable stays a harmless no-op */ }

    console.log(`[AI4A11y] Page Outline enabled (${count} headings)`);
    announce(count
      ? `Page outline ready: ${count} heading${count === 1 ? '' : 's'}`
      : 'Page outline: no headings found');
  },

  // The page's headings, in document order: real ones, plus ones that are only
  // styled as headings. Hidden ones (a carousel's other slides) are left out —
  // their link would jump to nothing.
  findHeadings() {
    let found = [];
    try {
      found = [...document.querySelectorAll(`${this.selector}, ${STYLED_HEADINGS}`)];
    } catch { /* keep the empty list; the nav below says so */ }
    return found.filter((h) => !(this.nav && this.nav.contains(h))
      && levelOf(h) <= this.maxLevel
      && h.textContent.trim()
      && !h.closest('[hidden], [aria-hidden="true"]')
      && (typeof h.checkVisibility !== 'function' || h.checkVisibility()));
  },

  // (Re)build the list from the page as it is now, so headings the page adds
  // after load show up the next time the outline is opened.
  render() {
    const headings = this.findHeadings();
    const box = this.listBox;
    box.replaceChildren();
    if (headings.length === 0) {
      const note = document.createElement('p');
      note.textContent = 'No headings on this page';
      note.style.margin = '0';
      box.appendChild(note);
    } else {
      const list = document.createElement('ul');
      list.style.cssText = 'list-style: none; margin: 0; padding: 0;';
      let n = 0;
      for (const heading of headings) {
        // Never touch an existing id — only generate (and track) missing ones.
        if (!heading.id) {
          let id;
          do { id = `ai4a11y-outline-h-${n++}`; } while (document.getElementById(id));
          heading.id = id;
          this.addedIds.add(heading);
        }
        const item = document.createElement('li');
        const level = levelOf(heading);
        item.style.paddingLeft = `${(level - 1) * 16}px`;
        const link = document.createElement('a');
        link.href = `#${heading.id}`;
        link.textContent = heading.textContent.replace(/\s+/g, ' ').trim();
        // Our own scroll and focus, not the browser's jump to #id: that lands
        // the heading under a sticky header and changes the page address.
        link.addEventListener('click', (e) => { e.preventDefault(); this.setOpen(false); this.jumpTo(heading); });
        item.appendChild(link);
        list.appendChild(item);
      }
      box.appendChild(list);
    }
    this.toggleBtn.textContent = headings.length ? `Page outline (${headings.length})` : 'Page outline';
    return headings.length;
  },

  setOpen(open) {
    if (!this.toggleBtn) return;
    if (open) this.render();
    this.toggleBtn.setAttribute('aria-expanded', String(open));
    this.listBox.hidden = !open;
  },

  // Move both the viewport and keyboard/screen-reader focus to the heading.
  // Headings aren't focusable by default, so add tabindex="-1" — tracked so
  // disable() removes it again.
  jumpTo(heading) {
    try {
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1');
        this.addedTabindex?.add(heading);
      }
      if (typeof heading.scrollIntoView === 'function') heading.scrollIntoView({ block: 'center' });
      heading.focus({ preventScroll: true });
    } catch { /* heading may be gone; the anchor href still does its best */ }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.getElementById(this.containerId)?.remove();
    this.nav = this.toggleBtn = this.listBox = null;
    this._keyHandler = null;
    try { this.style?.remove(); } catch { /* detached */ }
    try { document.getElementById(`${this.containerId}-styles`)?.remove(); } catch { /* detached */ }
    this.style = null;
    if (this.addedIds) {
      for (const h of this.addedIds) h.removeAttribute('id');
      this.addedIds.clear();
      this.addedIds = null;
    }
    if (this.addedTabindex) {
      for (const h of this.addedTabindex) h.removeAttribute('tabindex');
      this.addedTabindex.clear();
      this.addedTabindex = null;
    }
    console.log('[AI4A11y] Page Outline disabled');
    announce('Page outline removed');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yPageOutline = PageOutline;
