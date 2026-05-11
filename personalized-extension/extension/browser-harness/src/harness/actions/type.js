// Type into the element at idx. Mirrors browser_use's type_text(index)
// pipeline: resolve the live ref, focus, optionally clear (Cmd/Ctrl+A
// then Backspace), type each character via Input.dispatchKeyEvent (so
// per-key handlers fire), then dispatch input + change + blur events
// for framework reactivity (React/Vue/Svelte don't update controlled
// state from raw key events alone).

import { bhAttach, bhCdp } from '../lifecycle.js';
import { bhPressKey } from '../input.js';
import { _bhWithStaleRecovery } from './stale-recovery.js';

// Wrapper with stale-recovery; see bhClickIndex for the pattern.
export async function bhTypeIndex(tabId, idx, text, opts = {}) {
  return await _bhWithStaleRecovery(tabId, idx, opts, 'type_index',
    (i, o) => _bhTypeIndexCore(tabId, i, text, o));
}

async function _bhTypeIndexCore(tabId, idx, text, opts = {}) {
  await bhAttach(tabId);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`type_index: invalid index ${idx}`);
  }
  if (typeof text !== 'string') text = String(text == null ? '' : text);
  const clearFirst = opts.clear !== false;

  // Page-side: validate, focus, optionally clear. Returns metadata
  // including whether the element supports text input.
  const focusExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'type_index does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements. To type, navigate the agent\\'s tab directly to the iframe\\'s URL.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const t = (el.getAttribute('type') || '').toLowerCase();
      // Reject obvious non-text elements with a hint.
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable && el.getAttribute('role') !== 'textbox' && el.getAttribute('role') !== 'searchbox' && el.getAttribute('role') !== 'combobox') {
        return { error: 'wrong_action', hint: 'type_index target is <' + tag.toLowerCase() + '> -- only INPUT, TEXTAREA, contentEditable, or role=textbox/searchbox/combobox accept text. Use click_index for buttons / links.' };
      }
      if (tag === 'INPUT' && (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit' || t === 'file' || t === 'hidden')) {
        return { error: 'wrong_action', hint: 'type_index does not work on <input type=' + t + '>. Use click_index for checkbox/radio/button/submit, or upload_file for type=file.' };
      }
      // Bring into viewport and focus.
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      try { el.focus(); } catch (_) {}
      // Clear via direct property assignment for inputs/textareas; for
      // contentEditable use Selection API. The Cmd/Ctrl+A + Backspace
      // path the LLM might emit through fill_input is nondeterministic
      // across keyboard layouts; doing it page-side is more reliable.
      if (${clearFirst}) {
        try {
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = '';
          }
        } catch (_) {}
      }
      return { tag, type: t, isContentEditable: !!el.isContentEditable };
    })()
  `;
  let v;
  try {
    const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: focusExpr, returnByValue: true }, { timeoutMs: 1500 });
    v = r && r.result && r.result.value;
  } catch (e) {
    throw new Error(`type_index: ${e.message}`);
  }
  if (!v) throw new Error(`type_index: ${idx} (no result)`);
  if (v.error === 'wrong_action') throw new Error(`type_index: ${v.hint}`);
  if (v.error) throw new Error(`type_index: ${idx} ${v.error} (re-enumerate)`);

  // Type each character via key events. This routes through the same
  // press_key code path so framework keydown handlers see real events.
  for (const ch of text) {
    await bhPressKey(tabId, ch);
  }

  // Dispatch input + change + blur on the element so React/Vue/Svelte
  // controlled inputs update. Without these, key events alone don't
  // bubble through the framework's reactive layer.
  const finishExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return null;
      const el = arr[${idx}];
      if (!el || !el.isConnected) return null;
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      const value = (el.value !== undefined) ? el.value : (el.textContent || '');
      return { value: typeof value === 'string' ? value.slice(0, 200) : '' };
    })()
  `;
  let finalValue = '';
  try {
    const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: finishExpr, returnByValue: true }, { timeoutMs: 1500 });
    if (r && r.result && r.result.value) finalValue = r.result.value.value || '';
  } catch (_) {}
  return {
    indexed: idx,
    tag: v.tag,
    type: v.type,
    cleared: clearFirst,
    value: finalValue,
  };
}
