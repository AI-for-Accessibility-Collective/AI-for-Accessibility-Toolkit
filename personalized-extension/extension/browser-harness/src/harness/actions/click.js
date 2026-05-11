// Click an element by its position in the most recent enumerate() snapshot.
// Mirrors browser_use's _click_element_node_impl pipeline.

import { bhAttach, bhCdp } from '../lifecycle.js';
import { bhClickAt } from '../input.js';
import { _bhWithStaleRecovery } from './stale-recovery.js';

// JS-click fallback for index-based clicks. Same idea as the coordinate
// fallback (target.click()) but resolves the target via the cached
// window.__bhInteractive[idx] reference so we don't re-walk the DOM.
async function _bhJsClickIndex(tabId, idx) {
  const expr = `
    (() => {
      try {
        const arr = window.__bhInteractive;
        if (!Array.isArray(arr) || ${idx} >= arr.length) return false;
        const el = arr[${idx}];
        if (!el || !el.isConnected || typeof el.click !== 'function') return false;
        el.click();
        return true;
      } catch (_) { return false; }
    })()
  `;
  try {
    const r = await bhCdp(
      tabId,
      'Runtime.evaluate',
      { expression: expr, returnByValue: true },
      { timeoutMs: 2000 },
    );
    return !!(r && r.result && r.result.value === true);
  } catch {
    return false;
  }
}

// Wrapper that adds stale-recovery: on stale_index/stale_element, identity-
// matches the original target against a fresh enumerate and retries once.
export async function bhClickIndex(tabId, idx, opts = {}) {
  return await _bhWithStaleRecovery(tabId, idx, opts, 'click_index',
    (i, o) => _bhClickIndexCore(tabId, i, o));
}

