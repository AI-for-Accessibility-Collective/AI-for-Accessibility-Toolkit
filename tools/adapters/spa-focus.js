// SPA Focus — announces client-side route changes and moves keyboard focus
// to the new page's main region. Single-page apps swap content without a real
// page load, so screen readers never announce the new "page" and keyboard
// focus is left stranded on a control that may no longer exist. BLV and
// keyboard users described clicking a nav link and hearing nothing — the app
// had navigated, but to them the page seemed frozen.
//
// Route changes are detected by wrapping history.pushState/replaceState and
// listening for popstate (back/forward). On a change, focus moves to the main
// region (given tabindex="-1" if it needs one) and the new page's name is
// spoken through an assertive live region.
//
// Reversible by construction: the original history methods are stored and
// restored, the popstate listener and live region are removed, and any
// tabindex this adapter added is taken back off on disable().
import { announce } from '../utils/ai.js';

const REGION_ID = 'ai4a11y-spa-focus-region';
// Debounce so a burst of history calls (SPAs often push/replace several times
// per navigation) settles into one announcement — and gives the framework a
// beat to render the new content before we look for its main region.
const SETTLE_DELAY_MS = 150;

export const SpaFocus = {
  regionId: REGION_ID,
  enabled: false,
  region: null,
  lastPath: null,        // pathname+search last handled, so same-path pushes are ignored
  settleTimer: null,     // debounce timeout, cleared on disable
  popstateHandler: null, // stored ref so disable() can removeEventListener
  patchedHistory: null,  // the history object we patched, restored on disable
  origPushState: null,
  origReplaceState: null,
  tabindexAdded: new Set(), // elements we gave tabindex="-1", stripped on disable

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.lastPath = window.location.pathname + window.location.search;

    // Assertive, not polite: a navigation replaces the whole page, so the
    // announcement must not queue behind stale reading. Standard sr-only recipe.
    const region = document.createElement('div');
    region.id = REGION_ID;
    region.setAttribute('aria-live', 'assertive');
    region.setAttribute('aria-atomic', 'true');
    region.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    (document.body || document.documentElement).appendChild(region);
    this.region = region;

    // Wrap pushState/replaceState — the only signal most SPAs give that a
    // navigation happened. Plain functions (not arrows) so `this` stays the
    // history object the app called them on.
    const self = this;
    this.patchedHistory = window.history;
    this.origPushState = window.history.pushState;
    this.origReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
      const result = self.origPushState.apply(this, args);
      self.scheduleCheck();
      return result;
    };
    window.history.replaceState = function (...args) {
      const result = self.origReplaceState.apply(this, args);
      self.scheduleCheck();
      return result;
    };

    // Back/forward navigations fire popstate instead of going through a patch.
    this.popstateHandler = () => {
      if (!this.enabled) return;
      this.scheduleCheck();
    };
    window.addEventListener('popstate', this.popstateHandler);

    console.log('[AI4A11y] SPA Focus enabled');
    announce('Announcing page changes in this app');
  },

  scheduleCheck() {
    if (!this.enabled) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this.enabled) return;
      this.checkRoute();
    }, SETTLE_DELAY_MS);
  },

  checkRoute() {
    // Only a real route change counts — pushing state on the same URL (tab
    // switches, scroll anchors stored in state) must not steal focus.
    const path = window.location.pathname + window.location.search;
    if (path === this.lastPath) return;
    this.lastPath = path;

    // The new page's main region, by decreasing specificity; the h1 fallback
    // covers pages that never marked up a main landmark.
    const target = document.querySelector('main, [role="main"], #main, h1');
    if (target) {
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        this.tabindexAdded.add(target);
      }
      target.focus({ preventScroll: false });
    }
    if (this.region) this.region.textContent = this.pageName(target);
  },

  // What to call the new page: its title if the app updates one, else the
  // main heading's text, else a generic fallback so something is always said.
  pageName(target) {
    const title = (document.title || '').replace(/\s+/g, ' ').trim();
    if (title) return title;
    let heading = null;
    if (target) {
      heading = /^H[1-6]$/.test(target.tagName)
        ? target
        : target.querySelector('h1, h2, [role="heading"]');
    }
    heading = heading || document.querySelector('h1');
    const text = heading ? (heading.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return text || 'New page';
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null; }
    if (this.patchedHistory) {
      this.patchedHistory.pushState = this.origPushState;
      this.patchedHistory.replaceState = this.origReplaceState;
      this.patchedHistory = null;
    }
    this.origPushState = null;
    this.origReplaceState = null;
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }
    for (const el of this.tabindexAdded) el.removeAttribute('tabindex');
    this.tabindexAdded.clear();
    try { (this.region || document.getElementById(REGION_ID))?.remove(); } catch { /* already gone */ }
    this.region = null;
    this.lastPath = null;
    console.log('[AI4A11y] SPA Focus disabled');
    announce('Stopped announcing page changes');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11ySpaFocus = SpaFocus;
