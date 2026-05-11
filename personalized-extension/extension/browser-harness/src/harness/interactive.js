// Interactive-element enumeration + per-coordinate snap. The big page-side
// helper (findTarget + enumerate) is loaded as a string from
// injected/page-helpers.bhinject; this module wraps it with the CDP plumbing
// (Runtime.evaluate, OOPIF iframe attach, AX-tree fallback).

import { BH_DEBUGGER_VERSION, _BH_AX_INTERACTIVE_ROLES } from './constants.js';
import { BH_ATTACHED, _BH_LAST_ITEMS } from './state.js';
import { _bhSendCmd } from './cdp.js';
import { bhAttach, bhCdp } from './lifecycle.js';
import _BH_PAGE_SRC from './injected/page-helpers.bhinject';

// Keep the old name as an alias so the snap/JS-click expressions don't
// need to change shape -- they still call findTarget via the returned
// object.
const _BH_INTERACTIVE_SRC = _BH_PAGE_SRC + '.findTarget';

// Snap a vision-LLM-supplied (x, y) to the center of the largest visible
// quad of the nearest interactive ancestor. Single Runtime.evaluate (vs.
// the previous 3-call pipeline) so getEventListeners() is in scope.
// Returns {x, y, snapped, tag, role, via, occluded} on success; falls back
// to raw (x, y) on any error. If the page-side heuristic returns null,
// _bhAxFallback consults the CDP accessibility tree for the same point --
// catches custom Web Components and AX-only interactivity. Bounded to 3s
// total (allows for AX fallback + box-model lookup).
export async function _bhSnapToInteractive(tabId, x, y) {
  const fallback = { x, y, snapped: false };
  const deadline = new Promise((resolve) => setTimeout(() => resolve(fallback), 3000));
  const work = (async () => {
    const expr = `
      (() => {
        const findTarget = ${_BH_INTERACTIVE_SRC};
        const target = findTarget(${Math.round(x)}, ${Math.round(y)});
        if (!target) return null;
        // Multi-quad selection: getClientRects() returns one rect per
        // line for inline-wrapped elements (e.g. links spanning two
        // lines). The center of getBoundingClientRect() can land in dead
        // space between lines. Pick the largest quad that intersects the
        // viewport so the click lands on actual rendered content.
        const rects = target.getClientRects();
        if (!rects || rects.length === 0) {
          const br = target.getBoundingClientRect();
          if (!br || br.width <= 0 || br.height <= 0) return null;
          var cx = br.left + br.width / 2;
          var cy = br.top + br.height / 2;
        } else {
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
          if (!best) return null;
          var cx = best.left + best.width / 2;
          var cy = best.top + best.height / 2;
        }
        // Occlusion check: confirm the topmost paint layer at (cx, cy) is
        // the target or one of its descendants. If something else is on
        // top (cookie banner, modal scrim), CDP coordinate-clicking would
        // hit the overlay, not the target. The caller routes occluded
        // clicks to the JS-click fallback (target.click()) which bypasses
        // hit-testing.
        let occluded = false;
        try {
          const topmost = document.elementFromPoint(cx, cy);
          if (topmost && !target.contains(topmost)) occluded = true;
        } catch (_) {}
        const role = target.getAttribute('role') || null;
        const tag = target.tagName;
        // Approximate which tier matched -- only used for logging.
        const STRICT_TAGS = /^(A|BUTTON|SELECT|TEXTAREA|OPTION|OPTGROUP|SUMMARY|DETAILS|AREA|MAP|INPUT|LABEL|SPAN)$/;
        const role_rx = /^(button|link|tab|menuitem|checkbox|radio|switch|option|combobox|menuitemcheckbox|menuitemradio|treeitem|listbox|textbox|slider|spinbutton|search|searchbox|row|cell|gridcell)$/i;
        const hasEventAttr = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup'].some(a => target.hasAttribute(a));
        const isStrictGuess = STRICT_TAGS.test(tag) || hasEventAttr || (role && role_rx.test(role)) || target.isContentEditable;
        return { cx, cy, tag, role, via: isStrictGuess ? 'strict' : 'pointer', occluded };
      })()
    `;
    try {
      const r = await bhCdp(
        tabId,
        'Runtime.evaluate',
        { expression: expr, returnByValue: true, includeCommandLineAPI: true },
        { timeoutMs: 1500 },
      );
      if (r && r.exceptionDetails) return await _bhAxFallback(tabId, x, y) || fallback;
      const v = r && r.result && r.result.value;
      if (v && Number.isFinite(v.cx) && Number.isFinite(v.cy)) {
        return {
          x: v.cx, y: v.cy, snapped: true,
          tag: v.tag, role: v.role, via: v.via,
          occluded: !!v.occluded,
        };
      }
      // Page-side heuristic missed -- try the CDP AX tree before giving up.
      const ax = await _bhAxFallback(tabId, x, y);
      return ax || fallback;
    } catch {
      const ax = await _bhAxFallback(tabId, x, y);
      return ax || fallback;
    }
  })();
  return Promise.race([work, deadline]);
}