// Looks up window.__bhInteractive[idx] page-side, gets its largest visible
// quad's center, then dispatches via the existing click pipeline (no snap
// needed -- coords are already DOM-derived). Throws "stale index" when the
// index is out of range or the element is no longer connected; caller is
// expected to re-enumerate. Mirrors browser_use's _click_element_node_impl
// (index-based) shape.
async function _bhClickIndexCore(tabId, idx, opts = {}) {
  await bhAttach(tabId);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`click_index: invalid index ${idx}`);
  }
  // Page-side: resolve idx -> live element -> multi-quad center + occlusion
  // check + scrollIntoViewIfNeeded if any quad is partly out of viewport.
  // We do all this in one Runtime.evaluate so we don't pay multiple CDP
  // roundtrips before the actual click events.
  const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      // Cross-origin iframe placeholder: parent JS can't access the real
      // element. The bbox is parent-viewport already; CDP click at center
      // routes through the OOPIF at compositor level. Skip all the
      // page-side machinery (occlusion check, toggle pre-state, etc.) --
      // they'd all need per-frame eval which we don't do for click.
      if (el.__crossOrigin && el.bbox) {
        return {
          cx: el.bbox.x + el.bbox.w / 2,
          cy: el.bbox.y + el.bbox.h / 2,
          tag: el.tag || 'CROSS_ORIGIN',
          role: el.role || null,
          occluded: false,
          isToggle: false,
          toggleKind: null,
          preChecked: null,
          crossOrigin: true,
        };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      // Tag-type validation. Mirrors browser_use _click_element_node_impl
      // pre-click checks: clicking a <select> opens its native picker
      // which CDP can't dismiss reliably; clicking <input type=file> opens
      // a file chooser dialog. Route the LLM to purpose-built actions
      // instead and surface the hint in the error message.
      const tag = el.tagName;
      if (tag === 'SELECT') {
        return { error: 'wrong_action', hint: 'use dropdown_options(' + ${idx} + ') to read options or select_dropdown(' + ${idx} + ', "...") to pick one. Clicking a <select> opens the native picker which the agent cannot interact with.' };
      }
      if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'file') {
        return { error: 'wrong_action', hint: 'use upload_file(' + ${idx} + ', path) to attach a file. Clicking a <input type=file> opens the OS file chooser which the agent cannot interact with.' };
      }
      // Print-button detection. Buttons that call window.print() open a
      // blocking system dialog the agent cannot dismiss. Mirrors
      // browser_use's auto-PDF logic: signal the caller so it can skip
      // the click and generate a PDF via Page.printToPDF instead.
      const onclick = el.getAttribute('onclick') || '';
      if (/(^|[^a-zA-Z_$])print\\s*\\(/.test(onclick) || /window\\.print\\s*\\(/.test(onclick)) {
        return { error: 'print_intercept' };
      }
      // Bring into viewport if needed -- the LLM picked an idx visible at
      // enumerate-time; the page may have shifted since.
      try {
        const r0 = el.getBoundingClientRect();
        const vw0 = window.innerWidth || document.documentElement.clientWidth;
        const vh0 = window.innerHeight || document.documentElement.clientHeight;
        if (r0.bottom < 0 || r0.top > vh0 || r0.right < 0 || r0.left > vw0) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      } catch (_) {}
      const rects = el.getClientRects();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width <= 0 || r.height <= 0) continue;
        const x0 = Math.max(0, r.left);
        const y0 = Math.max(0, r.top);
        const x1 = Math.min(vw, r.right);
        const y1 = Math.min(vh, r.bottom);
        const visW = Math.max(0, x1 - x0);
        const visH = Math.max(0, y1 - y0);
        const area = visW * visH;
        if (area > bestArea) { bestArea = area; best = r; }
      }
      if (!best) {
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width > 0 && r.height > 0) { best = r; break; }
        }
      }
      if (!best) {
        const br = el.getBoundingClientRect();
        if (br && br.width > 0 && br.height > 0) {
          best = br;
        } else {
          return { error: 'no_geometry' };
        }
      }
      // Offset translates iframe-local coords to parent-viewport coords.
      // For elements in the parent doc, offset is (0, 0).
      const offsetArr = window.__bhInteractiveOffset || [];
      const off = offsetArr[${idx}] || { x: 0, y: 0 };
      const cx = best.left + best.width / 2 + off.x;
      const cy = best.top + best.height / 2 + off.y;
      // Occlusion check. document.elementFromPoint is a parent-viewport
      // query, so for iframe-contained elements (off.x|y != 0) it would
      // return the iframe element rather than walking inside. Skip the
      // check rather than false-positive on every iframe click; CDP
      // mouse-event dispatch still routes correctly through the iframe.
      let occluded = false;
      if (off.x === 0 && off.y === 0) {
        try {
          const topmost = document.elementFromPoint(cx, cy);
          if (topmost && !el.contains(topmost)) occluded = true;
        } catch (_) {}
      }
      // Toggle pre-state. For checkbox/radio (native or ARIA) we want to
      // verify the click actually flipped state -- CDP mouse events
      // sometimes don't toggle (framework intercepts e.preventDefault(),
      // or label proxies). isToggleNative reads .checked; isToggleAria
      // reads aria-checked; either path returns a bool snapshot.
      let isToggle = false;
      let toggleKind = null; // 'native' | 'aria'
      let preChecked = null;
      const tagName = el.tagName;
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role');
      const ARIA_TOGGLE_ROLES = ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'];
      if (tagName === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio')) {
        isToggle = true;
        toggleKind = 'native';
        try { preChecked = !!el.checked; } catch (_) {}
      } else if (role && ARIA_TOGGLE_ROLES.indexOf(role) >= 0) {
        isToggle = true;
        toggleKind = 'aria';
        // aria-checked is "true" / "false" / "mixed". Treat anything
        // truthy-stringy as checked. "mixed" is its own value but flips
        // on click like a tristate; comparing pre vs post still works.
        const ac = el.getAttribute('aria-checked');
        preChecked = ac === null ? null : ac;
      }
      return {
        cx, cy,
        tag: tagName,
        role: role || null,
        occluded,
        isToggle,
        toggleKind,
        preChecked,
      };
    })()
  `;
  let v;
  try {
    const r = await bhCdp(
      tabId,
      'Runtime.evaluate',
      { expression: expr, returnByValue: true },
      { timeoutMs: 2000 },
    );
    if (r && r.exceptionDetails) {
      throw new Error('click_index: page-side eval threw');
    }
    v = r && r.result && r.result.value;
  } catch (e) {
    throw new Error(`click_index: ${e.message}`);
  }
  if (!v || v.error) {
    if (v && v.error === 'wrong_action') {
      throw new Error(`click_index: ${v.hint}`);
    }
    if (v && v.error === 'print_intercept') {
      // Generate a PDF instead of clicking the print button. Triggers a
      // chrome.downloads transfer; the agent doesn't need to handle a
      // dialog. Returns a sentinel result so the caller can log
      // accordingly.
      try {
        const pdf = await bhCdp(tabId, 'Page.printToPDF', {}, { timeoutMs: 15000 });
        return {
          x: NaN, y: NaN, snapped: false, indexed: idx,
          tag: 'PRINT_BUTTON', role: null, via: 'print_intercept',
          printPdfBase64: pdf && pdf.data || null,
        };
      } catch (e) {
        throw new Error(`click_index: print intercept failed (${e.message}); the agent cannot interact with the system print dialog`);
      }
    }
    const reason = (v && v.error) || 'unknown';
    throw new Error(`click_index: ${idx} ${reason} (re-enumerate)`);
  }

  // If occluded, skip the CDP mouse events and call element.click() directly.
  if (v.occluded && opts.fallback !== false) {
    const ok = await _bhJsClickIndex(tabId, idx);
    return {
      x: v.cx, y: v.cy, snapped: true, indexed: idx,
      tag: v.tag, role: v.role, via: 'index',
      occluded: true, fallback: ok,
    };
  }

  // Dispatch through the existing click pipeline. snap:false because we
  // already have DOM-derived coords; re-snapping would be a no-op or
  // worse. The pipeline still runs the JS-click fallback if both press
  // and release throw.
  const click = await bhClickAt(tabId, v.cx, v.cy, { ...opts, snap: false });
  let toggleVerified = null;
  // Toggle verification: re-read state after the CDP click. Native
  // checkbox/radio uses .checked; ARIA toggles read aria-checked. If
  // the state didn't flip, JS-click is the fallback (some frameworks
  // intercept the mouse event but respond to el.click()).
  if (v.isToggle && v.preChecked !== null && opts.fallback !== false) {
    try {
      const useAria = v.toggleKind === 'aria';
      const readExpr = useAria ? "el.getAttribute('aria-checked')" : "!!el.checked";
      const verifyExpr = `
        (() => {
          const arr = window.__bhInteractive;
          if (!Array.isArray(arr) || ${idx} >= arr.length) return null;
          const el = arr[${idx}];
          if (!el || !el.isConnected) return null;
          return { post: ${readExpr} };
        })()
      `;
      const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: verifyExpr, returnByValue: true }, { timeoutMs: 1500 });
      const post = r && r.result && r.result.value ? r.result.value.post : undefined;
      // For ARIA, post is a string ('true'/'false'/'mixed'/null); compare
      // strict-equal to preChecked which we also captured as string.
      // For native, both are booleans.
      const sameState = (post === v.preChecked);
      if (sameState) {
        const ok = await _bhJsClickIndex(tabId, idx);
        toggleVerified = ok ? 'js_fallback' : 'unchanged';
      } else {
        toggleVerified = 'flipped';
      }
    } catch (_) {
      toggleVerified = 'verify_failed';
    }
  }
  return {
    ...click,
    snapped: true,
    indexed: idx,
    tag: v.tag,
    role: v.role,
    via: 'index',
    toggleVerified,
  };
}
