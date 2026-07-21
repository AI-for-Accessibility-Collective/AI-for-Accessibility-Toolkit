// Page Outline — builds an on-page heading navigator (a table of contents /
// skip menu) so users who cannot skim can jump straight to any section. From
// the co-design study: Daniel (screen reader) wanted "signposting, wayfinding"
// on long government pages, and Clive (eye gaze) pays per scroll — listing the
// page's h1–h3 headings as links turns a long scroll into one activation.
//
// Reversible by construction: the outline is a single injected <nav> we can
// remove, and every mutation to the page itself (a generated heading id, a
// tabindex added so focus() can land on the heading) is tracked in a Set so
// disable() restores the page exactly.
import { announce } from '../../utils/ai.js';

export const PageOutline = {
  containerId: 'ai4a11y-page-outline',
  enabled: false,
  addedIds: null,       // Set of headings we gave a generated id (for exact restore)
  addedTabindex: null,  // Set of headings we gave tabindex="-1" (for exact restore)

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.addedIds = new Set();
    this.addedTabindex = new Set();

    const selector = options.selector || 'h1, h2, h3';
    let headings = [];
    try {
      headings = [...document.querySelectorAll(selector)].filter((h) => h.textContent.trim());
    } catch { /* keep the empty list; the nav below says so */ }

    const nav = document.createElement('nav');
    nav.id = this.containerId;
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Page outline');
    nav.style.cssText = 'position: fixed; top: 12px; right: 12px; max-width: 320px; max-height: 70vh; overflow: auto; z-index: 2147483646; background: #fff; color: #111; border: 2px solid #333; border-radius: 8px; padding: 10px 14px; font: 14px/1.6 system-ui, sans-serif;';

    if (headings.length === 0) {
      const note = document.createElement('p');
      note.textContent = 'No headings on this page';
      nav.appendChild(note);
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
        const level = Number(heading.tagName[1]) || 1;
        item.style.paddingLeft = `${(level - 1) * 16}px`;
        const link = document.createElement('a');
        link.href = `#${heading.id}`;
        link.textContent = heading.textContent.trim();
        link.addEventListener('click', () => this.jumpTo(heading));
        item.appendChild(link);
        list.appendChild(item);
      }
      nav.appendChild(list);
    }

    try {
      (document.body || document.documentElement).appendChild(nav);
    } catch { /* nowhere to mount; enable stays a harmless no-op */ }

    console.log(`[AI4A11y] Page Outline enabled (${headings.length} headings)`);
    announce(headings.length
      ? `Page outline ready: ${headings.length} heading${headings.length === 1 ? '' : 's'}`
      : 'Page outline: no headings found');
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
      if (typeof heading.scrollIntoView === 'function') heading.scrollIntoView();
      heading.focus();
    } catch { /* heading may be gone; the anchor href still does its best */ }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.getElementById(this.containerId)?.remove();
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
