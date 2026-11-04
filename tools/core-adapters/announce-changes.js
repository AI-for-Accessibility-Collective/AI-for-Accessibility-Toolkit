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
//   • Route changes announce the new view's heading (inspecting main for top-level view headings
//     h1-h6 or role="heading" before falling back to document h1) or title, not its full content,
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
const MESSAGE_REGEX = /(?:^|[^a-zA-Z0-9])(status(?:es)?|alerts?|errors?|notices?|messages?|toasts?|warn(?:ing)?s?|snackbars?|notifications?)(?:$|[^a-zA-Z0-9])/i;
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

function isMessageElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'output') return true;
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

function findRouteAnnouncement(s, state = {}) {
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (s?.page?.isOurs && s.page.isOurs(el)) return false;
    if (el.closest('[hidden], [aria-hidden="true"], iframe')) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    return true;
  };

  const isViewContainer = (el) => Boolean(
    el && el.closest?.('[id*="view" i], [class*="view" i], [id*="route" i], [class*="route" i], [id*="page" i], [class*="page" i], [data-view], [data-route]')
  );

  const clean = (str) => (str || '').replace(/\s+/g, ' ').trim();
  const titleText = clean(document.title);

  let lastMain = '';
  let lastDoc = '';
  let lastTitle = '';
  let knownHeadings = null;
  if (typeof state === 'object' && state !== null) {
    lastMain = state.mainHeading || '';
    lastDoc = state.docHeading || '';
    lastTitle = state.title || '';
    knownHeadings = state.knownHeadings || null;
  } else if (typeof state === 'string') {
    lastMain = state;
    lastDoc = state;
  }

  const currentHeadings = new Set();

  // Filter for visible headings in the main landmark or view container first:
  // inspect main for top-level view headings (h1-h6 or [role="heading"])
  const main = document.querySelector('main, [role="main"]');
  let mainHeading = null;
  if (main) {
    const candidatesH1 = Array.from(main.querySelectorAll('h1, [role="heading"][aria-level="1"]')).filter(isVisible);
    const candidatesOther = Array.from(main.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"]')).filter(isVisible);

    for (const c of candidatesH1) {
      const t = clean(c.textContent);
      if (t) currentHeadings.add(t);
    }
    for (const c of candidatesOther) {
      const t = clean(c.textContent);
      if (t) currentHeadings.add(t);
    }

    const pickHeading = (list) => {
      // 1. Heading inside a view container that differs from lastMain
      for (const c of list) {
        const t = clean(c.textContent);
        if (t && t !== lastMain && isViewContainer(c)) return c;
      }
      // 2. Heading whose text was not in knownHeadings (newly mounted)
      if (knownHeadings && knownHeadings.size > 0) {
        for (const c of list) {
          const t = clean(c.textContent);
          if (t && t !== lastMain && !knownHeadings.has(t)) return c;
        }
      }
      return null;
    };

    mainHeading = pickHeading(candidatesH1);
    if (!mainHeading) {
      mainHeading = pickHeading(candidatesOther);
    }

    // Fallback if no heading differed: keep first visible heading
    if (!mainHeading) {
      mainHeading = candidatesH1[0] || candidatesOther[0] || null;
    }
  }

  // Fallback visible h1 in document
  let docH1 = null;
  const docCandidates = Array.from(document.querySelectorAll('h1, [role="heading"][aria-level="1"]')).filter(isVisible);
  for (const c of docCandidates) {
    const t = clean(c.textContent);
    if (t) currentHeadings.add(t);
  }
  for (const c of docCandidates) {
    const t = clean(c.textContent);
    if (t && t !== lastDoc) { docH1 = c; break; }
  }
  if (!docH1 && docCandidates.length) {
    docH1 = docCandidates[0];
  }

  const mainHeadingText = mainHeading ? clean(mainHeading.textContent) : '';
  const docH1Text = docH1 ? clean(docH1.textContent) : '';

  let text = '';
  if (mainHeadingText && mainHeadingText !== lastMain) {
    text = mainHeadingText;
  } else if (docH1Text && docH1Text !== lastDoc) {
    text = docH1Text;
  } else if (titleText && titleText !== lastTitle) {
    text = titleText;
  } else {
    text = mainHeadingText || docH1Text || titleText;
  }

  return {
    text,
    heading: mainHeadingText || docH1Text,
    mainHeading: mainHeadingText,
    docHeading: docH1Text,
    title: titleText,
    headings: currentHeadings
  };
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
    this.knownHeadings = new Set();

    const initial = findRouteAnnouncement(s, {
      mainHeading: '',
      docHeading: '',
      title: '',
      knownHeadings: new Set()
    });
    this.lastMainHeading = initial.mainHeading || '';
    this.lastDocHeading = initial.docHeading || '';
    this.lastRouteHeading = initial.heading || '';
    this.lastRouteTitle = initial.title || '';
    this.knownHeadings = initial.headings || new Set();

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

        const res = findRouteAnnouncement(this.s, {
          mainHeading: this.lastMainHeading,
          docHeading: this.lastDocHeading,
          title: this.lastRouteTitle,
          knownHeadings: this.knownHeadings
        });
        if (res.mainHeading) this.lastMainHeading = res.mainHeading;
        if (res.docHeading) this.lastDocHeading = res.docHeading;
        if (res.heading) this.lastRouteHeading = res.heading;
        if (res.title) this.lastRouteTitle = res.title;
        if (res.headings) this.knownHeadings = res.headings;
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
    this.knownHeadings = null;
    this.lastAction = 0;
    this.pageSpokeAt = 0;
    this.lastMainHeading = '';
    this.lastDocHeading = '';
    this.lastRouteHeading = '';
    this.lastRouteTitle = '';
    this.s.end();
    this.s = null;
  },
};
