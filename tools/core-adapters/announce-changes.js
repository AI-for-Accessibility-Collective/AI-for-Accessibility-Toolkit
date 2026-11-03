// announce-changes.js — Tells screen reader users about changes the page makes without saying so.
// Barrier: Blind and low-vision people using screen readers miss dynamic status updates,
// toast notifications, error messages, content replacements, and single-page app route changes
// when authors omit ARIA live regions (aria-live, role status or alert).
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   debounceMs: Time in milliseconds to batch rapid bursts of changes (default: 200).
//   actionMs: Window in milliseconds after a user click, key, or submit during which
//             content changes count as an answer to the person's action (default: 3000).
//
// Decisions:
//   • Speaks through s.announce and s.announce.batch via the host's shared live region,
//     never creating competing live regions of its own.
//   • Never announces changes inside existing aria-live regions, role="status", role="alert",
//     or role="log", because the screen reader already speaks them natively.
//   • Excludes the toolkit's own UI and elements (data-ai4a11y-ui, ai4a11y-*, ws-*).
//   • Only announces what reads as a message: elements whose role, class, id, or name indicates
//     a message (status, alert, error, notice, message, toast, etc.), or content that appears
//     or replaces a region within actionMs of the person's deliberate action (click, key, submit).
//   • Never announces text that changes inside existing content on its own (clocks, tickers,
//     timers, counters, carousels, lazy-loaded images, ads, or infinite scroll additions).
//   • Skips typing-induced changes while the person types in input fields or textareas.
//   • Ignores iframes and elements outside the visible viewport.
//   • Watches SPA client-side navigations with s.watch.route and announces the new view's heading or title.
//   • Batches bursts of multiple changes into at most a few concise announcements.
//   • Automatically tears down all listeners, observers, and timers on disable() via session cleanup.
//
// What it cannot do:
//   • Cannot read changes inside cross-origin iframes.
//   • Cannot interpret graphical or icon-only status indicators that have no text or accessible name.

