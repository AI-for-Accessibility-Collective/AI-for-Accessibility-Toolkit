// Live-Region Announcer — reads out meaningful dynamic page changes so
// screen-reader users hear them. Many SPAs swap in toasts, fresh results, or
// status text without any aria-live region, so nothing is announced and blind
// users never learn the page changed. This adapter watches the page and
// speaks a short summary of what appeared; a page's own alert/status nodes
// are spoken right away, everything else is debounced so a burst of inserts
// reads as one announcement.
//
// It speaks through announce(), the host's one live region, not a region of
// its own: two regions talking at once overlap and repeat each other.
//
// What counts as an update: a change the page makes in answer to the person
// (within ACTION_MS of a click, a key that activates, or a change to a form
// field), or one the page marks as a message (an alert/status node, or an
// error/notice box). Everything else, like content the page or another
// adapter adds while loading, is not news and is left alone.
//
// Reversible by construction: a MutationObserver and a few document
// listeners; disable() clears the pending timers and removes them all.
import { announce } from '../utils/ai.js';

// At most this many lines of a new panel, and only whole lines up to
// MAX_ANNOUNCE_CHARS: "Added to cart / product / subtotal", not the panel's
// buttons and its "Customers also bought" list as well.
const MAX_ANNOUNCE_CHARS = 120;
const MAX_LINES = 3;
// New text written into an element that is already on the page (an error
// message, a "12 results" line) is held this long before it is spoken. If the
// same element changes again within it, it is a ticker (a countdown, a clock)
// and is never spoken: one tick per second would drown out everything else.
const TICK_MS = 1100;
// One change that adds this many elements at once is a list or grid being
// redrawn (search results, suggestions). Reading out its last item is noise;
// the page's own count line, if any, comes through the text path instead.
const LIST_REDRAW = 3;
// How long after the person acts a change still counts as the page answering.
const ACTION_MS = 3000;
// How long after the page's own live region spoke our summary would repeat it.
const PAGE_SPOKE_MS = 2000;
// Changes inside these are already spoken by the screen reader itself, or
// belong to another adapter's or the host's own UI (the toolkit's ai4a11y-*
// elements, the workshop's ws-* panel, notes and live region).
const LIVE = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]';
const OTHER_UI = '[id^="ai4a11y-"], [class*="ai4a11y-"], [id^="ws-"], [class^="ws-"], [class*=" ws-"]';
// An element the page itself names as a message: shown on a timer too.
const MESSAGE_HINT = /\b(error|alert|warning|notice|toast|snackbar|notification|message|status)/i;
const INTERACTIVE = 'a[href], button, [role="button"], [role="link"], input, select, textarea';

