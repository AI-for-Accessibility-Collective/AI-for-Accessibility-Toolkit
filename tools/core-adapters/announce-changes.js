// Announce changes — tells screen reader users about dynamic page updates.
//
// Dynamic pages frequently swap in status notices, error boxes, replaced
// container regions, and client-side view navigations without adding ARIA
// live regions. Screen reader users hear nothing and the page appears
// unchanged. This adapter watches for dynamic additions and route changes,
// speaking one plain, concise announcement through the host's shared live
// region (s.announce).
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// Settings read: none.
// Adjusts: nothing (on or off).
// Options:
//   - windowMs (number, default 250): debounce window in milliseconds to
//     batch rapid additions into one announcement.
//   - maxChars (number, default 160): maximum length of an announcement.
//
// Decisions it makes:
// - All announcements go through s.announce and s.announce.batch, using the
//   toolkit's one shared live region rather than adding redundant regions.
// - Existing live regions ([aria-live]:not([aria-live="off"]), [role="alert"],
//   [role="status"], [role="log"]) are already announced by screen readers,
//   so changes inside or to them are skipped to prevent duplicate speech.
// - Regions explicitly silenced with aria-live="off" are respected and skipped.
// - Changes caused by the person typing in text fields (<input>, <textarea>,
//   [contenteditable]) are skipped via s.watch.byPerson and active editable checks,
//   preserving screen reader typing echo.
// - Rapid additions (e.g. 20 items in a burst) are batched via s.announce.batch
//   so they produce at most a few concise announcements rather than flooding.
// - Client-side view navigations are detected with s.watch.route and spoken with
//   the new view's heading or document title; additions during navigation are
//   quieted to avoid reading raw fragments over the new page name.
// - The adapter's own and the toolkit's UI (data-ai4a11y-ui, s.page.isOurs) are
//   never announced.
// - Elements that already hold user focus (such as an opened dialog) are left to
//   the screen reader's focus announcement.
//
// What it cannot do:
// - Cannot read changes inside closed Shadow DOMs or cross-origin iframes.
// - Cannot infer meaning from visual-only icon changes without accessible text.

const LIVE_SELECTOR = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]';
const SILENT_SELECTOR = '[aria-live="off"]';
const OTHER_UI = '[data-ai4a11y-ui], [id^="ai4a11y-"], [class*="ai4a11y-"], [id^="ws-"], [class^="ws-"], [class*=" ws-"]';
const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|SVG|CANVAS)$/i;

export default {
  s: null,

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());

    const doc = document;
    const windowMs = Number(options?.windowMs) || 250;
    const maxChars = Number(options?.maxChars) || 160;

    globalThis.__announceChangesActive = true;

    let lastRouteAt = 0;

    function isCausedByTyping(el) {
      if (el.closest?.('input, textarea, [contenteditable]')) return true;
      if (s.watch.byPerson(el, { withinMs: 1000 })) return true;
      const active = doc.activeElement;
      if (active && (/^(input|textarea)$/i.test(active.tagName) || active.isContentEditable)) {
        if (s.watch.byPerson(active, { withinMs: 1000 })) return true;
      }
      return false;
    }

    function summarize(el) {
      let text = s.page.readableText(el, { skip: 'button, a[href], [role="button"], [role="link"]' });
      if (!text) {
        text = s.page.readableText(el);
      }
      if (!text) {
        const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
        text = (raw || '').replace(/\s+/g, ' ').trim();
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length < 2 && el.tagName !== 'OUTPUT') return '';
      if (text.length > maxChars) {
        text = text.slice(0, maxChars - 1).trim() + '…';
      }
      return text;
    }

    function onAdded(el) {
      if (!el || el.nodeType !== 1 || !el.isConnected) return;
      if (SKIP_TAGS.test(el.tagName)) return;
      if (s.page.isOurs(el) || el.closest(OTHER_UI)) return;

      // Skip elements that are inside or contain active live regions or are silenced
      if (el.closest(SILENT_SELECTOR)) return;
      if (el.closest(LIVE_SELECTOR)) return;
      if (el.matches(LIVE_SELECTOR)) return;
      if (el.querySelector?.(LIVE_SELECTOR)) return;

      // Skip hidden content
      if (el.closest('[hidden], [aria-hidden="true"]')) return;
      if (!s.page.isVisible(el)) return;

      // Skip elements that already have keyboard focus (screen reader speaks focus)
      const active = doc.activeElement;
      if (active && active !== doc.body && el.contains(active)) return;

      // Skip changes caused by user typing
      if (isCausedByTyping(el)) return;

      // Skip additions immediately following client-side route navigation
      if (Date.now() - lastRouteAt < 500) return;

      const text = summarize(el);
      if (!text) return;

      const parent = el.parentElement;
      const key = parent ? (parent.id || parent.className || parent.tagName) : 'change';
      s.announce.batch(key, text, { windowMs });
    }

    // Watch for new elements added to the page
    s.watch.added(null, onAdded, { types: ['childList', 'characterData'] });

    // Watch client-side single-page app route navigations
    s.watch.route(() => {
      lastRouteAt = Date.now();
      s.timer(() => {
        if (!s.alive()) return;
        const title = (doc.title || '').replace(/\s+/g, ' ').trim();
        const main = s.page.main?.() || doc.querySelector('main, [role="main"]');
        const view = doc.querySelector('#spa-view, .view, [role="region"]') || main;
        const heading = (view && view.querySelector('h1, h2, h3, [role="heading"]')) ||
                        (main && main.querySelector('h1, h2, h3, [role="heading"]')) ||
                        doc.querySelector('h1, h2, [role="heading"]');
        const hText = heading ? (s.page.nameOf?.(heading) || heading.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const viewName = title || hText || 'New view';
        s.announce(viewName);
      }, 60);
    });
  },

  disable() {
    if (!this.s) return;
    this.s.end();
    this.s = null;
    delete globalThis.__announceChangesActive;
  },
};
