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
//   ai: Boolean. Whether to ask the toolkit's model where the page does not say (below). Defaults to true;
//     false never asks.
//
// Decisions:
//   • Speaks through s.announce, using the toolkit's shared live region, which is in the page
//     from enable() (s.announce.ready()), so a screen reader has seen it before the first message.
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
//     A key that only moves focus or scrolls is not: Tab, a modifier alone, and arrows,
//     Page Up/Down, Home, End and Space unless a control (a native one or a widget role) has them.
//   • Announces what the page says is a message (role status or alert, <output>) and content
//     appearing within ACTION_MS of a user action. Nothing else is certain.
//   • Content the page adds by itself, marked only by a word in its class, id or name (status, alert,
//     error, notice, message, toast, warn, notification, snackbar), may be a message or just more
//     content (a text-warning badge in a card, an errorBoundary wrapper, a chat list called messages).
//     The page does not say, so the adapter asks the toolkit's model (s.ai.choose) which it is, from
//     what it contains, and announces it only if the model says a message. It asks once per kind of
//     element (its tag, role, id and class tokens, and those of what it was added to), never per text, so
//     the next toast in the same place is announced at once from that answer; and at most ASK_CAP times
//     a page. The first answer may come a second or two late: it is announced then only if it is still
//     in the page, still in view, no route changed, and it was added less than LATE_MS ago. When the
//     model cannot tell, or there is none, or ai is false, it says nothing.
//     A class, id or name is read as words (errorMessage, form-errors, FormError2), never as a substring:
//     the words only choose what to ask about. A control (link, button, field) is never asked about.
//   • Route changes announce the new view's heading, not its content, and cancel any pending
//     route announcement when a new route arrives. The view's heading is found from what changed:
//     it remembers the headings shown at enable() and after each route, and takes one that was
//     not shown then or whose text changed (in main first, then the highest level, then the first).
//     That pick is a rule, not a question to the model: an answer would come a second or two after the
//     view, and a route is said within 100 ms.
//     A heading mounted again with text already shown counts only when nothing else changed and
//     the title did not either. Otherwise it says the title. Headings drawn, or whose text the page
//     changes in place, while no route change is pending count as shown. It never decides from
//     container names. While a route change is pending, what is added is the view: only an element
//     the page marks as a status (role status or alert, <output>) is announced with it.
//   • Text changing inside existing content is never announced (it is watched only to keep the
//     headings' text current).
//   • Ignores content outside the viewport and inside iframes.
//
// What it cannot do:
//   • Cannot observe or announce updates inside cross-origin iframes.
//   • Cannot detect status conveyed purely through CSS styling, canvas, or video without DOM changes.
//   • A view that draws its heading more than 100 ms after the address changes (after a fetch),
//     or more than about 50 ms before it, is announced by its title.

const ACTION_MS = 3000;
const PAGE_SPOKE_MS = 2000;
const TICK_WINDOW_MS = 1200;
const MAX_ANNOUNCE_CHARS = 120;
const MAX_LINES = 3;
// The most questions to the model a page asks, and how old new content may be when its answer comes.
const ASK_CAP = 6;
const LATE_MS = 5000;

const QUESTION = 'Is this new content a message to the person about what they just did or about the page (an error, a confirmation, a warning), or just more content?';
const KINDS = [
  { value: 'message', about: 'A message to the person: an error, a confirmation that something was saved or sent, a warning, a notice that something changed, finished or failed.' },
  { value: 'content', about: "More of the page's content: an item in a list or feed, a card, a section of the page, a label or badge that is part of what is shown, someone's post or chat message." },
];

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

// A key that only moves focus or scrolls is not an action: Tab, a modifier
// pressed alone (Control stops a screen reader's speech), and the keys that
// scroll (arrows, Page Up and Down, Home, End, Space) unless a control has
// them (a tab list's arrows, a slider's Home). Space and Enter on a native
// button or link are also a click.
const MOVE_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'Fn', 'Insert', 'Tab']);
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const WIDGET = `${INTERACTIVE}, summary, [role="tab" i], [role^="menuitem" i], [role="option" i], [role="checkbox" i], [role="radio" i], [role="switch" i], [role="slider" i], [role="spinbutton" i], [role="treeitem" i], [role="gridcell" i], [role="combobox" i], [role="listbox" i], [role="tree" i], [role="grid" i], [role="treegrid" i], [role="menu" i], [role="menubar" i], [role="tablist" i], [role="radiogroup" i], [role="toolbar" i]`;

