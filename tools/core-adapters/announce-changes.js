// announce-changes.js — Tells screen reader users about dynamic page changes.
// Barrier: Screen reader users miss dynamic page changes when pages fail to use
// aria-live, role="status", or role="alert". Status messages, toasts, view changes,
// and results appearing in answer to an action are visually apparent but silent to AT.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   debounceMs: Delay in ms to debounce and batch announcements (defaults to 200).
//
// Decisions:
//   • Speaks through s.announce, using the toolkit's shared live region.
//   • Never announces the adapter's own or the toolkit's UI (checked with s.page.isOurs).
//   • Never announces changes inside an existing aria-live region (including <output>) twice.
//   • A newly inserted element that is itself role="status" or "alert" is announced;
//     one added inside an existing live region is not.
//   • If the page's own live region just spoke, pending announcements are delayed until
//     it finishes speaking, never dropped.
//   • Detects tickers (containers updating repeatedly on their own without user actions)
//     by tracking update counts per container; cancels pending timers and suppresses them.
//   • Distinguishes typing from actions: typing in text fields (Space and Enter included)
//     is typing, not an action; click, non-field keydown, and submit count as actions.
//   • Announce only what reads as a message (role, class, id, or name says status, alert,
//     error, notice, message, toast) or content appearing within ACTION_MS of a user action.
//   • Route changes announce the new view's heading or title, not its full content,
//     and cancel any pending route announcement when a new route arrives.
//   • Does not watch characterData: text changing inside existing content on its own is never announced.
//   • Ignores content outside the viewport and inside iframes.
//
// What it cannot do:
//   • Cannot observe or announce updates inside cross-origin iframes.
//   • Cannot detect status conveyed purely through CSS styling, canvas, or video without DOM changes.

const ACTION_MS = 3000;
const PAGE_SPOKE_MS = 2000;
const TICK_WINDOW_MS = 1200;
const MAX_ANNOUNCE_CHARS = 120;
const MAX_LINES = 3;

const LIVE_SELECTOR = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"], [role="timer"], [role="marquee"], output';
const INTERACTIVE = 'a[href], button, [role="button"], [role="link"], input, select, textarea';
const MESSAGE_REGEX = /\b(status|alert|error|notice|message|toast|warn(?:ing)?|snackbar|notification)\b/i;
const CANDIDATE_SELECTOR = '[role="status"], [role="alert"], [class*="status" i], [class*="alert" i], [class*="error" i], [class*="notice" i], [class*="message" i], [class*="toast" i], [class*="warn" i], [class*="notification" i], [id*="status" i], [id*="alert" i], [id*="error" i], [id*="notice" i], [id*="message" i], [id*="toast" i]';

function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true;
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'];
    return !nonText.includes(type);
  }
  return false;
}

function inViewport(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  if (rect.width === 0 && rect.height === 0) {
    if (el.firstElementChild) {
      const cr = el.firstElementChild.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) {
        return cr.bottom > 0 && cr.right > 0 && cr.top < vh && cr.left < vw;
      }
    }
    return false;
  }
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}

function isMessageElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const role = (el.getAttribute('role') || '').toLowerCase().trim();
  if (role === 'status' || role === 'alert') return true;
  const cls = el.getAttribute('class');
  if (cls && MESSAGE_REGEX.test(cls)) return true;
  const id = el.id;
  if (id && MESSAGE_REGEX.test(id)) return true;
  const name = el.getAttribute('name');
  if (name && MESSAGE_REGEX.test(name)) return true;
  return false;
}

function findMessage(el) {
  if (isMessageElement(el)) return el;
  if (typeof el.querySelector === 'function') {
    const candidates = el.querySelectorAll(CANDIDATE_SELECTOR);
    for (const c of candidates) {
      if (isMessageElement(c)) return c;
    }
  }
  return null;
}

