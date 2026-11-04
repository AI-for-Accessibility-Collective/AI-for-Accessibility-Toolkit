// bigger-targets.js — Enlarges small links, buttons and form controls to meet target size.
// Barrier: People with motor differences, tremors, reduced fine dexterity, older adults,
// or people using eye-gaze or head-pointer inputs struggle or fail to hit small interactive controls.
//
// Suggested in onboarding for: motor (a suggestion only, never a gate).
// The person's settings it reads: targetSize, bigTargets.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Target size',
//   settings ['targetSize']): up and down step targetSize through 24, 32, 44 pixels,
//   saved for this site and announced.
//
// Options:
//   targetSize: Smallest size of an interactive target in CSS pixels (default 24, WCAG 2.5.8; 44 is WCAG 2.5.5).
//   bigTargets: Boolean, whether target enlargement is active (default true).
//
// Decisions:
//   • Measures before it changes anything: each interactive control (links, buttons, form controls,
//     and elements with an interactive role) is evaluated once and only grown if smaller than targetSize.
//   • If nothing is too small on the page or bigTargets is turned off, enable() ends the session and returns false.
//   • Prefers growing the hit area without moving surrounding content:
//     - Buttons, form controls and non-inline elements receive min-width/min-height with margin offsets in normal flow.
//     - Checked afterwards: if direct sizing causes container overflow or pushes past document bounds,
//       direct sizing is undone on elements supporting pseudo-elements and falls back to an expanded pseudo-element hit area (::after, or ::before if author ::after exists).
//     - SVG controls reach targetSize and receive an HTML hit overlay placed over them so their hit area is accessible even in clipped containers.
//     - Text links and inline controls keep their visual layout and text flow; inline links in running text receive spacing; an invisible pseudo-element
//       expands their clickable hit area into available free space without affecting line height.
//     - Checkboxes and radios reach targetSize at any size asked for (24, 32, 44) with margin offsets so native inputs stay hit-accessible without layout shift.
//     - Absolutely and fixed positioned controls, as well as SVG controls, reach targetSize at every size.
//     - Leaves the page's pointer-events alone; a <label> is a target only when it labels a control,
//       and never both it and its control.
//   • Overlap prevention: hit areas expand only into available free space and take at most half the gap
//     between neighbouring interactive elements, guaranteeing targets never cover each other.
//   • Neighbours are what is near on screen, not only siblings, measured in document-relative coordinates, also for what is added later.
//   • Dynamic content: elements added later come in batches (s.watch.added with { batch: true }).
//     The batch and targets near it on screen are measured once and adjusted without redoing existing targets, ensuring existing hit areas never cover newly added targets.
//   • Size adjustment: a new targetSize redoes all sizes in a fresh s.group(), cleanly undoing previous sizing.
//   • Pure target sizing: nothing outside its job (no focus styles).
//
// What it cannot do:
//   • Cannot expand targets within cross-origin or canvas-drawn interfaces that do not expose DOM elements.
//   • Cannot extend hit areas outside the viewport or beyond clipping ancestor bounds.

const TARGET_SELECTORS = [
  'a[href]',
  'area[href]',
  '[role="link"]',
  'button',
  '[role="button"]',
  'summary',
  'input',
  'select',
  'textarea',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="treeitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex^="-"])',
  'svg[role="button"]',
  'svg[role="link"]',
  'svg[onclick]',
  'svg[tabindex]:not([tabindex^="-"])',
  'label',
];
const TARGET_QUERY = TARGET_SELECTORS.join(',');

const NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|SVG|OBJECT|EMBED)$/i;
const BOX_TYPES = /^(checkbox|radio)$/i;
const NO_GROW_TYPES = /^(hidden|range|file|color|image)$/i;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/i;

const SIZES = [24, 32, 44];

function isInsideLinkOrButton(el) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const tag = p.tagName;
    if ((tag === 'A' && p.hasAttribute('href')) || tag === 'BUTTON') return true;
    const role = p.getAttribute('role');
    if (role === 'button' || role === 'link') return true;
    p = p.parentElement;
  }
  return false;
}

function getDocRect(el) {
  const r = el.getBoundingClientRect();
  const sx = window.scrollX || window.pageXOffset || 0;
  const sy = window.scrollY || window.pageYOffset || 0;
  return {
    top: r.top + sy,
    bottom: r.bottom + sy,
    left: r.left + sx,
    right: r.right + sx,
    width: r.width,
    height: r.height,
  };
}