function isActionKey(e) {
  if (MOVE_KEYS.has(e.key)) return false;
  if (!SCROLL_KEYS.has(e.key)) return true;
  const t = e.target;
  return !!(t && t.nodeType === 1 && t.closest?.(WIDGET));
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

// What the page itself says is a status message: <output>, role status or alert.
function saysStatus(el) {
  if (el.tagName === 'OUTPUT') return true;
  const role = (el.getAttribute('role') || '').toLowerCase().trim();
  return role === 'status' || role === 'alert';
}

// What may be a message but the page does not say: a word in its class, id or name. Only
// worth a question (or, answering an action, the part to read). A control is not a
// message, whatever its class says (btn-warning, a select named status).
function namedMessage(el) {
  if (!el || el.nodeType !== 1 || el.matches(INTERACTIVE)) return false;
  return saysMessage(el.getAttribute('class')) || saysMessage(el.id) || saysMessage(el.getAttribute('name'));
}

// What an element is, for the model's answer to stand for every one like it: its tag, role,
// id and class tokens, and those of what it was added to. Not its text. Numbers in names are
// one kind (toast-17, toast-18).
function kindOf(el) {
  const what = (n) => [n.localName, (n.getAttribute('role') || '').trim().toLowerCase(), n.id ? `#${n.id}` : '',
    ...String(n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort()].join(' ').replace(/\d+/g, '0');
  return `${what(el)} < ${el.parentElement ? what(el.parentElement) : ''}`;
}

function findMessage(el, is) {
  if (is(el)) return el;
  if (typeof el.querySelector === 'function') {
    const candidates = el.querySelectorAll(CANDIDATE_SELECTOR);
    for (const c of candidates) {
      if (is(c)) return c;
    }
  }
  return null;
}

// message: the page or the model says el is a message; then text under 3 characters ("OK") is read too.
function summarize(el, s, message = false) {
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
  if (text.length < 3 && !message) return '';
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
    // The live regions are in the page from now, before the first message:
    // a screen reader can miss text written to a region it had not seen.
    s.announce.ready();

    this.debounceMs = this.options.debounceMs ?? 200;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.debounceTimer = null;
    this.routeTimer = null;
    this.pendingItems = [];
    this.containerInfo = new WeakMap();
    this.tickers = new WeakSet();
    // The model's answers, by kind of element (kindOf): { answer, ms, waiting }. answer is
    // undefined while it is on its way, then 'message', 'content' or null (cannot tell).
    this.kinds = new Map();
    this.asked = 0;
    this.routes = 0;
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
      if (!isTextField(e.target) && isActionKey(e)) {
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
      this.routes++;

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

    // Heading text the page changes in place while no route change is
    // pending ("Inbox (3 new)") is what the person is already on: noted as
    // shown, so the next route does not take it for its view's heading.
    // Never announced: text changing inside existing content is not a message.
    s.watch.added(null, (els) => {
      if (!this.s || this.s.ended || this.routeTimer || !this.seenHeadings) return;
      for (const el of els) {
        const h = el.closest(HEADINGS);
        if (h) noteHeadings(this.s, this.seenHeadings, h);
      }
    }, { batch: true, debounceMs: 50, types: ['characterData'] });
  },

  onAdded(elements) {
    const list = Array.isArray(elements) ? elements : [elements];
    const now = Date.now();
    const answering = now - this.lastAction < ACTION_MS;
    // While a route change is pending, what is added is the new view, said
    // by its heading: only what the page itself marks as a status or alert
    // (role, <output>) is announced too, never one a class name suggests.
    const routing = !!this.routeTimer;

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

      // What the page marks as a status is one; while a route is pending, nothing else is.
      let targetEl = findMessage(el, saysStatus);
      let message = !!targetEl;
      if (!targetEl) {
        if (routing) continue;
        const named = findMessage(el, namedMessage);
        if (answering) {
          // Skip redrawn lists/grids if multiple elements added without a part named as a message
          if (!named && list.length >= 3) continue;
          targetEl = named || el;
          message = !!named;
        } else {
          // Added by itself, a message only by its name: the model's answer for its kind.
          if (!named || !inViewport(named) || !summarize(named, this.s, true)) continue;
          const kind = this.kindFor(named);
          if (!kind) continue;
          if (kind.answer === undefined) {
            kind.waiting.push({ el: named, container, addedAt: now, route: this.routes });
            continue;
          }
          if (kind.answer !== 'message') continue;
          targetEl = named;
          message = true;
        }
      }

      if (!inViewport(targetEl)) continue;

      const text = summarize(targetEl, this.s, message);
      if (!text) continue;

      const isAlert = targetEl.getAttribute?.('role')?.toLowerCase() === 'alert';
      this.scheduleAnnouncement(text, container, isAlert ? 'assertive' : 'polite', targetEl);
    }
  },

  // The model's answer for an element's kind: asked the first time one is seen (at most ASK_CAP
  // times a page), shared by every one like it after. null when it will not be asked.
  kindFor(el) {
    const key = kindOf(el);
    let kind = this.kinds.get(key);
    if (kind) return kind;
    if (this.options.ai === false || !this.s.ai?.available || this.asked >= ASK_CAP) return null;
    this.asked++;
    const started = Date.now();
    kind = { answer: undefined, ms: null, waiting: [] };
    this.kinds.set(key, kind);
    const s = this.s;
    const context = `It appeared on its own: the person did nothing on the page in the last few seconds.\n\nThe new content:\n${s.ai.outline(el, { maxChars: 900 })}\n\nWhat it was added to:\n${s.ai.outline(el.parentElement || el, { maxChars: 700 })}`;
    Promise.resolve()
      .then(() => s.ai.choose(QUESTION, KINDS, { context }))
      .catch(() => null)
      .then((answer) => {
        kind.answer = answer === 'message' || answer === 'content' ? answer : null;
        kind.ms = Date.now() - started;
        const waiting = kind.waiting;
        kind.waiting = [];
        if (this.s !== s || s.ended || kind.answer !== 'message') return;
        for (const item of waiting) this.announceLate(item);
      });
    return kind;
  },

  // A message whose answer came after it was added: said only if it is still in the page and
  // in view, still new, and no route changed since.
  announceLate({ el, container, addedAt, route }) {
    if (!el.isConnected || Date.now() - addedAt > LATE_MS || route !== this.routes) return;
    if (container && this.tickers.has(container)) return;
    if (!inViewport(el)) return;
    const text = summarize(el, this.s, true);
    if (text) this.scheduleAnnouncement(text, container, 'polite', el);
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
    this.kinds = new Map();
    this.asked = 0;
    this.seenHeadings = null;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.lastTitle = '';
    this.s.end();
    this.s = null;
  },
};
