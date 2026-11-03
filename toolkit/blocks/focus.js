// Block 9, focus and keys.
//
//   s.focus.region(el)            move focus to a region that is not focusable itself
//   s.focus.keepWhenRemoving(el)  move focus out before el goes, so it is not lost
//   s.keys.shortcut({ code: 'KeyD', alt: true }, fn)
//
// A shortcut is never taken from a text field or editable region, never with
// Ctrl or Meta held (browser and screen reader commands, AltGr on many
// keyboards), and never for a reserved key. Scrolling to a region follows
// reduced motion.

import { reducedMotion } from './shared.js';

const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/;
const RESERVED = new Set(['Tab', 'Escape', 'Enter', 'NumpadEnter', 'Space', 'F5', 'F6', 'F7', 'F11', 'F12']);

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

export function keysBlock(s, env) {
  const { doc } = env;
  const editable = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));

  function shortcut(key, fn, { allowInFields = false } = {}) {
    const want = { code: key.code, alt: !!key.alt, shift: !!key.shift };
    if (!want.code || (RESERVED.has(want.code) && !want.alt)) throw new Error(`${want.code || 'That key'} is reserved; use another, with Alt.`);
    return s.listen(doc, 'keydown', (e) => {
      if (e.code !== want.code || e.altKey !== want.alt || e.shiftKey !== want.shift) return;
      if (e.ctrlKey || e.metaKey || e.isComposing) return;
      if (!allowInFields && editable(e.target)) return;
      e.preventDefault();
      // The person's own key on a shortcut counts as using the adapter (profile.set).
      if (e.isTrusted) env.shared.lastShortcut = Date.now();
      fn(e);
    }, true);
  }

  return { shortcut };
}
