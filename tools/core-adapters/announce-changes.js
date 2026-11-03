// announce-changes.js — Announces dynamic page updates, status messages, and SPA route changes to screen reader users.
// Barrier: Screen reader users cannot see visual updates that appear dynamically (status messages,
// error banners, replaced regions, client-side route changes) when the page fails to use ARIA live regions.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   debounceMs: Window in milliseconds to batch rapid DOM updates (default 200).
//   actionMs: Duration in milliseconds after user action (click, non-typing key, submit) to associate changes with that action (default 3000).
//   pageSpokeMs: Grace period in milliseconds after native live region speaks before announcing pending changes (default 2000).
//   maxChars: Maximum length of spoken summary (default 150).
//
// Decisions:
//   • Speaks through the shared live region (s.announce), never creating a conflicting live region of its own.
//   • Filters out the toolkit's own UI using s.page.isOurs (never matching partial class/id names).
//   • Ignores iframes and elements outside the viewport to prevent noisy background announcements.
//   • Differentiates user actions from typing: typing inside text fields (including Space and Enter) is not an action.
//   • Identifies tickers (containers repeatedly updating without user interaction) and suppresses them.
//   • Never announces text changing inside existing content on its own (such as clocks or timestamps).
//   • On SPA navigation (s.watch.route), announces the new view's heading or document title once, suppressing child content mutations.
//   • If the page's native live region speaks, pending messages are delayed and spoken after it, never dropped.
//   • Cleans up all watchers, listeners, and timers cleanly on disable() via s.end().
//
// What it cannot do:
//   • Cannot interpret graphical or visual-only status changes that do not alter the DOM.
//   • Does not fix keyboard focus or trap issues resulting from SPA route transitions.

