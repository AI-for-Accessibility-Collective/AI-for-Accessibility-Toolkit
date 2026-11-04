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
//     error, notice, message, toast, warn, notification, snackbar) or content appearing within ACTION_MS of a user action.
//     A class, id or name is read as words (errorMessage, form-errors, FormError2), never as a substring.
//   • Route changes announce the new view's heading, not its content, and cancel any pending
//     route announcement when a new route arrives. The view's heading is found from what changed:
//     it remembers the headings shown at enable() and after each route, and takes one that was
//     not shown then or whose text changed (in main first, then the highest level, then the first).
//     A heading mounted again with text already shown counts only when nothing else changed and
//     the title did not either. Otherwise it says the title. Headings drawn while no route change
//     is pending count as shown. It never decides from container names.
//   • Does not watch characterData: text changing inside existing content on its own is never announced.
//   • Ignores content outside the viewport and inside iframes.
//
// What it cannot do:
//   • Cannot observe or announce updates inside cross-origin iframes.
//   • Cannot detect status conveyed purely through CSS styling, canvas, or video without DOM changes.
//   • A view that draws its heading more than 100 ms after the address changes (after a fetch),
//     or more than about 50 ms before it, is announced by its title. A heading whose text the
//     page changes in place between two routes counts as changed at the next route.

const ACTION_MS = 3000;
const PAGE_SPOKE_MS = 2000;
const TICK_WINDOW_MS = 1200;
const MAX_ANNOUNCE_CHARS = 120;
const MAX_LINES = 3;

const LIVE_SELECTOR = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"], [role="timer"], [role="marquee"], output';
const INTERACTIVE = 'a[href], button, [role="button"], [role="link"], input, select, textarea';
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading" i]';
// One word of a class, id or name that says message (singular or plural).
const MESSAGE_WORD = /^(?:status(?:es)?|alerts?|errors?|notices?|messages?|toasts?|warn(?:ing)?s?|snackbars?|notifications?)$/;
const CANDIDATE_SELECTOR = 'output, [role="status"], [role="alert"], [class*="status" i], [class*="alert" i], [class*="error" i], [class*="notice" i], [class*="message" i], [class*="toast" i], [class*="warn" i], [class*="notification" i], [class*="snackbar" i], [id*="status" i], [id*="alert" i], [id*="error" i], [id*="notice" i], [id*="message" i], [id*="toast" i], [id*="warn" i], [id*="notification" i], [id*="snackbar" i], [name*="status" i], [name*="alert" i], [name*="error" i], [name*="notice" i], [name*="message" i], [name*="toast" i], [name*="warn" i], [name*="notification" i], [name*="snackbar" i]';

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
    const style = window.getComputedStyle?.(el);
    const displayVal = el.style?.display || style?.getPropertyValue?.('display') || style?.display;
    if (displayVal === 'contents') {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rr = range.getBoundingClientRect();
        if (rr.width > 0 || rr.height > 0) {
          return rr.bottom > 0 && rr.right > 0 && rr.top < vh && rr.left < vw;
        }
      } catch {}
      if (el.parentElement) {
        return inViewport(el.parentElement);
      }
    }
    return false;
  }
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}

// Whether a class, id or name has a message word in it, read as the words it
// is written in: split at anything but letters and digits, at a lower-case
// letter or digit before a capital (errorMessage, FormError), between
// letters and digits (error2), so kebab, snake, camel and Pascal case and
// plurals are one rule. A longer word that starts like one (noticeboard) is not.
function saysMessage(str) {
  if (!str) return false;
  const words = String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])|([0-9])([a-zA-Z])/g, '$1$3 $2$4')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((w) => MESSAGE_WORD.test(w));
}

function isMessageElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'output') return true;
  const role = (el.getAttribute('role') || '').toLowerCase().trim();
  if (role === 'status' || role === 'alert') return true;
  return saysMessage(el.getAttribute('class')) || saysMessage(el.id) || saysMessage(el.getAttribute('name'));
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
  const displayVal = el.style?.display || window.getComputedStyle?.(el)?.getPropertyValue('display') || window.getComputedStyle?.(el)?.display;
  const isContents = displayVal === 'contents';
  if (!isContents && typeof el.checkVisibility === 'function' && !el.checkVisibility()) return '';

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

  if (!text) return '';
  if (text.length < 3 && !isMessageElement(el)) return '';
  if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
  return text;
}

// The headings the person can read now, as the page marks them up (the
// page block's headings(): visible, not the toolkit's): element → { text, level }.
function shownHeadings(s) {
  const out = new Map();
  for (const h of s.page.headings()) {
    const text = (h.text || '').replace(/\s+/g, ' ').trim();
    if (text) out.set(h.el, { text, level: h.level });
  }
  return out;
}

// Headings drawn while no route change is pending belong to the view the
// person is already on (an app that draws itself after enable(), more of a
// feed): note the shown ones as seen, so the next route does not take them
// for its view's heading.
function noteHeadings(s, seen, el) {
  // A long feed with no route change: forget the headings it took away.
  if (seen.size > 1000) for (const h of seen.keys()) if (!h.isConnected) seen.delete(h);
  const list = el.matches(HEADINGS) ? [el] : [];
  list.push(...el.querySelectorAll(HEADINGS));
  for (const h of list) {
    if (!s.page.isVisible(h) || h.closest('[aria-hidden="true"]')) continue;
    const text = (s.page.nameOf(h) || '').replace(/\s+/g, ' ').trim();
    if (text) seen.set(h, { text, level: 0 });
  }
}

// What a route change says. The new view's heading is found from what
// changed since the last route (or enable()), not from what containers are
// called: a heading that was not shown then (added, or no longer hidden) or
// whose text changed. One whose text was already shown (a header mounted
// again) counts only when nothing else changed and the title did not
// either. Among them: those in the main landmark if any is, then the
// highest level, then the first in the page. Otherwise the title.
function routeAnnouncement(s, seen, lastTitle) {
  const now = shownHeadings(s);
  const seenTexts = new Set([...seen.values()].map((h) => h.text));
  const changed = [...now].filter(([el, h]) => seen.get(el)?.text !== h.text);
  const fresh = changed.filter(([, h]) => !seenTexts.has(h.text));
  const main = [...document.querySelectorAll('main, [role="main" i]')].find((el) => s.page.isVisible(el) && !s.page.isOurs(el));
  const pick = (list) => {
    const inMain = main ? list.filter(([el]) => main.contains(el)) : [];
    let best = null;
    for (const entry of inMain.length ? inMain : list) if (!best || entry[1].level < best[1].level) best = entry;
    return best ? best[1].text : '';
  };
  const title = (document.title || '').replace(/\s+/g, ' ').trim();
  const text = pick(fresh) || (title !== lastTitle ? title : '') || pick(changed) || title;
  return { text, headings: now, title };
}

