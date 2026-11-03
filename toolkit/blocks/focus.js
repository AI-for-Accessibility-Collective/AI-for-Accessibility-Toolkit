// Block 9, focus and keys.
//
//   s.focus.region(el)            move focus to a region that is not focusable itself
//   s.focus.keepWhenRemoving(el)  move focus out before el goes, so it is not lost
//   s.focus.entry({ label, onActivate })  a button first in the tab order
//   s.focus.skipLink()            'Skip to main content', unless the page has one that works
//   s.focus.keepVisible()         the focused element never hidden under a fixed or sticky bar
//   s.keys.adjust({ label: 'Text size', settings: ['fontScale'], up, down })
//
// keys.adjust: what the toolkit's one shortcut does when the person gives it
// to this adapter (shortcut.js): up and down adjust what the adapter
// adjusts. The keys are never taken from a text field or editable region.
// Scrolling to a region follows reduced motion.
//
// entry and skipLink: the toolkit's controls at the start of the tab order,
// in one place at the top of the page, after the page's own skip link. Each
// is out of sight until it has focus, then shown at the top left, so it
// covers nothing the person is reading.
//
// keepVisible (WCAG 2.4.11): it measures what is fixed or stuck to the top
// and bottom of the window where the focused element is, sets the page's
// scroll padding to clear it, and scrolls the focused element out from
// under it once. It does not move focus or change the tab order.

import { reducedMotion, UI_ATTR } from './shared.js';

const ENTRY_CSS = `[data-ai4a11y-entries] > .ai4a11y-entry:not(:focus) { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
[data-ai4a11y-entries] > .ai4a11y-entry:focus { position: fixed !important; top: 8px !important; left: 8px !important; z-index: 2147483647 !important; margin: 0 !important; padding: 10px 16px !important; min-height: 44px !important; background: #fff !important; color: #000 !important; border: 2px solid #000 !important; border-radius: 4px !important; outline: 3px solid #1a5fb4 !important; outline-offset: 2px !important; font: 600 16px/1.4 system-ui, sans-serif !important; text-decoration: underline !important; cursor: pointer !important; box-shadow: 0 0 0 6px #fff !important; }`;
const SKIP_TEXT = /skip|jump|main content|go to content/i;

const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/;