const MESSAGE_HINT = /\b(status|alert|error|notice|message|toast|snackbar|warning|notification|banner)\b/i;
const LIVE_SELECTOR = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"], [role="marquee"], [role="timer"], output';
const INTERACTIVE = 'a[href], button, [role="button"], [role="link"], input, select, textarea';

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const root = document.body || document.documentElement;
    if (!root) {
      this.disable();
      return false;
    }

    const s = (this.s = this.toolkit.session());

    const debounceMs = Math.max(50, this.options.debounceMs ?? 200);
    const actionMs = Math.max(500, this.options.actionMs ?? 3000);
    const pageSpokeMs = Math.max(500, this.options.pageSpokeMs ?? 2000);
    const maxChars = this.options.maxChars ?? 150;

    let lastAction = 0;
    let pageSpokeAt = 0;
    let routingUntil = 0;
    let debounceCancel = null;
    let pendingList = [];

    const tickers = new WeakSet();
    const containerUpdates = new WeakMap();

    const isTextField = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const nonTextTypes = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'range', 'color']);
        return !nonTextTypes.has(type);
      }
      return false;
    };

    s.listen(document, 'click', (e) => {
      if (!isTextField(e.target)) {
        lastAction = Date.now();
      }
    }, true);

    s.listen(document, 'submit', () => {
      lastAction = Date.now();
    }, true);

    s.listen(document, 'keydown', (e) => {
      if (!isTextField(e.target)) {
        lastAction = Date.now();
      }
    }, true);

    const isLiveRegion = (el) => {
      if (!el || el.nodeType !== 1) return false;
      return Boolean(el.closest && el.closest(LIVE_SELECTOR));
    };

    const isSilenced = (el) => {
      if (!el || el.nodeType !== 1) return false;
      return Boolean(el.closest && el.closest('[aria-live="off"]'));
    };

    const isOurUI = (el) => {
      return Boolean(s.page.isOurs(el));
    };

    const isIframe = (el) => {
      if (!el || el.nodeType !== 1) return false;
      return el.tagName === 'IFRAME' || Boolean(el.closest && el.closest('iframe'));
    };

    const hasLayout = () => Boolean(document.documentElement && document.documentElement.clientWidth > 0);

    const inViewport = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (!hasLayout()) return true;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const win = el.ownerDocument.defaultView || window;
      const vh = win.innerHeight || el.ownerDocument.documentElement.clientHeight || 0;
      const vw = win.innerWidth || el.ownerDocument.documentElement.clientWidth || 0;
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    };

    const isMessageElement = (el) => {
      for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
        const id = e.id || '';
        const cls = typeof e.className === 'string' ? e.className : '';
        const role = e.getAttribute ? (e.getAttribute('role') || '') : '';
        const name = e.getAttribute ? (e.getAttribute('name') || '') : '';
        const label = e.getAttribute ? (e.getAttribute('aria-label') || '') : '';
        const combined = `${id} ${cls} ${role} ${name} ${label}`;
        if (MESSAGE_HINT.test(combined)) return true;
      }
      return false;
    };

    const checkTicker = (el) => {
      const container = el.parentElement || el;
      if (tickers.has(container) || tickers.has(el)) return true;

      const now = Date.now();
      const last = containerUpdates.get(container);
      const counts = containerUpdates.get(el) || 0;

      if (last) {
        const delta = now - last;
        // If updates happen across distinct timer ticks (e.g. 100ms - 2500ms apart) without user action
        if (delta > 80 && delta < 2500) {
          if (lastAction <= last) {
            const nextCount = counts + 1;
            containerUpdates.set(el, nextCount);
            if (nextCount >= 2) {
              tickers.add(container);
              tickers.add(el);
              return true;
            }
          } else {
            containerUpdates.set(el, 0);
          }
        }
      }
      containerUpdates.set(container, now);
      return false;
    };

    const summarize = (el) => {
      if (!el || el.nodeType !== 1 || !el.isConnected) return '';
      const tag = el.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME)$/.test(tag)) return '';
      if (el.closest('[hidden], [aria-hidden="true"]')) return '';
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return '';

      const focused = document.activeElement;
      if (focused && focused !== document.body && el.contains(focused)) return '';

      const getLines = (node) => {
        const raw = typeof node.innerText === 'string' ? node.innerText : node.textContent;
        return (raw || '').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
      };

      const all = getLines(el);
      const controls = new Set();
      if (!el.matches(INTERACTIVE)) {
        el.querySelectorAll(INTERACTIVE).forEach((c) => getLines(c).forEach((l) => controls.add(l)));
      }
      let kept = all.filter((l) => !controls.has(l));
      if (!kept.length) kept = all;

      let text = '';
      for (const part of kept.slice(0, 3)) {
        const next = !text ? part : text + (/[.!?:;,…]$/.test(text) ? ' ' : '. ') + part;
        if (text && next.length > maxChars) break;
        text = next;
      }

      if (text.length < 3) return '';
      if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…';
      return text;
    };

    const flushPending = () => {
      debounceCancel = null;
      if (!s.alive() || !pendingList.length) return;

      const timeSincePageSpoke = Date.now() - pageSpokeAt;
      if (timeSincePageSpoke < pageSpokeMs) {
        const waitMs = pageSpokeMs - timeSincePageSpoke + 50;
        debounceCancel = s.timer(flushPending, waitMs);
        return;
      }

      let messageToAnnounce = '';
      if (pendingList.length > 3) {
        messageToAnnounce = pendingList[pendingList.length - 1];
      } else {
        messageToAnnounce = pendingList.join('. ').slice(0, maxChars);
      }
      pendingList = [];

      if (messageToAnnounce) {
        s.announce(messageToAnnounce);
      }
    };

    s.watch.route(() => {
      routingUntil = Date.now() + 250;

      s.timer(() => {
        if (!s.alive()) return;
        const headings = s.page.headings();
        let headingText = '';

        if (headings && headings.length) {
          const h1 = headings.find((h) => h.level === 1 && s.page.isVisible(h.el));
          if (h1 && h1.text) {
            headingText = h1.text;
          } else {
            const main = s.page.main();
            const inMain = headings.find((h) => main && main.contains(h.el) && s.page.isVisible(h.el));
            if (inMain && inMain.text) {
              headingText = inMain.text;
            } else {
              const firstVis = headings.find((h) => s.page.isVisible(h.el));
              if (firstVis && firstVis.text) headingText = firstVis.text;
            }
          }
        }

        if (!headingText) {
          const docTitle = document.title ? document.title.split(/[-|•–—]/)[0].trim() : '';
          headingText = docTitle;
        }

        if (headingText) {
          s.announce(headingText);
        }
      }, 150);
    });

    s.watch.added(
      root,
      (elements) => {
        if (!s.alive()) return;
        const now = Date.now();
        const isAnswering = (now - lastAction) < actionMs;

        for (const el of elements) {
          if (!el || el.nodeType !== 1 || !el.isConnected) continue;

          if (isOurUI(el)) continue;
          if (isIframe(el)) continue;

          if (isLiveRegion(el)) {
            pageSpokeAt = Date.now();
            continue;
          }

          if (isSilenced(el)) continue;
          if (now < routingUntil) continue;
          if (checkTicker(el)) continue;

          if (!inViewport(el) || !s.page.isVisible(el)) continue;

          const isMsg = isMessageElement(el);
          if (!isMsg && !isAnswering) continue;

          if (elements.some((other) => other !== el && other.contains(el))) continue;

          const text = summarize(el);
          if (!text) continue;

          if (!pendingList.includes(text)) {
            pendingList.push(text);
          }
        }

        if (pendingList.length) {
          if (debounceCancel) {
            debounceCancel();
            debounceCancel = null;
          }
          debounceCancel = s.timer(flushPending, debounceMs);
        }
      },
      { batch: true }
    );
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