const MESSAGE_HINT = /\b(status|alert|error|warn|warning|notice|message|toast|snackbar|notification)\b/i;
const NOISE_HINT = /\b(clock|timestamp|time|timer|ticker|countdown|counter|carousel|slider|ad|advert|banner-ad)\b/i;
const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"]';
const MAX_ANNOUNCE_CHARS = 140;

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const root = document.body || document.documentElement;
    if (!root) return false;

    const s = (this.s = this.toolkit.session());
    const debounceMs = Math.max(50, this.options.debounceMs ?? 200);
    const actionMs = Math.max(500, this.options.actionMs ?? 3000);

    let lastAction = 0;
    let lastTypingAt = 0;
    let pageSpokeAt = 0;
    let lastAnnounced = '';
    let lastAnnouncedAt = 0;
    let lastRoute = '';
    const tickers = new WeakSet();
    const updateTimes = new WeakMap();

    // Track deliberate user actions: clicks and form submissions
    s.listen(document, 'click', (e) => {
      if (s.page.isOurs(e.target)) return;
      lastAction = Date.now();
    }, { capture: true });

    s.listen(document, 'submit', (e) => {
      if (s.page.isOurs(e.target)) return;
      lastAction = Date.now();
    }, { capture: true });

    // Track keyboard interactions: Enter/Space activate; typing is recorded to suppress echo
    s.listen(document, 'keydown', (e) => {
      if (s.page.isOurs(e.target)) return;
      const target = e.target;
      const isInput = target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName);
      const isEditable = Boolean(target?.isContentEditable);

      if (e.key === 'Enter') {
        lastAction = Date.now();
      } else if (e.key === ' ' && !isInput && !isEditable) {
        lastAction = Date.now();
      } else if (isInput || isEditable) {
        lastTypingAt = Date.now();
      }
    }, { capture: true });

    s.listen(document, 'input', (e) => {
      if (s.page.isOurs(e.target)) return;
      lastTypingAt = Date.now();
    }, { capture: true });

    const isAnswering = () => Date.now() - lastAction < actionMs;
    const isTyping = () => Date.now() - lastTypingAt < 1000;

    const inViewport = (el) => {
      if (!el || typeof el.getBoundingClientRect !== 'function') return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
      const vh = window.innerHeight || document.documentElement.clientHeight || 768;
      return r.bottom >= 0 && r.right >= 0 && r.top <= vh && r.left <= vw;
    };

    const isMessage = (el) => {
      for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
        const cls = typeof e.className === 'string' ? e.className : (e.className?.baseVal || '');
        const id = e.id || '';
        const role = e.getAttribute?.('role') || '';
        const name = e.getAttribute?.('name') || '';
        const label = e.getAttribute?.('aria-label') || '';
        if (MESSAGE_HINT.test(`${role} ${cls} ${id} ${name} ${label}`)) return true;
      }
      return false;
    };

    const isTickerOrTimestamp = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName === 'TIME' || el.closest('time')) return true;
      if (el.matches?.('[role="timer" i], [role="marquee" i]')) return true;

      const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      const id = el.id || '';
      if (NOISE_HINT.test(`${cls} ${id}`) && !isMessage(el)) return true;

      if (tickers.has(el)) return true;
      const now = Date.now();
      const prev = updateTimes.get(el);
      if (prev && now - prev < 2000 && lastAction <= prev) {
        tickers.add(el);
        return true;
      }
      updateTimes.set(el, now);
      return false;
    };

    const summarize = (el) => {
      if (!el || el.nodeType !== 1 || !el.isConnected) return '';
      if (el.closest('[hidden], [aria-hidden="true"]')) return '';

      const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
      const lines = (raw || '').split(/\n+/).map((str) => str.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!lines.length) return '';

      const controls = new Set();
      if (!el.matches(INTERACTIVE)) {
        el.querySelectorAll(INTERACTIVE).forEach((c) => {
          const cRaw = typeof c.innerText === 'string' ? c.innerText : c.textContent;
          (cRaw || '').split(/\n+/).map((str) => str.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((l) => controls.add(l));
        });
      }
      let kept = lines.filter((l) => !controls.has(l));
      if (!kept.length) kept = lines;

      let text = '';
      for (const part of kept.slice(0, 3)) {
        const next = !text ? part : text + (/[.!?:;,…]$/.test(text) ? ' ' : '. ') + part;
        if (text && next.length > MAX_ANNOUNCE_CHARS) break;
        text = next;
      }
      if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
      return text.trim();
    };

    const handleAdded = (el) => {
      if (!s.alive() || !el || el.nodeType !== 1) return;

      // Skip the toolkit's own elements and other adapters' UI
      if (s.page.isOurs(el)) return;
      if (el.closest('[data-ai4a11y-ui], [id^="ai4a11y-"], [class*="ai4a11y-"], [id^="ws-"], [class*="ws-"]')) return;

      // Skip iframes
      if (el.tagName === 'IFRAME' || el.closest('iframe')) return;

      // Skip non-textual or irrelevant elements
      const tag = el.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OBJECT|EMBED|SVG|CANVAS|AUDIO|VIDEO|IMG|PICTURE|SOURCE)$/i.test(tag)) return;

      // Skip changes inside existing aria-live, status, alert, or log regions
      if (el.closest('[aria-live]:not([aria-live="off"]), [role="alert" i], [role="status" i], [role="log" i]')) {
        pageSpokeAt = Date.now();
        return;
      }
      if (el.querySelector?.('[aria-live]:not([aria-live="off"]), [role="alert" i], [role="status" i], [role="log" i]')) {
        pageSpokeAt = Date.now();
        return;
      }

      // Must be visible and in the viewport
      if (!s.page.isVisible(el)) return;
      if (!inViewport(el)) return;

      // If focus moved into this element (e.g. an accessible modal dialog), screen reader speaks it
      const active = document.activeElement;
      if (active && active !== document.body && el.contains(active)) return;

      // Skip tickers, clocks, and counters that update periodically
      if (isTickerOrTimestamp(el)) return;

      // Only announce what reads as a message, or content appearing in response to a deliberate action
      const isMsg = isMessage(el);
      const isAction = isAnswering() && !isTyping();
      if (!isMsg && !isAction) return;

      // Skip if page's own live region recently spoke
      if (Date.now() - pageSpokeAt < 1500) return;

      const text = summarize(el);
      if (!text || text.length < 2) return;

      const now = Date.now();
      if (text === lastAnnounced && now - lastAnnouncedAt < 1200) return;
      lastAnnounced = text;
      lastAnnouncedAt = now;

      s.announce.batch('changes', text, { windowMs: debounceMs });
    };

    // Watch for dynamic additions to the document
    s.watch.added(root, handleAdded);

    // Watch for single-page app route changes
    s.watch.route(() => {
      s.timer(() => {
        if (!s.alive()) return;
        const h1 = document.querySelector('main h1, h1, [role="heading"][aria-level="1"]');
        const h1Text = (h1?.textContent || '').replace(/\s+/g, ' ').trim();
        const heading = s.page.headings ? s.page.headings({ maxLevel: 2 })[0]?.text : null;
        const title = (document.title || '').replace(/\s+/g, ' ').trim();
        const name = h1Text || heading || title || 'New page';
        if (name && name !== lastRoute) {
          lastRoute = name;
          s.announce(name);
        }
      }, 100);
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