// AX-tree fallback. Runs only when the page-side findTarget returned null
// (the strict + cursor:pointer heuristic missed). Asks Chrome's accessibility
// tree what's at (x, y) -- this captures custom Web Components, AX-only
// roles, and elements where the framework attached interactivity in a way
// that DOM-attribute / cursor-style heuristics can't see.
async function _bhAxFallback(tabId, x, y) {
  let leafBackendNodeId;
  try {
    const r = await bhCdp(
      tabId,
      'DOM.getNodeForLocation',
      { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false },
      { timeoutMs: 1000 },
    );
    leafBackendNodeId = r && r.backendNodeId;
  } catch { return null; }
  if (!leafBackendNodeId) return null;

  let axNodes;
  try {
    const r = await bhCdp(
      tabId,
      'Accessibility.getAXNodeAndAncestors',
      { backendNodeId: leafBackendNodeId },
      { timeoutMs: 1500 },
    );
    axNodes = r && r.nodes;
  } catch { return null; }
  if (!axNodes || !axNodes.length) return null;

  // Walk leaf -> root; first interactive AX node with a backing DOM node wins.
  for (const ax of axNodes) {
    if (!ax || ax.ignored) continue;
    const role = ax.role && ax.role.value;
    if (!role || !_BH_AX_INTERACTIVE_ROLES.has(role)) continue;
    const bnid = ax.backendDOMNodeId;
    if (!bnid) continue;
    try {
      const box = await bhCdp(
        tabId,
        'DOM.getBoxModel',
        { backendNodeId: bnid },
        { timeoutMs: 1000 },
      );
      const m = box && box.model && box.model.content;
      if (m && m.length >= 8) {
        // content quad: [x1,y1,x2,y2,x3,y3,x4,y4] -> centroid
        const cx = (m[0] + m[2] + m[4] + m[6]) / 4;
        const cy = (m[1] + m[3] + m[5] + m[7]) / 4;
        return {
          x: cx, y: cy, snapped: true,
          tag: 'AX', role,
          via: 'ax',
          occluded: false, // AX path doesn't compute occlusion; click and see
        };
      }
    } catch { /* try next ancestor */ }
  }
  return null;
}

// JS-click fallback. Mirrors browser_use's `Runtime.callFunctionOn` with
// `function() { this.click(); }` when CDP coordinate dispatch fails or is
// occluded. We re-locate the target via elementFromPoint at the snap
// coordinates rather than carrying an objectId across the click sequence.
// Returns true if a target was found and click() was invoked.
export async function _bhJsClickFallback(tabId, x, y) {
  const expr = `
    (() => {
      try {
        const findTarget = ${_BH_INTERACTIVE_SRC};
        const target = findTarget(${Math.round(x)}, ${Math.round(y)});
        if (!target || typeof target.click !== 'function') return false;
        target.click();
        return true;
      } catch (_) { return false; }
    })()
  `;
  try {
    const r = await bhCdp(
      tabId,
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, includeCommandLineAPI: true },
      { timeoutMs: 2000 },
    );
    return !!(r && r.result && r.result.value === true);
  } catch {
    return false;
  }
}

