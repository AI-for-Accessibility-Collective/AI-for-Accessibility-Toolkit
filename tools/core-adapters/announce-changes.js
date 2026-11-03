// announce-changes.js — Tells screen reader users about changes the page makes
// without saying so: dynamic status/error messages, regions replaced after user
// action, and single-page app route navigations.
//
// Barrier: Single-page applications and modern web apps frequently update content,
// display toast notifications, show validation messages, or navigate between views
// without using ARIA live regions or moving focus. Blind and low-vision screen
// reader users are not told about these changes, leaving them unaware of status
// updates, form errors, or view transitions.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   debounceMs: Milliseconds to gather rapid bursts of DOM additions before speaking (default 100).
//   actionWindowMs: Milliseconds after a person's click, activation key, or submit that changes
//                   count as an answer to their action (default 3000).
//   maxChars: Maximum length of an announcement string before truncation (default 140).
//
// Decisions:
//   • Uses s.announce to speak through the toolkit's single shared live region.
//   • Never announces changes inside existing aria-live regions or nodes with role="status",
//     role="alert", or role="log" (or regions explicitly silenced with aria-live="off").
//   • When the page's own live region speaks, suppresses adapter announcements for 2000ms
//     to prevent repeating or overlapping speech.
//   • Watches single-page route changes via s.watch.route, announcing the new view's top
//     heading or document title after a short settle window.
//   • Distinguishes meaningful messages (matching keywords: status, alert, error, notice,
//     message, toast, snackbar, warning) from background page updates.
//   • Announces non-message content only when it appears within actionWindowMs of a trusted
//     user action (click, Enter/Space keydown, or form submit).
//   • Skips changes caused by typing (keyboard input in text entry controls).
//   • Never announces text changing inside existing content on its own (timers, counters, clocks).
//   • Never announces content outside the viewport or inside iframes.
//   • Skips the toolkit's own UI using s.page.isOurs(el), never class or id checks.
//   • Summarizes added elements by extracting readable text, excluding interactive controls
//     (buttons, links), and truncating to maxChars.
//   • Batches bursts of changes so rapid updates result in at most a few announcements.
//   • Does not announce anything on page load.
//
// What it cannot do:
//   • Cannot infer that an element without semantic naming or recent user action is a message.
//   • Cannot announce content inside cross-origin or sandboxed iframes.

const MESSAGE_WORD = /\b(error|alert|warning|warn|notice|toast|snackbar|notification|message|status)\b/i;

function normalizeTokens(str) {
  return String(str || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_.]/g, ' ');
}

function looksLikeMessage(el) {
  if (!el || el.nodeType !== 1) return false;
  const role = el.getAttribute('role') || '';
  const cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
  const id = el.id || '';
  const label = el.getAttribute('aria-label') || '';
  const title = el.getAttribute('title') || '';
  const tokens = normalizeTokens(`${role} ${cls} ${id} ${label} ${title}`);
  if (MESSAGE_WORD.test(tokens)) return true;

  let parent = el.parentElement;
  for (let i = 0; parent && i < 2; i++, parent = parent.parentElement) {
    const pRole = parent.getAttribute('role') || '';
    const pCls = typeof parent.className === 'string' ? parent.className : (parent.getAttribute('class') || '');
    const pId = parent.id || '';
    if (MESSAGE_WORD.test(normalizeTokens(`${pRole} ${pCls} ${pId}`))) return true;
  }

  if (el.querySelector) {
    const child = el.querySelector('[class*="toast" i], [class*="alert" i], [class*="error" i], [class*="notice" i], [class*="message" i], [id*="toast" i], [id*="alert" i], [id*="error" i], [id*="notice" i], [id*="message" i]');
    if (child) return true;
  }
  return false;
}

function isLive(el) {
  if (!el || el.nodeType !== 1) return false;
  const live = el.getAttribute('aria-live')?.toLowerCase().trim();
  const role = el.getAttribute('role')?.toLowerCase().trim();
  if (role === 'alert' || role === 'status' || role === 'log') return true;
  if (live && live !== 'off') return true;
  if (el.closest?.('[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]')) return true;
  if (el.querySelector?.('[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]')) return true;
  return false;
}

function inViewport(el, win) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  const r = el.getBoundingClientRect();
  const vh = win.innerHeight || 800;
  const vw = win.innerWidth || 1280;
  return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
}

function isTextEntry(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  return false;
}

function summarize(el, s, doc, maxChars) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return '';
  const tag = el.tagName;
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(tag)) return '';
  if (el.closest('[hidden], [aria-hidden="true"]')) return '';

  const active = doc.activeElement;
  if (active && active !== doc.body && el.contains(active)) return '';

  let text = s.page.readableText(el, {
    skip: 'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]',
  });
  if (!text) {
    text = s.page.readableText(el);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < 3 && tag !== 'OUTPUT') return '';
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1).trim() + '…';
  }
  return text;
}