export const LiveRegionAnnouncer = {
  enabled: false,
  observer: null,
  debounceMs: 300,
  debounceTimer: null,
  pending: null,
  lastAction: 0,      // when the person last clicked, typed Enter/Space, or changed a field
  pageSpokeAt: 0,     // when one of the page's own live regions last changed
  textTimers: null,   // Map: element -> timer for text written into it (see TICK_MS)
  textChangedAt: null, // Map: element -> when its text last changed
  tickers: null,      // WeakSet of elements found to change on a timer
  _onAction: null,
  _onKey: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.debounceMs = options.debounceMs ?? 300;
    this.pending = null;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.textTimers = new Map();
    this.textChangedAt = new Map();
    this.tickers = new WeakSet();

    this._onAction = () => { this.lastAction = Date.now(); };
    this._onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') this.lastAction = Date.now(); };
    for (const type of ['click', 'change', 'input', 'submit']) document.addEventListener(type, this._onAction, true);
    document.addEventListener('keydown', this._onKey, true);

    // Watch the whole body, not just <main>: toasts and "Added to cart"
    // panels are usually appended to <body>, outside the main landmark, and
    // a main landmark another fix adds later would otherwise narrow the watch.
    // characterData is off — text tweaks inside existing text nodes are too
    // noisy to speak; inserted nodes (and text replaced wholesale) are the signal.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        this.onMutations(mutations);
      });
      const target = document.body || document.documentElement;
      if (target) this.observer.observe(target, { childList: true, subtree: true, characterData: false });
    }

    console.log('[AI4A11y] Live-Region Announcer enabled');
    announce('Announcing page updates');
  },

  onMutations(mutations) {
    const answering = Date.now() - this.lastAction < ACTION_MS;
    for (const m of mutations) {
      const parent = m.target && m.target.nodeType === 1 ? m.target : null;
      // The changed element itself: skip live regions (the screen reader
      // already reads what lands there) and other adapters' UI.
      if (!parent || parent.closest(OTHER_UI)) continue;
      if (parent.closest(LIVE)) { this.pageSpokeAt = Date.now(); continue; }
      const added = [...m.addedNodes];
      // Text put straight into an existing element: a message or a count.
      if (added.some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
        if (answering || this.isMessage(parent)) this.textChanged(parent);
        continue;
      }
      const elements = added.filter((n) => n.nodeType === 1);
      if (elements.length >= LIST_REDRAW) continue;
      for (const node of elements) {
        if (this.ignored(node)) continue;
        // A new role="alert" is read by the screen reader itself.
        if (node.getAttribute('role') === 'alert') { this.pageSpokeAt = Date.now(); continue; }
        if (this.isUrgent(node)) { const text = this.summarize(node); if (text) this.speak(text); }
        else if (answering || this.isMessage(node)) { this.pending = node; this.schedule(); }
      }
    }
  },

  // Other adapters' panels and notes, and anything added inside a live region
  // the screen reader already reads by itself.
  ignored(el) {
    if (!el.closest) return false;
    if (el.closest(OTHER_UI)) return true;
    return !!(el.parentElement && el.parentElement.closest(LIVE));
  },

  // The page calls it an error, alert, notice, toast... (itself or the box it is in).
  isMessage(el) {
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
      if (MESSAGE_HINT.test(`${e.id || ''} ${typeof e.className === 'string' ? e.className : ''}`)) return true;
    }
    return false;
  },

  textChanged(el) {
    if (this.tickers.has(el)) return;
    if (this.textTimers.has(el)) {
      clearTimeout(this.textTimers.get(el));
      this.textTimers.delete(el);
      // Changed again before it was read. With no click or key in between,
      // it changes on its own (a countdown): never read it. With one, it is
      // the person pressing again (+ + +): read the value it settles on.
      if (!(this.lastAction > this.textChangedAt.get(el))) { this.tickers.add(el); return; }
    }
    this.textChangedAt.set(el, Date.now());
    this.textTimers.set(el, setTimeout(() => {
      this.textTimers.delete(el);
      if (!this.enabled) return;
      this.pending = el;
      this.schedule();
    }, TICK_MS));
  },

  // Short spoken summary of an element, or '' if it isn't worth announcing
  // (scripts/styles, hidden or near-empty nodes). Read when it is spoken, not
  // when it changed: an error box is often filled first and shown after.
  // The panel's own links and buttons are left out (they are what to do
  // next, not what happened), and only its first few lines are read.
  summarize(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return '';
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return '';
    if (el.closest('[hidden], [aria-hidden="true"]')) return '';
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return '';
    // The page moved focus into it (a dialog done right): the screen reader
    // is already reading it, and saying it again talks over that.
    const focused = document.activeElement;
    if (focused && focused !== document.body && el.contains(focused)) return '';
    // innerText keeps the breaks between blocks ("Added to cart" / product
    // name), which textContent runs together into "Added to cartRedbird".
    const lines = (el) => {
      const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
      return (raw || '').split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    };
    const all = lines(el);
    const controls = new Set();
    if (!el.matches(INTERACTIVE)) el.querySelectorAll(INTERACTIVE).forEach((c) => lines(c).forEach((l) => controls.add(l)));
    let kept = all.filter((l) => !controls.has(l));
    if (!kept.length) kept = all;
    let text = '';
    for (const part of kept.slice(0, MAX_LINES)) {
      const next = !text ? part : text + (/[.!?:;,…]$/.test(text) ? ' ' : '. ') + part;
      if (text && next.length > MAX_ANNOUNCE_CHARS) break;
      text = next;
    }
    // Two characters is a count or a stray mark ("2", "+"), except in an
    // <output>, which exists to show a result (a quantity).
    if (text.length < 3 && !(tag === 'OUTPUT' && text)) return '';
    if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
    return text;
  },

  // The page already marked this node as an announcement — speak it now.
  isUrgent(el) {
    if (!el.getAttribute) return false;
    const role = el.getAttribute('role');
    return role === 'alert' || role === 'status' || el.hasAttribute('aria-live');
  },

  speak(text) {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.pending = null;
    announce(text);
  },

  schedule() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.enabled || !this.pending) return;
      // The page's own live regions just spoke ("Cart now has 2 items",
      // "22 results"): it is announcing for itself, so don't say it twice.
      if (Date.now() - this.pageSpokeAt < PAGE_SPOKE_MS) { this.pending = null; return; }
      const text = this.summarize(this.pending);
      this.pending = null;
      if (text) announce(text);
    }, this.debounceMs);
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    for (const t of this.textTimers.values()) clearTimeout(t);
    this.textTimers = null;
    this.textChangedAt = null;
    this.tickers = null;
    this.pending = null;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    for (const type of ['click', 'change', 'input', 'submit']) document.removeEventListener(type, this._onAction, true);
    document.removeEventListener('keydown', this._onKey, true);
    this._onAction = this._onKey = null;
    console.log('[AI4A11y] Live-Region Announcer disabled');
    announce('Stopped announcing page updates');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yLiveRegionAnnouncer = LiveRegionAnnouncer;