// Enumerate cross-origin (out-of-process) iframe contents via per-frame
// CDP sessions. Same-origin iframes are already walked by the parent's
// page-side enumerate via iframe.contentDocument; cross-origin iframes
// throw SecurityError on contentDocument access, so we attach to their
// CDP target separately and run the same enumerate page-side in the
// iframe's execution context. Translates frame-local bboxes back to
// parent-viewport coords using Page.getFrameOwner + DOM.getBoxModel on
// the parent's session.
async function _bhEnumerateCrossOriginFrames(tabId) {
  let parentOrigin = null;
  try {
    const t = await chrome.tabs.get(tabId);
    if (t && t.url) parentOrigin = new URL(t.url).origin;
  } catch (_) {}

  let targets;
  try {
    const r = await bhCdp(tabId, 'Target.getTargets', {}, { timeoutMs: 1500 });
    targets = (r && r.targetInfos) || [];
  } catch (_) { return []; }

  const out = [];
  for (const t of targets) {
    if (t.type !== 'iframe') continue;
    if (!t.url) continue;
    let frameOrigin = null;
    try { frameOrigin = new URL(t.url).origin; } catch (_) { continue; }
    if (parentOrigin && frameOrigin === parentOrigin) continue; // same-origin -- parent already walked

    // Iframe's bbox in parent-viewport coords. Page.getFrameOwner takes
    // the frameId; for OOPIFs the targetId equals the frameId.
    let frameOffset = null;
    try {
      const ownerInfo = await bhCdp(tabId, 'Page.getFrameOwner', { frameId: t.targetId }, { timeoutMs: 1000 });
      const bnid = ownerInfo && ownerInfo.backendNodeId;
      if (!bnid) continue;
      const box = await bhCdp(tabId, 'DOM.getBoxModel', { backendNodeId: bnid }, { timeoutMs: 1000 });
      const m = box && box.model && box.model.content;
      if (m && m.length >= 8) {
        frameOffset = { x: m[0], y: m[1] }; // top-left of content quad
      }
    } catch (_) { continue; }
    if (!frameOffset) continue;

    // Attach to the iframe target and enable the domains we use.
    if (!BH_ATTACHED.has(t.targetId)) {
      try {
        await chrome.debugger.attach({ targetId: t.targetId }, BH_DEBUGGER_VERSION);
        BH_ATTACHED.add(t.targetId);
        for (const d of ['Runtime', 'DOM', 'Page']) {
          try { await _bhSendCmd({ targetId: t.targetId }, `${d}.enable`); } catch {}
        }
      } catch (_) { continue; }
    }

    // Run the same enumerate page-side in the iframe target. Use
    // onlyViewport:false because the iframe's viewport may extend past
    // the parent's; we filter to the parent viewport ourselves below.
    let frameResult = null;
    try {
      const expr = `${_BH_PAGE_SRC}.enumerate({ onlyViewport: false, maxIndexes: 50 })`;
      const r = await _bhSendCmd(
        { targetId: t.targetId },
        'Runtime.evaluate',
        { expression: expr, returnByValue: true, includeCommandLineAPI: true },
        3000,
      );
      if (r && !r.exceptionDetails) {
        frameResult = r && r.result && r.result.value;
      }
    } catch (_) { continue; }
    if (!frameResult || !Array.isArray(frameResult.items)) continue;

    // Translate frame-local bboxes to parent-viewport.
    for (const it of frameResult.items) {
      const px = it.bbox.x + frameOffset.x;
      const py = it.bbox.y + frameOffset.y;
      out.push({
        ...it,
        bbox: { x: px, y: py, w: it.bbox.w, h: it.bbox.h },
        crossOrigin: true,
        targetId: t.targetId,
        frameLocalIdx: it.idx,
      });
    }
  }
  return out;
}