function summarize(el, s) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return '';
  if (s?.page?.isOurs && s.page.isOurs(el)) return '';
  const tag = el.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'IFRAME') return '';
  if (el.closest('[hidden], [aria-hidden="true"], iframe')) return '';
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return '';

  const focused = document.activeElement;
  if (focused && focused !== document.body && el.contains(focused)) return '';

  const lines = (node) => {
    const raw = typeof node.innerText === 'string' ? node.innerText : node.textContent;
    return (raw || '').split(/\n+/).map((str) => str.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };

  const all = lines(el);
  const controls = new Set();
  if (!el.matches(INTERACTIVE)) {
    el.querySelectorAll(INTERACTIVE).forEach((c) => lines(c).forEach((l) => controls.add(l)));
  }
  let kept = all.filter((l) => !controls.has(l));
  if (!kept.length) kept = all;

  let text = '';
  for (const part of kept.slice(0, MAX_LINES)) {
    const next = !text ? part : text + (/[.!?:;,…]$/.test(text) ? ' ' : '. ') + part;
    if (text && next.length > MAX_ANNOUNCE_CHARS) break;
    text = next;
  }

  if (text.length < 3 && !(tag === 'OUTPUT' && text)) return '';
  if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
  return text;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    this.debounceMs = this.options.debounceMs ?? 200;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.debounceTimer = null;
    this.routeTimer = null;
    this.pendingText = null;
    this.pendingContainer = null;
    this.pendingPoliteness = 'polite';
    this.containerInfo = new WeakMap();
    this.tickers = new WeakSet();

    // Listen for actions: click, keydown (not in text fields), submit
    s.listen(document, 'submit', () => {
      this.lastAction = Date.now();
    }, true);

    s.listen(document, 'click', (e) => {
      if (!isTextField(e.target)) {
        this.lastAction = Date.now();
      }
    }, true);

    s.listen(document, 'keydown', (e) => {
      if (!isTextField(e.target)) {
        this.lastAction = Date.now();
      }
    }, true);

    // Watch route changes
    s.watch.route(() => {
      if (this.routeTimer) {
        this.routeTimer();
        this.routeTimer = null;
      }
      this.lastAction = 0;

      this.routeTimer = s.timer(() => {
        this.routeTimer = null;
        if (!this.s || this.s.ended) return;

        const h1 = document.querySelector('h1, [role="heading"][aria-level="1"], [role="heading"]');
        const headingText = h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const titleText = (document.title || '').replace(/\s+/g, ' ').trim();
        const text = headingText || titleText;
        if (text) {
          this.s.announce(text, { politeness: 'polite' });
        }
      }, 100);
    });

    // Watch DOM additions
    s.watch.added(null, (els) => {
      if (!this.s || this.s.ended) return;
      this.onAdded(els);
    }, { batch: true, debounceMs: 50 });
  },

  onAdded(elements) {
    const list = Array.isArray(elements) ? elements : [elements];
    const answering = Date.now() - this.lastAction < ACTION_MS;

    // Track affected containers in this batch to detect tickers
    const touchedContainers = new Set();
    for (const el of list) {
      if (el?.parentElement) touchedContainers.add(el.parentElement);
    }

    const now = Date.now();
    for (const container of touchedContainers) {
      if (this.tickers.has(container)) continue;
      let cInfo = this.containerInfo.get(container);
      if (!cInfo) {
        cInfo = { count: 0, lastActionAt: this.lastAction, lastUpdateAt: 0, cancelTimer: null };
        this.containerInfo.set(container, cInfo);
      }

      const hadAction = this.lastAction > cInfo.lastActionAt;
      const withinTickerWindow = now - cInfo.lastUpdateAt < TICK_WINDOW_MS;

      if (hadAction || !withinTickerWindow) {
        cInfo.count = 1;
        cInfo.lastActionAt = this.lastAction;
      } else {
        cInfo.count++;
      }
      cInfo.lastUpdateAt = now;

      if (cInfo.count > 1) {
        this.tickers.add(container);
        if (cInfo.cancelTimer) {
          cInfo.cancelTimer();
          cInfo.cancelTimer = null;
        }
        if (this.pendingContainer === container) {
          this.pendingText = null;
          this.pendingContainer = null;
          if (this.debounceTimer) {
            this.debounceTimer();
            this.debounceTimer = null;
          }
        }
      }
    }

    for (const el of list) {
      if (!el || el.nodeType !== 1 || !el.isConnected) continue;
      if (this.s.page?.isOurs && this.s.page.isOurs(el)) continue;
      if (el.tagName === 'IFRAME' || el.closest('iframe')) continue;

      // Existing live region check:
      // Content added inside an existing live region is announced by the browser.
      // Record pageSpokeAt and skip announcing it.
      const liveParent = el.parentElement && el.parentElement.closest(LIVE_SELECTOR);
      if (liveParent) {
        this.pageSpokeAt = Date.now();
        continue;
      }

      const container = el.parentElement;
      if (container && this.tickers.has(container)) continue;
      if (!inViewport(el)) continue;

      const msgEl = findMessage(el);
      if (!msgEl && !answering) continue;

      // Skip redrawn lists/grids if multiple elements added without explicit message markers
      if (!msgEl && list.length >= 3) continue;

      const targetEl = msgEl || el;
      const text = summarize(targetEl, this.s);
      if (!text) continue;

      const isAlert = targetEl.getAttribute?.('role')?.toLowerCase() === 'alert';
      this.scheduleAnnouncement(text, container, isAlert ? 'assertive' : 'polite');
    }
  },

  scheduleAnnouncement(text, container, politeness = 'polite') {
    this.pendingText = text;
    this.pendingContainer = container;
    this.pendingPoliteness = politeness;

    if (this.debounceTimer) {
      this.debounceTimer();
      this.debounceTimer = null;
    }

    this.debounceTimer = this.s.timer(() => {
      this.debounceTimer = null;
      this.flushAnnouncement();
    }, this.debounceMs);
  },

  flushAnnouncement() {
    if (!this.s || this.s.ended || !this.pendingText) return;

    const elapsed = Date.now() - this.pageSpokeAt;
    if (elapsed < PAGE_SPOKE_MS) {
      const waitMs = PAGE_SPOKE_MS - elapsed + 50;
      this.debounceTimer = this.s.timer(() => {
        this.debounceTimer = null;
        this.flushAnnouncement();
      }, waitMs);
      return;
    }

    const text = this.pendingText;
    const politeness = this.pendingPoliteness || 'polite';
    this.pendingText = null;
    this.pendingContainer = null;
    this.s.announce(text, { politeness });
  },

  disable() {
    if (!this.s) return;
    if (this.debounceTimer) {
      this.debounceTimer();
      this.debounceTimer = null;
    }
    if (this.routeTimer) {
      this.routeTimer();
      this.routeTimer = null;
    }
    this.pendingText = null;
    this.pendingContainer = null;
    this.containerInfo = new WeakMap();
    this.tickers = new WeakSet();
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.s.end();
    this.s = null;
  },
};