function joinTexts(items) {
  const unique = [];
  for (const item of items) {
    if (!unique.includes(item.text)) unique.push(item.text);
  }
  let combined = '';
  for (const part of unique) {
    const next = !combined ? part : combined + (/[.!?:;,…]$/.test(combined) ? ' ' : '. ') + part;
    if (combined && next.length > MAX_ANNOUNCE_CHARS) break;
    combined = next;
  }
  if (!combined && unique.length) combined = unique[0];
  if (combined.length > MAX_ANNOUNCE_CHARS) {
    combined = combined.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
  }
  return combined;
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
    this.pendingItems = [];
    this.containerInfo = new WeakMap();
    this.tickers = new WeakSet();
    // What the page shows now: the next route's view heading is what changes.
    this.seenHeadings = shownHeadings(s);
    this.lastTitle = (document.title || '').replace(/\s+/g, ' ').trim();

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

        const res = routeAnnouncement(this.s, this.seenHeadings, this.lastTitle);
        this.seenHeadings = res.headings;
        this.lastTitle = res.title;
        if (res.text) {
          this.s.announce(res.text, { politeness: 'polite' });
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
    const now = Date.now();
    const answering = now - this.lastAction < ACTION_MS;

    if (!this.routeTimer && this.seenHeadings) {
      for (const el of list) if (el?.nodeType === 1 && el.isConnected) noteHeadings(this.s, this.seenHeadings, el);
    }

    // Track affected containers in this batch to detect tickers
    const touchedContainers = new Set();
    for (const el of list) {
      if (el?.parentElement) touchedContainers.add(el.parentElement);
    }

    for (const container of touchedContainers) {
      let cInfo = this.containerInfo.get(container);
      if (!cInfo) {
        cInfo = { count: 0, lastActionAt: this.lastAction, lastUpdateAt: 0 };
        this.containerInfo.set(container, cInfo);
      }

      const hadAction = this.lastAction > cInfo.lastActionAt;
      if (hadAction) {
        this.tickers.delete(container);
      }
      if (this.tickers.has(container)) continue;

      const withinTickerWindow = now - cInfo.lastUpdateAt < TICK_WINDOW_MS;
      if (hadAction || !withinTickerWindow) {
        cInfo.count = 1;
        cInfo.lastActionAt = this.lastAction;
      } else {
        cInfo.count++;
      }
      cInfo.lastUpdateAt = now;

      // Require >= 3 rapid updates without user actions to classify as ticker
      if (!answering && cInfo.count >= 3) {
        this.tickers.add(container);
        this.pendingItems = this.pendingItems.filter((item) => item.container !== container);
        if (!this.pendingItems.length && this.debounceTimer) {
          this.debounceTimer();
          this.debounceTimer = null;
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

      const msgEl = findMessage(el);
      if (!msgEl && !answering) continue;

      // Skip redrawn lists/grids if multiple elements added without explicit message markers
      if (!msgEl && list.length >= 3) continue;

      const targetEl = msgEl || el;
      if (!inViewport(targetEl)) continue;

      const text = summarize(targetEl, this.s);
      if (!text) continue;

      const isAlert = targetEl.getAttribute?.('role')?.toLowerCase() === 'alert';
      this.scheduleAnnouncement(text, container, isAlert ? 'assertive' : 'polite', targetEl);
    }
  },

  scheduleAnnouncement(text, container, politeness = 'polite', el = null) {
    if (!this.pendingItems.some((item) => item.text === text && item.container === container)) {
      this.pendingItems.push({ text, container, politeness, el });
    }

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
    if (!this.s || this.s.ended || !this.pendingItems.length) return;

    const elapsed = Date.now() - this.pageSpokeAt;
    if (elapsed < PAGE_SPOKE_MS) {
      const waitMs = PAGE_SPOKE_MS - elapsed + 50;
      this.debounceTimer = this.s.timer(() => {
        this.debounceTimer = null;
        this.flushAnnouncement();
      }, waitMs);
      return;
    }

    const items = this.pendingItems;
    this.pendingItems = [];

    const activeItems = items.filter((item) => !item.container || !this.tickers.has(item.container));
    if (!activeItems.length) return;

    const validItems = activeItems.filter((item) => !item.el || item.el.isConnected);
    if (!validItems.length) return;

    const assertiveItems = validItems.filter((i) => i.politeness === 'assertive');
    const politeItems = validItems.filter((i) => i.politeness !== 'assertive');

    if (assertiveItems.length && politeItems.length) {
      const aText = joinTexts(assertiveItems);
      const pText = joinTexts(politeItems);
      if (aText) this.s.announce(aText, { politeness: 'assertive' });
      if (pText) this.s.announce(pText, { politeness: 'polite' });
    } else {
      const isAssertive = assertiveItems.length > 0;
      const text = joinTexts(validItems);
      if (text) this.s.announce(text, { politeness: isAssertive ? 'assertive' : 'polite' });
    }
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
    this.pendingItems = [];
    this.containerInfo = new WeakMap();
    this.tickers = new WeakSet();
    this.seenHeadings = null;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.lastTitle = '';
    this.s.end();
    this.s = null;
  },
};