export default {
  s: null,
  options: null,
  toolkit: null,

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const doc = document;
    const win = window;
    if (!doc || (!doc.body && !doc.documentElement)) return false;

    const s = (this.s = this.toolkit.session());

    const debounceMs = Math.max(50, Number(options.debounceMs) || 100);
    const actionWindowMs = Math.max(500, Number(options.actionWindowMs) || 3000);
    const maxChars = Math.max(20, Number(options.maxChars) || 140);

    const PAGE_SPOKE_MS = 600;

    let lastActionAt = 0;
    let lastTypingAt = 0;
    let pageSpokeAt = 0;
    let pendingElement = null;
    let settleTimer = null;
    let routeTimer = null;
    let lastSpokenText = '';
    let lastSpokenAt = 0;
    let spokenTimestamps = [];
    const tickers = new WeakSet();
    const elementUpdates = new WeakMap();

    const onAction = () => { lastActionAt = Date.now(); };
    s.listen(doc, 'click', onAction, true);
    s.listen(doc, 'submit', onAction, true);
    s.listen(doc, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        lastActionAt = Date.now();
      } else if (isTextEntry(e.target)) {
        lastTypingAt = Date.now();
      }
    }, true);
    s.listen(doc, 'input', (e) => {
      if (isTextEntry(e.target)) {
        lastTypingAt = Date.now();
      }
    }, true);

    function isAnswering() {
      const now = Date.now();
      if (lastTypingAt > lastActionAt && now - lastTypingAt < 1200) return false;
      return now - lastActionAt < actionWindowMs;
    }

    function scheduleAnnouncement(targetEl) {
      pendingElement = targetEl;
      if (settleTimer) { settleTimer(); settleTimer = null; }
      settleTimer = s.timer(() => {
        settleTimer = null;
        if (!s.alive() || !pendingElement || !pendingElement.isConnected) return;
        if (Date.now() - pageSpokeAt < PAGE_SPOKE_MS) {
          pendingElement = null;
          return;
        }

        const active = doc.activeElement;
        if (active && active !== doc.body && pendingElement.contains(active)) {
          pendingElement = null;
          return;
        }

        const text = summarize(pendingElement, s, doc, maxChars);
        pendingElement = null;
        if (!text) return;

        const now = Date.now();
        if (text === lastSpokenText && now - lastSpokenAt < 1000) return;

        spokenTimestamps = spokenTimestamps.filter((t) => now - t < 3000);
        if (spokenTimestamps.length >= 3) return;

        lastSpokenText = text;
        lastSpokenAt = now;
        spokenTimestamps.push(now);
        s.announce(text);
      }, 50);
    }

    // Watch SPA route changes
    let lastRouteAnnouncement = '';
    s.watch.route(() => {
      if (routeTimer) { routeTimer(); routeTimer = null; }
      routeTimer = s.timer(() => {
        routeTimer = null;
        if (!s.alive()) return;

        const main = s.page.main();
        const h1 = doc.querySelector('main h1, h1, [role="heading"][aria-level="1"]');
        const heading = (h1 && s.page.isVisible(h1)) ? h1 : (main?.querySelector?.('h2, [role="heading"]') || null);
        const headingText = heading && s.page.isVisible(heading)
          ? (heading.textContent || '').replace(/\s+/g, ' ').trim()
          : '';
        const titleText = (doc.title || '').replace(/\s+/g, ' ').trim();

        const announcement = headingText || titleText;
        if (announcement && announcement !== lastRouteAnnouncement) {
          lastRouteAnnouncement = announcement;
          s.announce(announcement);
        }
      }, 80);
    });

    // Watch newly added elements
    s.watch.added(doc.body || doc.documentElement, (addedElements) => {
      if (!s.alive() || !addedElements || !addedElements.length) return;
      if (Date.now() - pageSpokeAt < PAGE_SPOKE_MS) return;

      const candidates = [];
      for (const el of addedElements) {
        if (!el || el.nodeType !== 1 || !el.isConnected) continue;
        if (s.page.isOurs(el)) continue;
        if (el.closest?.('[aria-live="off"]')) continue;
        if (isLive(el)) {
          pageSpokeAt = Date.now();
          continue;
        }
        if (el.tagName === 'IFRAME' || el.closest?.('iframe')) continue;
        if (!s.page.isVisible(el)) continue;
        if (!inViewport(el, win)) continue;
        candidates.push(el);
      }

      if (!candidates.length) return;

      const answering = isAnswering();
      const messages = candidates.filter(looksLikeMessage);

      let targetEl = null;
      if (messages.length > 0) {
        targetEl = messages[messages.length - 1];
      } else if (answering) {
        targetEl = candidates[0];
      }

      if (!targetEl) return;

      if (tickers.has(targetEl)) return;
      const lastSeen = elementUpdates.get(targetEl);
      if (lastSeen && Date.now() - lastSeen < 1500 && !answering) {
        tickers.add(targetEl);
        return;
      }
      elementUpdates.set(targetEl, Date.now());

      scheduleAnnouncement(targetEl);
    }, { batch: true, debounceMs });

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
