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
//     - Buttons, form controls and non-inline elements receive min-width/min-height.
//     - Checked afterwards: if direct sizing causes container overflow or pushes past document bounds,
//       direct sizing is undone and it falls back to an expanded pseudo-element hit area (::after).
//     - Text links and inline controls keep their visual layout and text flow; an invisible ::after
//       expands their clickable hit area into available free space without affecting line height.
//     - Checkboxes and radios reach targetSize at any size asked for (24, 32, 44) so native inputs stay hit-accessible.
//     - Absolutely and fixed positioned controls, as well as SVG controls, reach targetSize at every size.
//     - Leaves the page's pointer-events alone; a <label> is a target only when it labels a control,
//       and never both it and its control.
//   • Overlap prevention: hit areas expand only into available free space and take at most half the gap
//     between neighbouring interactive elements, guaranteeing targets never cover each other.
//   • Neighbours are what is near on screen, not only siblings, also for what is added later.
//   • Dynamic content: elements added later come in batches (s.watch.added with { batch: true }).
//     The batch and targets near it on screen are measured once and adjusted without redoing existing targets.
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

function isCandidate(el, s) {
  if (!el || !el.isConnected) return false;
  if (el.closest && el.closest('[data-ai4a11y-ui]')) return false;
  if (s && s.page && s.page.isOurs && s.page.isOurs(el)) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'INPUT' && type === 'hidden') return false;

  if (isInsideLinkOrButton(el)) return false;

  if (tag === 'LABEL') return false;

  let cs;
  try { cs = window.getComputedStyle(el); } catch { return false; }
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') return false;
  if (parseFloat(cs.opacity) === 0) return false;

  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;

  return true;
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
    let hitRules = new Map();
    let hitStyle = null;
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

    const processItems = (targets, MIN) => {
      if (!targets.length) return;
      const docEl = document.documentElement;
      const docW = docEl.clientWidth;
      const docSW = docEl.scrollWidth;

      const items = [];
      for (const el of targets) {
        processed.add(el);
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        allKnownTargets.push({ el, r });

        let cs;
        try { cs = window.getComputedStyle(el); } catch { continue; }
        const tag = el.tagName;
        const type = (el.getAttribute('type') || '').toLowerCase();
        const isBox = tag === 'INPUT' && BOX_TYPES.test(type);
        const small = r.width < MIN || r.height < MIN;
        if (!small) continue;
        items.push({ el, cs, r, tag, type, isBox });
      }

      if (!items.length) return;

      const grown = [];
      for (const it of items) {
        const { el, cs, r, tag, type, isBox } = it;
        if (isBox) {
          it.kind = 'box';
          mark(el, 'box');
          continue;
        }

        if (cs.display === 'inline') {
          it.kind = 'hit';
          continue;
        }

        const role = el.getAttribute('role') || '';
        const text = (el.textContent || '').trim();
        const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;

        const growable = tag === 'BUTTON' ||
          tag === 'SELECT' ||
          tag === 'SUMMARY' ||
          tag === 'SVG' ||
          (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) ||
          GROW_ROLES.test(role) ||
          iconLike;

        if (growable) {
          const p = el.parentElement;
          const g = p && p.parentElement;
          it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
          it.kind = 'grow';
          const glyph = iconLike && parseFloat(cs.fontSize) < MIN * 0.45;
          mark(el, glyph ? 'grow glyph' : 'grow');
          grown.push(it);
        } else {
          it.kind = 'hit';
        }
      }

      if (grown.length) {
        const undo = grown.filter((it) => {
          const rNow = it.el.getBoundingClientRect();
          const overflowsContainer = it.before.some(([a, w, h]) => (a.scrollWidth - a.clientWidth) > w + 1 || (a.scrollHeight - a.clientHeight) > h + 1);
          const pushesDoc = rNow.right > docW + 0.5 && it.r.right <= docW + 0.5;
          const notReached = rNow.width < MIN - 0.5 || rNow.height < MIN - 0.5;
          return overflowsContainer || pushesDoc || notReached;
        });

        for (const it of undo) {
          unmark(it.el, 'grow');
          unmark(it.el, 'glyph');
          it.kind = 'hit';
        }

        if (docEl.scrollWidth > docSW + 1) {
          for (const it of grown) {
            if (it.kind === 'grow') {
              unmark(it.el, 'grow');
              unmark(it.el, 'glyph');
              it.kind = 'hit';
            }
          }
        }
      }

      // Hit area calculation
      const defaultBox = { left: 0, right: docW, top: -window.scrollY, bottom: docEl.scrollHeight - window.scrollY };
      const scrollBoxCache = new WeakMap();

      for (const it of items) {
        if (it.kind !== 'hit') continue;
        const { el, cs } = it;
        if (NO_PSEUDO.test(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) continue;
        if (el.getClientRects && el.getClientRects().length > 1) continue;

        const wantX = Math.max(0, MIN - r.width);
        const wantY = Math.max(0, MIN - r.height);
        let left = Math.floor(wantX / 2);
        let right = Math.ceil(wantX / 2);
        let top = Math.floor(wantY / 2);
        let bottom = Math.ceil(wantY / 2);

        const rTopBound = r.top - MIN;
        const rBottomBound = r.bottom + MIN;
        const rLeftBound = r.left - MIN;
        const rRightBound = r.right + MIN;

        for (const o of allKnownTargets) {
          const q = o.r;
          if (q.bottom < rTopBound || q.top > rBottomBound || q.right < rLeftBound || q.left > rRightBound) {
            continue;
          }
          if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;

          const overlapX = q.left < r.right + right && q.right > r.left - left;
          const overlapY = q.top < r.bottom + bottom && q.bottom > r.top - top;
          if (overlapX && q.bottom <= r.top + 0.5) top = Math.min(top, Math.max(0, Math.floor((r.top - q.bottom) / 2)));
          if (overlapX && q.top >= r.bottom - 0.5) bottom = Math.min(bottom, Math.max(0, Math.floor((q.top - r.bottom) / 2)));
          if (overlapY && q.right <= r.left + 0.5) left = Math.min(left, Math.max(0, Math.floor((r.left - q.right) / 2)));
          if (overlapY && q.left >= r.right - 0.5) right = Math.min(right, Math.max(0, Math.floor((q.left - r.right) / 2)));
        }

        let box = defaultBox;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (scrollBoxCache.has(a)) {
            box = scrollBoxCache.get(a);
            break;
          }
          if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) {
            let sBox;
            try { sBox = window.getComputedStyle(a); } catch { break; }
            if (sBox.overflowX !== 'visible' || sBox.overflowY !== 'visible') {
              const ar = a.getBoundingClientRect();
              const x0 = ar.left + a.clientLeft - a.scrollLeft;
              const y0 = ar.top + a.clientTop - a.scrollTop;
              box = { left: x0, right: x0 + a.clientWidth, top: y0, bottom: y0 + a.clientHeight };
              scrollBoxCache.set(a, box);
              break;
            }
          }
        }

        const px = (v) => Math.max(0, Math.floor(v));
        const t = px(Math.min(top, r.top - box.top));
        const b = px(Math.min(bottom, box.bottom - r.bottom));
        const l = px(Math.min(left, r.left - box.left));
        const rt = px(Math.min(right, box.right - r.right));

        if (t + b + l + rt >= 1) {
          const id = String(nextHitId++);
          sizeGroup.setAttr(el, 'data-ai4a11y-bt-id', id);
          mark(el, cs.position === 'static' ? 'hit rel' : 'hit');
          hitRules.set(id, `[data-ai4a11y-bt-id="${id}"]::after { top: -${t}px; right: -${rt}px; bottom: -${b}px; left: -${l}px; }`);
        }
      }

      if (hitStyle) {
        hitStyle.update([...hitRules.values()].join('\n'));
      }
    };

    const redoAll = () => {
      if (sizeGroup) sizeGroup.end();
      sizeGroup = s.group();
      nextHitId = 1;
      hitRules.clear();
      allKnownTargets.length = 0;

      const MIN = currentTargetSize;

      sizeGroup.css(
        'base',
        `[data-ai4a11y-bt~="grow"] { min-width: ${MIN}px !important; min-height: ${MIN}px !important; }
[data-ai4a11y-bt~="glyph"] { font-size: ${Math.round(MIN * 0.45)}px !important; }
[data-ai4a11y-bt~="box"] { width: ${MIN}px !important; height: ${MIN}px !important; min-width: ${MIN}px !important; min-height: ${MIN}px !important; flex-shrink: 0 !important; }
[data-ai4a11y-bt~="rel"] { position: relative !important; }
[data-ai4a11y-bt~="hit"]::after { content: "" !important; position: absolute !important; pointer-events: auto !important; }`
      );

      hitStyle = sizeGroup.css('hits', '');

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
        processItems(batchTargets, MIN);
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