// Enumerate every interactive, visible, in-viewport element on the page
// and return {items, structurals, ...}. Live element references are cached
// page-side at window.__bhInteractive[idx] so a follow-up click_index
// action can resolve the index back to a DOM node without round-tripping a
// backendNodeId. Bounded to 5s -- on 10k-element pages this can take a
// couple seconds (querySelectorAll('*') + per-element heuristic). Returns
// null on failure / timeout.
export async function bhEnumerateInteractive(tabId, opts = {}) {
  await bhAttach(tabId);
  const onlyViewport = opts.onlyViewport !== false;
  const expr = `${_BH_PAGE_SRC}.enumerate({ onlyViewport: ${onlyViewport ? 'true' : 'false'} })`;
  let result;
  try {
    const r = await bhCdp(
      tabId,
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, includeCommandLineAPI: true },
      { timeoutMs: 5000 },
    );
    if (r && r.exceptionDetails) {
      const msg = (r.exceptionDetails.exception && r.exceptionDetails.exception.description)
        || r.exceptionDetails.text || 'enumerate failed';
      console.warn('[BrowserHarness] enumerate exception:', msg);
      return null;
    }
    result = r && r.result && r.result.value;
    if (!result) return null;
  } catch (e) {
    console.warn('[BrowserHarness] enumerate failed:', e.message);
    return null;
  }

  // Append cross-origin iframe contents. Best-effort: if any per-frame
  // attach fails, that frame is silently skipped; the same-origin items
  // are still returned.
  let crossItems = [];
  try {
    crossItems = await _bhEnumerateCrossOriginFrames(tabId);
  } catch (e) {
    console.warn('[BrowserHarness] cross-origin enumerate failed:', e.message);
  }
  if (crossItems.length) {
    const baseIdx = result.items.length;
    const placeholders = [];
    for (let i = 0; i < crossItems.length; i++) {
      const ci = crossItems[i];
      const idx = baseIdx + i;
      ci.idx = idx;
      ci.id = 'i' + idx;
      ci.kind = 'indexed';
      ci.parent_id = null; // cross-origin -- top-level in the rendered tree
      ci.inIframe = true;
      result.items.push(ci);
      placeholders.push({
        __crossOrigin: true,
        bbox: ci.bbox,
        tag: ci.tag,
        role: (ci.attrs && ci.attrs.role) || null,
      });
    }
    // Pad the parent's window.__bhInteractive with placeholder objects
    // so click_index page-side can detect cross-origin and route the
    // click via parent CDP coordinates (which propagate through OOPIFs
    // at the compositor level).
    const padExpr = `(() => {
      const a = window.__bhInteractive || [];
      const p = ${JSON.stringify(placeholders)};
      for (let i = 0; i < p.length; i++) a.push(p[i]);
      window.__bhInteractive = a;
      const o = window.__bhInteractiveOffset || [];
      for (let i = 0; i < p.length; i++) o.push({x:0, y:0});
      window.__bhInteractiveOffset = o;
      return a.length;
    })()`;
    try {
      await bhCdp(tabId, 'Runtime.evaluate', { expression: padExpr, returnByValue: true }, { timeoutMs: 1500 });
    } catch (e) {
      console.warn('[BrowserHarness] cross-origin pad failed:', e.message);
    }
    result.crossOriginCount = crossItems.length;
  }
  // Snapshot for stale-index recovery (see _bhResolveStaleByIdentity).
  if (Array.isArray(result.items)) _BH_LAST_ITEMS.set(tabId, result.items);
  return result;
}