export function focusBlock(s, env) {
  const { doc, win, shared } = env;
  const focusable = (el) => (NATIVELY_FOCUSABLE.test(el.tagName) && !el.disabled) || el.hasAttribute('tabindex');

  function region(el, { scroll = true } = {}) {
    if (!s.alive() || !el) return;
    if (!focusable(el)) {
      // A temporary tabindex, gone when focus leaves or the session ends.
      s.setAttr(el, 'tabindex', '-1');
      const drop = () => {
        el.removeEventListener('blur', drop);
        if (el.getAttribute('tabindex') === '-1') el.removeAttribute('tabindex');
      };
      el.addEventListener('blur', drop);
    }
    el.focus({ preventScroll: true });
    if (scroll && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: reducedMotion(env) ? 'auto' : 'smooth' });
    }
  }

  function keepWhenRemoving(el) {
    if (!el || !el.contains(doc.activeElement)) return;
    let target = el.parentElement;
    while (target && target !== doc.body && !focusable(target)) target = target.parentElement;
    if (!target || target === doc.body) target = el.parentElement || doc.body;
    region(target, { scroll: false });
  }

  // The page's own skip link: one of the first few things Tab reaches, a
  // same-page link whose target is there.
  function pageSkipLink() {
    const first = [...doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter((el) => !env.page.isOurs(el) && el.tabIndex >= 0 && !el.disabled).slice(0, 3);
    return first.find((a) => {
      const href = a.getAttribute && a.getAttribute('href');
      if (!href || !/^#./.test(href)) return false;
      let target = null;
      try { target = doc.getElementById(decodeURIComponent(href.slice(1))) || doc.querySelector(`a[name="${CSS.escape(href.slice(1))}"]`); } catch { target = null; }
      return !!target && (SKIP_TEXT.test(env.page.nameOf(a) || a.textContent || '') || target === env.page.main() || target.contains(env.page.main()));
    }) || null;
  }

  // One box for every adapter's entries; it goes when the last one does.
  function entries() {
    let box = shared.entries;
    if (box && box.isConnected) return box;
    box = doc.createElement('div');
    box.setAttribute(UI_ATTR, 'ui');
    box.setAttribute('data-ai4a11y-entries', '');
    const style = doc.createElement('style');
    style.textContent = ENTRY_CSS;
    box.appendChild(style);
    shared.ourNodes.add(box);
    const skip = pageSkipLink();
    const body = doc.body || doc.documentElement;
    if (skip && skip.parentNode) skip.parentNode.insertBefore(box, skip.nextSibling);
    else body.insertBefore(box, body.firstChild);
    shared.entries = box;
    return box;
  }
  const dropIfEmpty = () => {
    const box = shared.entries;
    if (box && !box.querySelector('.ai4a11y-entry')) { box.remove(); shared.entries = null; }
  };

  function entry({ label, onActivate } = {}) {
    if (!s.alive() || !label) return null;
    const btn = s.el('button', { text: String(label).slice(0, 80), attrs: { type: 'button', class: 'ai4a11y-entry' } });
    s.listen(btn, 'click', (e) => { e.preventDefault(); if (typeof onActivate === 'function') onActivate(e); });
    // Undone in reverse: the button goes first, then the box if it is empty.
    s.onEnd(dropIfEmpty);
    s.append(entries(), btn);
    return btn;
  }

  function skipLink({ label = 'Skip to main content', to } = {}) {
    if (!s.alive() || pageSkipLink()) return null;
    const target = to || env.page.main();
    if (!target || target === doc.body || target === doc.documentElement) return null;
    return entry({ label, onActivate: () => region(target) });
  }

  // What is fixed or stuck across the top or bottom edge of the window at
  // the focused element's left and right, as bands in pixels.
  function bands(el) {
    if (typeof doc.elementFromPoint !== 'function') return { top: 0, bottom: 0 };
    const vw = win.innerWidth, vh = win.innerHeight;
    const r = el.getBoundingClientRect();
    const xs = [r.left + 2, (r.left + r.right) / 2, r.right - 2].map((x) => Math.min(vw - 1, Math.max(0, x)));
    const bar = (x, y) => {
      // The toolkit's own fixed UI (a control bar, a panel) counts too; an
      // entry or bar that holds focus is where focus is, not over it.
      for (let n = doc.elementFromPoint(x, y); n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
        const pos = win.getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          const b = n.getBoundingClientRect();
          // A bar, not a dialog or a full-window layer; and not where focus is.
          if (b.height >= vh * 0.5 || n.contains(el)) return null;
          return b;
        }
      }
      return null;
    };
    let top = 0, bottom = 0;
    for (const x of xs) {
      const t = bar(x, 1); if (t && t.top <= 1) top = Math.max(top, t.bottom);
      const b = bar(x, vh - 2); if (b && b.bottom >= vh - 2) bottom = Math.max(bottom, vh - b.top);
    }
    return { top: Math.ceil(top), bottom: Math.ceil(bottom) };
  }

  function keepVisible({ margin = 8 } = {}) {
    if (!s.alive()) return () => {};
    const root = doc.documentElement;
    const check = (el) => {
      if (!s.alive() || !el || el === doc.body || el === root || !el.getBoundingClientRect) return;
      const { top, bottom } = bands(el);
      s.setStyle(root, 'scroll-padding-top', top ? `${top + margin}px` : '');
      s.setStyle(root, 'scroll-padding-bottom', bottom ? `${bottom + margin}px` : '');
      const r = el.getBoundingClientRect();
      const vh = win.innerHeight;
      let dy = 0;
      if (top && r.top < top + margin) dy = r.top - top - margin;
      else if (bottom && r.bottom > vh - bottom - margin && r.height < vh - top - bottom) dy = r.bottom - (vh - bottom - margin);
      if (dy) win.scrollBy(0, dy);
    };
    // After the browser's own scroll to the newly focused element.
    return s.listen(doc, 'focusin', (e) => { const el = e.target; s.frame(() => { if (doc.activeElement === el) check(el); }); }, true);
  }

  return { region, keepWhenRemoving, entry, skipLink, keepVisible };
}

/** A text field or editable region, where keys are the person's typing. */
export const editable = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));

// Adapters have no shortcuts of their own: the toolkit has one pair of keys
// the person gives to one adapter (shortcut.js). An adapter that has
// something to adjust says how, and gets the pair when it is the one.
export function keysBlock(s, env) {
  const { shared } = env;

  function adjust({ label, settings = [], up, down } = {}) {
    if (!s.alive() || typeof up !== 'function' || typeof down !== 'function') return () => {};
    const entry = { label: String(label || env.adapter).slice(0, 60), settings: (settings || []).map(String), up, down, session: s };
    shared.adjusters.set(env.key, entry);
    if (env.transport.adjustable) Promise.resolve(env.transport.adjustable({ label: entry.label, settings: entry.settings })).catch(() => {});
    const stop = () => { if (shared.adjusters.get(env.key) === entry) shared.adjusters.delete(env.key); };
    s.onEnd(stop);
    return stop;
  }

  return { adjust };
}