function isCandidate(el, s) {
  if (!el || !el.isConnected) return false;
  if (el.closest && el.closest('[data-ai4a11y-ui]')) return false;
  if (s && s.page && s.page.isOurs && s.page.isOurs(el)) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'INPUT' && type === 'hidden') return false;

  if (isInsideLinkOrButton(el)) return false;

  if (tag === 'LABEL') {
    // A <label> is a target only when it labels a control, and never both it and its control.
    const control = el.control || (el.htmlFor ? document.getElementById(el.htmlFor) : el.querySelector('input, select, textarea, button'));
    if (!control) return false;
    // If the associated control is connected and perceivable, the control will be the target.
    if (control.isConnected && !control.disabled && control.getAttribute('aria-disabled') !== 'true') {
      let ccs;
      try { ccs = window.getComputedStyle(control); } catch { return false; }
      if (ccs.display !== 'none' && ccs.visibility !== 'hidden' && parseFloat(ccs.opacity) > 0) {
        return false;
      }
    }
  }

  let cs;
  try { cs = window.getComputedStyle(el); } catch { return false; }
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') return false;
  if (parseFloat(cs.opacity) === 0) return false;
  if (cs.pointerEvents === 'none') return false;

  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;

  return true;
}

let cachedAutoRules = null;
function getAutoRules() {
  if (cachedAutoRules) return cachedAutoRules;
  const autoRules = [];
  try {
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.hasAttribute && sheet.ownerNode.hasAttribute('data-ai4a11y-bt')) continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (!rule.selectorText || !rule.style) continue;
        const style = rule.style;
        const hasAuto = style.marginLeft === 'auto' || style.marginRight === 'auto' || style.marginTop === 'auto' || style.marginBottom === 'auto' || (style.margin && style.margin.includes('auto'));
        if (hasAuto) autoRules.push(rule);
      }
    }
  } catch {}
  return (cachedAutoRules = autoRules);
}

