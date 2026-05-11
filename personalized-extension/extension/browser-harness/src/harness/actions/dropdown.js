// Dropdown introspection + selection. Mirrors browser_use's
// dropdown_options(index) and select_dropdown(index, text). Handles
// native <select>, role=listbox/combobox/menu (ARIA), and option-bearing
// custom dropdowns.

import { bhAttach, bhCdp } from '../lifecycle.js';
import { _bhWithStaleRecovery } from './stale-recovery.js';

// Read a dropdown's available options. Wrapper with stale-recovery.
export async function bhDropdownOptions(tabId, idx, opts = {}) {
  return await _bhWithStaleRecovery(tabId, idx, opts, 'dropdown_options',
    (i, o) => _bhDropdownOptionsCore(tabId, i, o));
}

async function _bhDropdownOptionsCore(tabId, idx, _opts) {
  await bhAttach(tabId);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`dropdown_options: invalid index ${idx}`);
  }
  const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'dropdown_options does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      // Native <select>: iterate .options[].
      if (tag === 'SELECT') {
        const opts = [];
        for (let i = 0; i < el.options.length; i++) {
          const o = el.options[i];
          opts.push({
            idx: i,
            text: (o.textContent || '').trim().slice(0, 120),
            value: o.value,
            selected: !!o.selected,
            disabled: !!o.disabled,
          });
        }
        return { kind: 'native', tag, options: opts, multiple: !!el.multiple };
      }
      // ARIA: role=listbox / combobox / menu / etc. Look for child option
      // descendants. aria-controls is the usual idiom for combobox->listbox.
      let optionRoot = null;
      if (role === 'listbox' || role === 'menu' || role === 'tree' || role === 'grid') {
        optionRoot = el;
      } else if (role === 'combobox' || role === 'searchbox') {
        // combobox: look at aria-controls / aria-owns
        const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (controls) {
          for (const id of controls.split(/\\s+/).filter(Boolean)) {
            const r = document.getElementById(id);
            if (r) { optionRoot = r; break; }
          }
        }
      }
      if (!optionRoot) {
        return { error: 'wrong_action', hint: 'dropdown_options expects a <select> or role=listbox/combobox/menu element. Got <' + tag.toLowerCase() + (role ? ' role=' + role : '') + '>. If this is a custom dropdown, click_index it to open and re-enumerate to see the options.' };
      }
      const opts = [];
      const optionEls = optionRoot.querySelectorAll('[role="option"], [role="menuitem"], [role="treeitem"], [role="row"], li');
      for (let i = 0; i < optionEls.length && i < 200; i++) {
        const o = optionEls[i];
        opts.push({
          idx: i,
          text: (o.textContent || '').trim().slice(0, 120),
          value: o.getAttribute('data-value') || o.getAttribute('value') || '',
          selected: o.getAttribute('aria-selected') === 'true' || o.classList.contains('selected'),
          disabled: o.getAttribute('aria-disabled') === 'true',
        });
      }
      return { kind: 'aria', tag, role, options: opts };
    })()
  `;
  const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true }, { timeoutMs: 2000 });
  const v = r && r.result && r.result.value;
  if (!v) throw new Error(`dropdown_options: ${idx} (no result)`);
  if (v.error === 'wrong_action') throw new Error(`dropdown_options: ${v.hint}`);
  if (v.error) throw new Error(`dropdown_options: ${idx} ${v.error} (re-enumerate)`);
  return v;
}

// Select a dropdown option by visible text. Wrapper with stale-recovery.
export async function bhSelectDropdown(tabId, idx, text, opts = {}) {
  return await _bhWithStaleRecovery(tabId, idx, opts, 'select_dropdown',
    (i, o) => _bhSelectDropdownCore(tabId, i, text, o));
}

async function _bhSelectDropdownCore(tabId, idx, text, _opts) {
  await bhAttach(tabId);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`select_dropdown: invalid index ${idx}`);
  }
  if (typeof text !== 'string' || !text) {
    throw new Error('select_dropdown: text required');
  }
  const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'select_dropdown does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      const target = ${JSON.stringify(text)}.toLowerCase().trim();
      if (tag === 'SELECT') {
        let chosen = -1;
        for (let i = 0; i < el.options.length; i++) {
          const o = el.options[i];
          const t = (o.textContent || '').trim().toLowerCase();
          if (t === target || (o.value || '').toLowerCase() === target) { chosen = i; break; }
        }
        if (chosen < 0) {
          // try a partial match
          for (let i = 0; i < el.options.length; i++) {
            const t = (el.options[i].textContent || '').trim().toLowerCase();
            if (t.includes(target)) { chosen = i; break; }
          }
        }
        if (chosen < 0) return { error: 'no_match', hint: 'no option text or value matches \"' + ${JSON.stringify(text)} + '\". call dropdown_options first to see what is available.' };
        const before = el.value;
        el.selectedIndex = chosen;
        el.value = el.options[chosen].value;
        el.options[chosen].selected = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Verify the value stuck (frameworks sometimes intercept)
        const stuck = el.value === el.options[chosen].value;
        return { kind: 'native', selectedIndex: chosen, selectedText: (el.options[chosen].textContent || '').trim().slice(0, 120), stuck, before, after: el.value };
      }
      // ARIA path
      let optionRoot = null;
      if (role === 'listbox' || role === 'menu' || role === 'tree' || role === 'grid') {
        optionRoot = el;
      } else if (role === 'combobox' || role === 'searchbox') {
        const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (controls) {
          for (const id of controls.split(/\\s+/).filter(Boolean)) {
            const r = document.getElementById(id);
            if (r) { optionRoot = r; break; }
          }
        }
      }
      if (!optionRoot) return { error: 'wrong_action', hint: 'select_dropdown expects <select> or aria role listbox/combobox/menu; got <' + tag.toLowerCase() + (role ? ' role=' + role : '') + '>.' };
      const optionEls = optionRoot.querySelectorAll('[role="option"], [role="menuitem"], [role="treeitem"], li');
      let match = null;
      for (const o of optionEls) {
        const t = (o.textContent || '').trim().toLowerCase();
        if (t === target) { match = o; break; }
      }
      if (!match) {
        for (const o of optionEls) {
          const t = (o.textContent || '').trim().toLowerCase();
          if (t.includes(target)) { match = o; break; }
        }
      }
      if (!match) return { error: 'no_match', hint: 'no aria option text matches \"' + ${JSON.stringify(text)} + '\".' };
      try { match.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      try { match.click(); } catch (_) {}
      return { kind: 'aria', selectedText: (match.textContent || '').trim().slice(0, 120) };
    })()
  `;
  const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: expr, returnByValue: true, includeCommandLineAPI: false }, { timeoutMs: 2500 });
  const v = r && r.result && r.result.value;
  if (!v) throw new Error(`select_dropdown: ${idx} (no result)`);
  if (v.error === 'wrong_action') throw new Error(`select_dropdown: ${v.hint}`);
  if (v.error === 'no_match') throw new Error(`select_dropdown: ${v.hint}`);
  if (v.error) throw new Error(`select_dropdown: ${idx} ${v.error} (re-enumerate)`);
  return v;
}
