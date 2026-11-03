// Block 9, focus and keys.
//
//   s.focus.region(el)            move focus to a region that is not focusable itself
//   s.focus.keepWhenRemoving(el)  move focus out before el goes, so it is not lost
//   s.keys.adjust({ label: 'Text size', settings: ['fontScale'], up, down })
//
// keys.adjust: what the toolkit's one shortcut does when the person gives it
// to this adapter (shortcut.js): up and down adjust what the adapter
// adjusts. The keys are never taken from a text field or editable region.
// Scrolling to a region follows reduced motion.

import { reducedMotion } from './shared.js';

const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/;

export function focusBlock(s, env) {
  const { doc } = env;
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

  return { region, keepWhenRemoving };
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