function getAutoMargins(el) {
  const res = { mt: false, mr: false, mb: false, ml: false };
  if (!el || el.nodeType !== 1) return res;
  const s = el.style;
  if (s) {
    if (s.marginLeft === 'auto') res.ml = true;
    if (s.marginRight === 'auto') res.mr = true;
    if (s.marginTop === 'auto') res.mt = true;
    if (s.marginBottom === 'auto') res.mb = true;
    if (s.margin && s.margin.includes('auto')) {
      const parts = s.margin.split(/\s+/).filter(Boolean);
      if (parts.length === 1 && parts[0] === 'auto') { res.mt = res.mr = res.mb = res.ml = true; }
      else if (parts.length === 2) {
        if (parts[0] === 'auto') { res.mt = res.mb = true; }
        if (parts[1] === 'auto') { res.ml = res.mr = true; }
      } else if (parts.length === 3) {
        if (parts[0] === 'auto') res.mt = true;
        if (parts[1] === 'auto') res.ml = res.mr = true;
        if (parts[2] === 'auto') res.mb = true;
      } else if (parts.length === 4) {
        if (parts[0] === 'auto') res.mt = true;
        if (parts[1] === 'auto') res.mr = true;
        if (parts[2] === 'auto') res.mb = true;
        if (parts[3] === 'auto') res.ml = true;
      }
    }
  }
  if (res.ml && res.mr && res.mt && res.mb) return res;
  const autoRules = getAutoRules();
  for (const rule of autoRules) {
    try {
      if (el.matches(rule.selectorText)) {
        const rStyle = rule.style;
        if (rStyle.marginLeft === 'auto') res.ml = true;
        if (rStyle.marginRight === 'auto') res.mr = true;
        if (rStyle.marginTop === 'auto') res.mt = true;
        if (rStyle.marginBottom === 'auto') res.mb = true;
        if (rStyle.margin && rStyle.margin.includes('auto')) {
          const parts = rStyle.margin.split(/\s+/).filter(Boolean);
          if (parts.length === 1 && parts[0] === 'auto') { res.mt = res.mr = res.mb = res.ml = true; }
          else if (parts.length === 2) {
            if (parts[0] === 'auto') { res.mt = res.mb = true; }
            if (parts[1] === 'auto') { res.ml = res.mr = true; }
          } else if (parts.length === 3) {
            if (parts[0] === 'auto') res.mt = true;
            if (parts[1] === 'auto') res.ml = res.mr = true;
            if (parts[2] === 'auto') res.mb = true;
          } else if (parts.length === 4) {
            if (parts[0] === 'auto') res.mt = true;
            if (parts[1] === 'auto') res.mr = true;
            if (parts[2] === 'auto') res.mb = true;
            if (parts[3] === 'auto') res.ml = true;
          }
        }
      }
    } catch {}
  }
  return res;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const personal = s.profile.get() || {};

    if (personal.bigTargets === false || options.bigTargets === false) {
      this.disable();
      return false;
    }

    let currentTargetSize = Number(personal.targetSize || options.targetSize || 24);
    if (!Number.isFinite(currentTargetSize) || currentTargetSize <= 0) currentTargetSize = 24;

    const root = document.body || document.documentElement;
    if (!root) {
      this.disable();
      return false;
    }

    let anySmall = false;
    for (const el of root.querySelectorAll(TARGET_QUERY)) {
      if (isCandidate(el, s)) {
        const r = el.getBoundingClientRect();
        if (r.width < currentTargetSize || r.height < currentTargetSize) {
          anySmall = true;
          break;
        }
      }
    }

    if (!anySmall) {
      this.disable();
      return false;
    }

    let sizeGroup = null;
    let nextHitId = 1;
    let dynamicRules = new Map();
    let dynamicStyle = null;
    const processed = new WeakSet();
    const allKnownTargets = [];

    const mark = (el, token) => {
      const cur = el.getAttribute('data-ai4a11y-bt') || '';
      const tokens = new Set(cur.split(/\s+/).filter(Boolean));
      for (const t of token.split(/\s+/).filter(Boolean)) tokens.add(t);
      const next = [...tokens].join(' ');
      if (next !== cur) sizeGroup.setAttr(el, 'data-ai4a11y-bt', next);
    };

    const unmark = (el, token) => {
      const cur = el.getAttribute('data-ai4a11y-bt') || '';
      const tokens = new Set(cur.split(/\s+/).filter(Boolean));
      for (const t of token.split(/\s+/).filter(Boolean)) tokens.delete(t);
      const next = [...tokens].join(' ');
      sizeGroup.setAttr(el, 'data-ai4a11y-bt', next || null);
    };

    const createOverlay = (el, cs, MIN) => {
      let id = el.getAttribute('data-ai4a11y-bt-id');
      if (!id) {
        id = String(nextHitId++);
        sizeGroup.setAttr(el, 'data-ai4a11y-bt-id', id);
      }

      const r = el.getBoundingClientRect();
      const isFixed = cs.position === 'fixed' || (function hasFixedAncestor(node) {
        let p = node.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          try {
            if (window.getComputedStyle(p).position === 'fixed') return true;
          } catch { break; }
          p = p.parentElement;
        }
        return false;
      })(el);

      const docR = getDocRect(el);
      const wantX = Math.max(0, MIN - r.width);
      const wantY = Math.max(0, MIN - r.height);
      const idealLeft = Math.floor(wantX / 2);
      const idealRight = Math.ceil(wantX / 2);
      const idealTop = Math.floor(wantY / 2);
      const idealBottom = Math.ceil(wantY / 2);

      let maxClearLeft = wantX;
      let maxClearRight = wantX;
      let maxClearTop = wantY;
      let maxClearBottom = wantY;

      const rTopBound = docR.top - MIN;
      const rBottomBound = docR.bottom + MIN;
      const rLeftBound = docR.left - MIN;
      const rRightBound = docR.right + MIN;

      for (const o of allKnownTargets) {
        if (!o.el.isConnected) continue;
        if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
        const q = o.r;
        if (q.bottom < rTopBound || q.top > rBottomBound || q.right < rLeftBound || q.left > rRightBound) continue;
        const overlapX = q.left < docR.right + wantX && q.right > docR.left - wantX;
        const overlapY = q.top < docR.bottom + wantY && q.bottom > docR.top - wantY;

        const shareX = (q.width < MIN) && !processed.has(o.el);
        const shareY = (q.height < MIN) && !processed.has(o.el);

        if (overlapX && q.bottom <= docR.top + 0.5) {
          const gap = Math.max(0, docR.top - q.bottom);
          maxClearTop = Math.min(maxClearTop, shareY ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapX && q.top >= docR.bottom - 0.5) {
          const gap = Math.max(0, q.top - docR.bottom);
          maxClearBottom = Math.min(maxClearBottom, shareY ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapY && q.right <= docR.left + 0.5) {
          const gap = Math.max(0, docR.left - q.right);
          maxClearLeft = Math.min(maxClearLeft, shareX ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapY && q.left >= docR.right - 0.5) {
          const gap = Math.max(0, q.left - docR.right);
          maxClearRight = Math.min(maxClearRight, shareX ? Math.floor(gap / 2) : Math.floor(gap));
        }
      }

      let left = Math.min(idealLeft, maxClearLeft);
      let right = Math.min(idealRight, maxClearRight);
      if (left + right < wantX) {
        if (right < idealRight) left = Math.min(maxClearLeft, wantX - right);
        else if (left < idealLeft) right = Math.min(maxClearRight, wantX - left);
      }

      let top = Math.min(idealTop, maxClearTop);
      let bottom = Math.min(idealBottom, maxClearBottom);
      if (top + bottom < wantY) {
        if (bottom < idealBottom) top = Math.min(maxClearTop, wantY - bottom);
        else if (top < idealTop) bottom = Math.min(maxClearBottom, wantY - top);
      }

      let targetContainer = isFixed ? document.body : el.parentElement;
      while (!isFixed && targetContainer && targetContainer !== document.body) {
        let sBox;
        try { sBox = window.getComputedStyle(targetContainer); } catch { break; }
        const clips = sBox.overflowX === 'hidden' || sBox.overflowY === 'hidden';
        if (clips && (targetContainer.clientWidth < MIN || targetContainer.clientHeight < MIN)) {
          targetContainer = targetContainer.parentElement;
        } else {
          break;
        }
      }
      if (!targetContainer) targetContainer = isFixed ? document.body : (el.parentElement || document.body);

      if (!isFixed && targetContainer !== document.body) {
        let cCs;
        try { cCs = window.getComputedStyle(targetContainer); } catch {}
        if (cCs && cCs.position === 'static') {
          mark(targetContainer, 'rel');
        }
      }

      let oTop, oLeft, oWidth, oHeight;
      if (isFixed || targetContainer === document.body) {
        const baseX = isFixed ? r.left : docR.left;
        const baseY = isFixed ? r.top : docR.top;
        oTop = baseY - top;
        oLeft = baseX - left;
        oWidth = r.width + left + right;
        oHeight = r.height + top + bottom;
      } else {
        const parentR = targetContainer.getBoundingClientRect();
        const baseLeft = (r.left - parentR.left) - targetContainer.clientLeft + targetContainer.scrollLeft;
        const baseTop = (r.top - parentR.top) - targetContainer.clientTop + targetContainer.scrollTop;
        oTop = baseTop - top;
        oLeft = baseLeft - left;
        oWidth = r.width + left + right;
        oHeight = r.height + top + bottom;
      }

      let overlay = document.querySelector(`[data-ai4a11y-bt-overlay-for="${id}"]`);
      if (overlay) {
        overlay.style.top = `${oTop}px`;
        overlay.style.left = `${oLeft}px`;
        overlay.style.width = `${oWidth}px`;
        overlay.style.height = `${oHeight}px`;
        return overlay;
      }

      overlay = document.createElement('span');
      overlay.setAttribute('data-ai4a11y-bt', 'overlay');
      overlay.setAttribute('data-ai4a11y-bt-overlay-for', id);
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('tabindex', '-1');

      const posType = (isFixed || targetContainer === document.body) ? (isFixed ? 'fixed' : 'absolute') : 'absolute';
      overlay.style.cssText = `position: ${posType} !important; top: ${oTop}px !important; left: ${oLeft}px !important; width: ${oWidth}px !important; height: ${oHeight}px !important; z-index: 2147483647 !important; background: transparent !important; border: none !important; padding: 0 !important; margin: 0 !important; cursor: ${cs.cursor || 'pointer'} !important;`;

      const forwardEvent = (e) => {
        el.focus();
        let evt;
        if (window.PointerEvent && e instanceof PointerEvent) {
          evt = new PointerEvent(e.type, {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: e.detail,
            screenX: e.screenX,
            screenY: e.screenY,
            clientX: e.clientX,
            clientY: e.clientY,
            pointerId: e.pointerId,
            width: e.width,
            height: e.height,
            pressure: e.pressure,
            tiltX: e.tiltX,
            tiltY: e.tiltY,
            pointerType: e.pointerType,
            isPrimary: e.isPrimary,
          });
        } else if (e instanceof MouseEvent) {
          evt = new MouseEvent(e.type, {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: e.detail,
            screenX: e.screenX,
            screenY: e.screenY,
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            buttons: e.buttons,
          });
        }
        if (evt) el.dispatchEvent(evt);
      };

      sizeGroup.listen(overlay, 'pointerdown', forwardEvent);
      sizeGroup.listen(overlay, 'mousedown', forwardEvent);
      sizeGroup.listen(overlay, 'pointerup', forwardEvent);
      sizeGroup.listen(overlay, 'mouseup', forwardEvent);
      sizeGroup.listen(overlay, 'click', (e) => {
        el.focus();
        el.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: e.detail,
          screenX: e.screenX,
          screenY: e.screenY,
          clientX: e.clientX,
          clientY: e.clientY,
        }));
      });

      sizeGroup.insert(targetContainer, overlay, targetContainer === el.parentElement ? el.nextSibling : null);
      return overlay;
    };

    const computeHit = (el, cs, MIN) => {
      const r = el.getBoundingClientRect();
      if (r.width >= MIN && r.height >= MIN) return;
      if (el.getClientRects && el.getClientRects().length > 1) return;

      const isClippedBySelf = cs.overflow !== 'visible';
      if (NO_PSEUDO.test(el.tagName) || isClippedBySelf) {
        createOverlay(el, cs, MIN);
        return;
      }

      let csAfter, csBefore;
      try {
        csAfter = window.getComputedStyle(el, '::after');
        csBefore = window.getComputedStyle(el, '::before');
      } catch { return; }

      const hasAfter = csAfter && csAfter.content && csAfter.content !== 'none' && csAfter.content !== 'normal' && csAfter.content !== '""' && csAfter.content !== "''";
      let pseudo = 'after';
      if (hasAfter) {
        const hasBefore = csBefore && csBefore.content && csBefore.content !== 'none' && csBefore.content !== 'normal' && csBefore.content !== '""' && csBefore.content !== "''";
        if (hasBefore) return;
        pseudo = 'before';
      }

      const wantX = Math.max(0, MIN - r.width);
      const wantY = Math.max(0, MIN - r.height);
      const idealLeft = Math.floor(wantX / 2);
      const idealRight = Math.ceil(wantX / 2);
      const idealTop = Math.floor(wantY / 2);
      const idealBottom = Math.ceil(wantY / 2);

      let maxClearLeft = wantX;
      let maxClearRight = wantX;
      let maxClearTop = wantY;
      let maxClearBottom = wantY;

      const docR = getDocRect(el);
      const rTopBound = docR.top - MIN;
      const rBottomBound = docR.bottom + MIN;
      const rLeftBound = docR.left - MIN;
      const rRightBound = docR.right + MIN;

      for (const o of allKnownTargets) {
        if (!o.el.isConnected) continue;
        if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
        const q = o.r;
        if (q.bottom < rTopBound || q.top > rBottomBound || q.right < rLeftBound || q.left > rRightBound) {
          continue;
        }

        const overlapX = q.left < docR.right + wantX && q.right > docR.left - wantX;
        const overlapY = q.top < docR.bottom + wantY && q.bottom > docR.top - wantY;

        const shareX = (q.width < MIN) && !processed.has(o.el);
        const shareY = (q.height < MIN) && !processed.has(o.el);

        if (overlapX && q.bottom <= docR.top + 0.5) {
          const gap = Math.max(0, docR.top - q.bottom);
          maxClearTop = Math.min(maxClearTop, shareY ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapX && q.top >= docR.bottom - 0.5) {
          const gap = Math.max(0, q.top - docR.bottom);
          maxClearBottom = Math.min(maxClearBottom, shareY ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapY && q.right <= docR.left + 0.5) {
          const gap = Math.max(0, docR.left - q.right);
          maxClearLeft = Math.min(maxClearLeft, shareX ? Math.floor(gap / 2) : Math.floor(gap));
        }
        if (overlapY && q.left >= docR.right - 0.5) {
          const gap = Math.max(0, q.left - docR.right);
          maxClearRight = Math.min(maxClearRight, shareX ? Math.floor(gap / 2) : Math.floor(gap));
        }
      }

      let left = Math.min(idealLeft, maxClearLeft);
      let right = Math.min(idealRight, maxClearRight);
      if (left + right < wantX) {
        if (right < idealRight) left = Math.min(maxClearLeft, wantX - right);
        else if (left < idealLeft) right = Math.min(maxClearRight, wantX - left);
      }

      let top = Math.min(idealTop, maxClearTop);
      let bottom = Math.min(idealBottom, maxClearBottom);
      if (top + bottom < wantY) {
        if (bottom < idealBottom) top = Math.min(maxClearTop, wantY - bottom);
        else if (top < idealTop) bottom = Math.min(maxClearBottom, wantY - top);
      }

      const docEl = document.documentElement;
      const docW = docEl.clientWidth;
      let box = { left: 0, right: docW, top: -window.scrollY, bottom: docEl.scrollHeight - window.scrollY };
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) {
          let sBox;
          try { sBox = window.getComputedStyle(a); } catch { break; }
          if (sBox.overflowX !== 'visible' || sBox.overflowY !== 'visible') {
            const ar = a.getBoundingClientRect();
            const x0 = ar.left + a.clientLeft;
            const y0 = ar.top + a.clientTop;
            box = { left: x0, right: x0 + a.clientWidth, top: y0, bottom: y0 + a.clientHeight };
            break;
          }
        }
      }

      const px = (v) => Math.max(0, Math.floor(v));
      const t = px(Math.min(top, r.top - box.top));
      const b = px(Math.min(bottom, box.bottom - r.bottom));
      const l = px(Math.min(left, r.left - box.left));
      const rt = px(Math.min(right, box.right - r.right));

      let id = el.getAttribute('data-ai4a11y-bt-id');
      if (!id) {
        id = String(nextHitId++);
        sizeGroup.setAttr(el, 'data-ai4a11y-bt-id', id);
      }
      mark(el, cs.position === 'static' ? 'hit rel' : 'hit');
      dynamicRules.set(id, `[data-ai4a11y-bt-id="${id}"]::${pseudo} { content: "" !important; position: absolute !important; top: -${t}px; right: -${rt}px; bottom: -${b}px; left: -${l}px; }`);
    };

    const processItems = (targets, MIN) => {
      if (!targets.length) return;
      const docEl = document.documentElement;
      const docW = docEl.clientWidth;
      const docSW = docEl.scrollWidth;

      const items = [];
      for (const el of targets) {
        processed.add(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const entry = { el, r: getDocRect(el) };
        allKnownTargets.push(entry);

        let cs;
        try { cs = window.getComputedStyle(el); } catch { continue; }
        const tag = el.tagName.toUpperCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const isBox = tag === 'INPUT' && BOX_TYPES.test(type);
        const small = r.width < MIN || r.height < MIN;
        if (!small) continue;
        items.push({ el, cs, r, tag, type, isBox, entry });
      }

      if (!items.length) return;

      const grown = [];
      for (const it of items) {
        const { el, cs, r, tag, type, isBox } = it;
        let id = el.getAttribute('data-ai4a11y-bt-id');
        if (!id) {
          id = String(nextHitId++);
          sizeGroup.setAttr(el, 'data-ai4a11y-bt-id', id);
        }
        it.id = id;

        const wantX = Math.max(0, MIN - r.width);
        const wantY = Math.max(0, MIN - r.height);
        let idealLeft = Math.floor(wantX / 2);
        let idealRight = Math.ceil(wantX / 2);
        let idealTop = Math.floor(wantY / 2);
        let idealBottom = Math.ceil(wantY / 2);

        let maxClearLeft = wantX;
        let maxClearRight = wantX;
        let maxClearTop = wantY;
        let maxClearBottom = wantY;

        const docR = it.entry.r;
        const rTopBound = docR.top - MIN;
        const rBottomBound = docR.bottom + MIN;
        const rLeftBound = docR.left - MIN;
        const rRightBound = docR.right + MIN;

        for (const o of allKnownTargets) {
          if (!o.el.isConnected) continue;
          if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
          const q = o.r;
          if (q.bottom < rTopBound || q.top > rBottomBound || q.right < rLeftBound || q.left > rRightBound) continue;

          const overlapX = q.left < docR.right + wantX && q.right > docR.left - wantX;
          const overlapY = q.top < docR.bottom + wantY && q.bottom > docR.top - wantY;

          const shareX = (q.width < MIN) && !processed.has(o.el);
          const shareY = (q.height < MIN) && !processed.has(o.el);

          if (overlapX && q.bottom <= docR.top + 0.5) {
            const gap = Math.max(0, docR.top - q.bottom);
            maxClearTop = Math.min(maxClearTop, shareY ? Math.floor(gap / 2) : Math.floor(gap));
          }
          if (overlapX && q.top >= docR.bottom - 0.5) {
            const gap = Math.max(0, q.top - docR.bottom);
            maxClearBottom = Math.min(maxClearBottom, shareY ? Math.floor(gap / 2) : Math.floor(gap));
          }
          if (overlapY && q.right <= docR.left + 0.5) {
            const gap = Math.max(0, docR.left - q.right);
            maxClearLeft = Math.min(maxClearLeft, shareX ? Math.floor(gap / 2) : Math.floor(gap));
          }
          if (overlapY && q.left >= docR.right - 0.5) {
            const gap = Math.max(0, q.left - docR.right);
            maxClearRight = Math.min(maxClearRight, shareX ? Math.floor(gap / 2) : Math.floor(gap));
          }
        }

        let expLeft = Math.min(idealLeft, maxClearLeft);
        let expRight = Math.min(idealRight, maxClearRight);
        if (expLeft + expRight < wantX) {
          if (expRight < idealRight) {
            expLeft = Math.min(maxClearLeft, wantX - expRight);
          } else if (expLeft < idealLeft) {
            expRight = Math.min(maxClearRight, wantX - expLeft);
          }
        }

        let expTop = Math.min(idealTop, maxClearTop);
        let expBottom = Math.min(idealBottom, maxClearBottom);
        if (expTop + expBottom < wantY) {
          if (expBottom < idealBottom) {
            expTop = Math.min(maxClearTop, wantY - expBottom);
          } else if (expTop < idealTop) {
            expBottom = Math.min(maxClearBottom, wantY - expTop);
          }
        }

        const isOutFlow = cs.position === 'absolute' || cs.position === 'fixed';
        const curMt = parseFloat(cs.marginTop) || 0;
        const curMr = parseFloat(cs.marginRight) || 0;
        const curMb = parseFloat(cs.marginBottom) || 0;
        const curMl = parseFloat(cs.marginLeft) || 0;
        const mt = curMt - expTop;
        const mr = curMr - expRight;
        const mb = curMb - expBottom;
        const ml = curMl - expLeft;
        it.margins = { mt, mr, mb, ml, curMt, curMr, curMb, curMl, isOutFlow };
        it.autoMargins = getAutoMargins(el);

        const mtStr = it.autoMargins.mt ? 'auto' : `${mt}px`;
        const mrStr = it.autoMargins.mr ? 'auto' : `${mr}px`;
        const mbStr = it.autoMargins.mb ? 'auto' : `${mb}px`;
        const mlStr = it.autoMargins.ml ? 'auto' : `${ml}px`;
        const marginRule = isOutFlow ? '' : `margin: ${mtStr} ${mrStr} ${mbStr} ${mlStr} !important; `;

        const finalW = r.width + expLeft + expRight;
        const finalH = r.height + expTop + expBottom;

        if (isBox) {
          const p = el.parentElement;
          const g = p && p.parentElement;
          it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
          it.kind = 'box';
          mark(el, 'box');
          dynamicRules.set(id, `[data-ai4a11y-bt-id="${id}"] { width: ${MIN}px !important; height: ${MIN}px !important; min-width: ${MIN}px !important; min-height: ${MIN}px !important; flex-shrink: 0 !important; ${marginRule}vertical-align: middle !important; }`);
          it.entry.r = { left: docR.left - expLeft, right: docR.left - expLeft + MIN, top: docR.top - expTop, bottom: docR.top - expTop + MIN, width: MIN, height: MIN };
          grown.push(it);
          continue;
        }

        if (tag === 'A' && cs.display === 'inline') {
          mark(el, 'inline-link');
          it.kind = 'hit';
          continue;
        }

        if (tag !== 'SVG' && cs.display === 'inline') {
          it.kind = 'hit';
          continue;
        }

        const role = el.getAttribute('role') || '';
        const text = (el.textContent || '').trim();
        const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;

        const growable = tag !== 'SVG' && (tag === 'BUTTON' ||
          tag === 'SELECT' ||
          tag === 'SUMMARY' ||
          (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) ||
          GROW_ROLES.test(role) ||
          iconLike);

        if (growable) {
          const p = el.parentElement;
          const g = p && p.parentElement;
          it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
          it.kind = 'grow';
          mark(el, 'grow');
          dynamicRules.set(id, `[data-ai4a11y-bt-id="${id}"] { min-width: ${MIN}px !important; min-height: ${MIN}px !important; ${marginRule}}`);
          it.entry.r = { left: docR.left - expLeft, right: docR.left - expLeft + MIN, top: docR.top - expTop, bottom: docR.top - expTop + MIN, width: MIN, height: MIN };
          grown.push(it);
        } else {
          it.kind = 'hit';
        }
      }

      if (dynamicStyle) {
        dynamicStyle.update([...dynamicRules.values()].join('\n'));
      }

      if (grown.length) {
        for (const it of grown) {
          it.entry.r = getDocRect(it.el);
        }

        let updatedCollision = false;
        const undo = [];
        for (const it of grown) {
          const rNow = it.el.getBoundingClientRect();
          const pushesDoc = rNow.right > docW + 0.5 && it.r.right <= docW + 0.5;
          const isNoPseudo = NO_PSEUDO.test(it.tag);

          if (pushesDoc && isNoPseudo) {
            const overflowX = Math.ceil(rNow.right - docW);
            if (it.margins && !it.margins.isOutFlow) {
              it.margins.ml -= overflowX;
              it.margins.mr += overflowX;
              const { mt, mr, mb, ml } = it.margins;
              const mtStr = it.autoMargins?.mt ? 'auto' : `${mt}px`;
              const mrStr = it.autoMargins?.mr ? 'auto' : `${mr}px`;
              const mbStr = it.autoMargins?.mb ? 'auto' : `${mb}px`;
              const mlStr = it.autoMargins?.ml ? 'auto' : `${ml}px`;
              if (it.isBox) {
                dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { width: ${MIN}px !important; height: ${MIN}px !important; min-width: ${MIN}px !important; min-height: ${MIN}px !important; flex-shrink: 0 !important; margin: ${mtStr} ${mrStr} ${mbStr} ${mlStr} !important; vertical-align: middle !important; }`);
              } else {
                dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { min-width: ${MIN}px !important; min-height: ${MIN}px !important; margin: ${mtStr} ${mrStr} ${mbStr} ${mlStr} !important; }`);
              }
              updatedCollision = true;
            } else if (it.cs.position === 'absolute' || it.cs.position === 'fixed') {
              const curLeft = parseFloat(it.cs.left);
              if (!Number.isNaN(curLeft)) {
                const newLeft = curLeft - overflowX;
                if (it.isBox) {
                  dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { width: ${MIN}px !important; height: ${MIN}px !important; min-width: ${MIN}px !important; min-height: ${MIN}px !important; flex-shrink: 0 !important; left: ${newLeft}px !important; vertical-align: middle !important; }`);
                } else {
                  dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { min-width: ${MIN}px !important; min-height: ${MIN}px !important; left: ${newLeft}px !important; }`);
                }
                updatedCollision = true;
              } else {
                if (it.isBox) {
                  dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { width: ${MIN}px !important; height: ${MIN}px !important; min-width: ${MIN}px !important; min-height: ${MIN}px !important; flex-shrink: 0 !important; margin-left: -${overflowX}px !important; vertical-align: middle !important; }`);
                } else {
                  dynamicRules.set(it.id, `[data-ai4a11y-bt-id="${it.id}"] { min-width: ${MIN}px !important; min-height: ${MIN}px !important; margin-left: -${overflowX}px !important; }`);
                }
                updatedCollision = true;
              }
            }
            continue;
          }

          if (pushesDoc && !isNoPseudo) {
            undo.push(it);
            continue;
          }

          const overflowsContainer = it.before && it.before.some(([a, w, h]) => {
            let csA;
            try { csA = window.getComputedStyle(a); } catch { return false; }
            const clipsX = csA.overflowX !== 'visible';
            const clipsY = csA.overflowY !== 'visible';
            if (!clipsX && !clipsY) return false;
            const xOverflow = clipsX && (a.scrollWidth - a.clientWidth) > w + 1;
            const yOverflow = clipsY && (a.scrollHeight - a.clientHeight) > h + 1;
            return xOverflow || yOverflow;
          });
          if (overflowsContainer && !isNoPseudo) {
            undo.push(it);
            continue;
          }
        }

        if (updatedCollision || undo.length) {
          for (const it of undo) {
            unmark(it.el, 'grow');
            dynamicRules.delete(it.id);
            it.kind = 'hit';
          }
          if (dynamicStyle) {
            dynamicStyle.update([...dynamicRules.values()].join('\n'));
          }
        }

        for (const it of grown) {
          it.entry.r = getDocRect(it.el);
        }

        if (docEl.scrollWidth > docSW + 1) {
          let undoneMore = false;
          for (const it of grown) {
            if (it.kind === 'grow' && !NO_PSEUDO.test(it.tag)) {
              unmark(it.el, 'grow');
              dynamicRules.delete(it.id);
              it.kind = 'hit';
              undoneMore = true;
            }
          }
          if (undoneMore && dynamicStyle) {
            dynamicStyle.update([...dynamicRules.values()].join('\n'));
            for (const it of grown) {
              it.entry.r = getDocRect(it.el);
            }
          }
        }
      }

      for (const it of items) {
        if (it.tag === 'SVG') {
          createOverlay(it.el, it.cs, MIN);
        }
      }

      for (const it of items) {
        if (it.kind !== 'hit') continue;
        computeHit(it.el, it.cs, MIN);
      }

      if (dynamicStyle) {
        dynamicStyle.update([...dynamicRules.values()].join('\n'));
      }
    };

    const redoAll = () => {
      if (sizeGroup) sizeGroup.end();
      sizeGroup = s.group();
      nextHitId = 1;
      dynamicRules.clear();
      allKnownTargets.length = 0;
      cachedAutoRules = null;

      const MIN = currentTargetSize;

      sizeGroup.css(
        'base',
        `[data-ai4a11y-bt~="inline-link"] { padding-left: 2px !important; padding-right: 2px !important; }
[data-ai4a11y-bt~="rel"] { position: relative !important; }`
      );

      dynamicStyle = sizeGroup.css('dynamic', '');

      const initialTargets = [];
      for (const el of root.querySelectorAll(TARGET_QUERY)) {
        if (isCandidate(el, s)) initialTargets.push(el);
      }

      processItems(initialTargets, MIN);
    };

    redoAll();

    s.watch.added(
      root,
      (addedElements) => {
        if (!s.alive()) return;
        const MIN = currentTargetSize;

        let liveCount = 0;
        for (let i = 0; i < allKnownTargets.length; i++) {
          if (allKnownTargets[i].el.isConnected) {
            allKnownTargets[liveCount++] = allKnownTargets[i];
          }
        }
        allKnownTargets.length = liveCount;

        const batchTargets = [];

        for (const added of addedElements) {
          if (isCandidate(added, s) && !processed.has(added)) {
            batchTargets.push(added);
          }
          if (added.querySelectorAll) {
            for (const desc of added.querySelectorAll(TARGET_QUERY)) {
              if (isCandidate(desc, s) && !processed.has(desc)) {
                batchTargets.push(desc);
              }
            }
          }
        }

        if (!batchTargets.length) return;

        const batchDocRects = batchTargets.map((el) => getDocRect(el));
        const nearbyExisting = [];
        for (const known of allKnownTargets) {
          if (!known.el.isConnected) continue;
          if (batchTargets.includes(known.el)) continue;
          const kr = getDocRect(known.el);
          known.r = kr;
          const isNear = batchDocRects.some((br) => {
            const dx = Math.max(0, Math.max(br.left - kr.right, kr.left - br.right));
            const dy = Math.max(0, Math.max(br.top - kr.bottom, kr.top - br.bottom));
            return dx <= MIN && dy <= MIN;
          });
          if (isNear) {
            nearbyExisting.push(known);
          }
        }

        processItems(batchTargets, MIN);

        let changedNearby = false;
        for (const known of nearbyExisting) {
          const id = known.el.getAttribute('data-ai4a11y-bt-id');
          if (id && dynamicRules.has(id)) {
            let cs;
            try { cs = window.getComputedStyle(known.el); } catch { continue; }
            computeHit(known.el, cs, MIN);
            changedNearby = true;
          }
        }
        if (changedNearby && dynamicStyle) {
          dynamicStyle.update([...dynamicRules.values()].join('\n'));
        }
      },
      { batch: true, debounceMs: 40, cap: 1000 }
    );

    const step = async (dir) => {
      const idx = SIZES.indexOf(currentTargetSize);
      let next;
      if (dir > 0) {
        if (idx === -1) next = SIZES.find((sz) => sz > currentTargetSize) || SIZES[SIZES.length - 1];
        else next = SIZES[Math.min(SIZES.length - 1, idx + 1)];
      } else {
        if (idx === -1) next = [...SIZES].reverse().find((sz) => sz < currentTargetSize) || SIZES[0];
        else next = SIZES[Math.max(0, idx - 1)];
      }
      if (next === currentTargetSize) return;

      const res = await s.profile.set({ targetSize: next });
      if (res?.applied) {
        s.announce(`Target size ${next}px on this site.`);
      }
    };

    s.keys.adjust({
      label: 'Target size',
      settings: ['targetSize'],
      up: () => step(1),
      down: () => step(-1),
    });

    s.profile.onChange((p, changed) => {
      if (p?.bigTargets === false) {
        this.disable();
        return;
      }
      if (changed && 'targetSize' in changed) {
        const nextSize = Number(changed.targetSize);
        if (Number.isFinite(nextSize) && nextSize > 0 && nextSize !== currentTargetSize) {
          currentTargetSize = nextSize;
          redoAll();
        }
      }
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
