// bigger-targets.js — Makes small links, buttons and form controls at least targetSize pixels to hit.
// Barrier: People with motor differences, tremors, reduced fine motor control,
// or using alternative pointers (eye gaze, head tracking, touch on mobile)
// struggle to hit tiny interactive targets.
//
// Suggested in onboarding for: motor (a suggestion only, never a gate).
// The person's settings it reads: targetSize, bigTargets.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Target size', settings targetSize):
//   up and down step targetSize through 24, 32, 44 pixels, saved for this site and announced.
//
// Options:
//   targetSize: Smallest size of an interactive control in CSS pixels (default 24, WCAG 2.5.8; 44 is WCAG 2.5.5).
//
// Decisions:
//   • Measures before it changes anything, changing only controls that are smaller than targetSize.
//   • Prefers growing hit areas without moving surrounding content:
//     - buttons, fields, and ARIA controls grow with min-width/min-height, falling back to hit areas if container overflows.
//     - checkboxes and radio buttons are sized to targetSize, and unclickable labels are restored to clickable.
//     - inline links in running text keep their line height readable (no doubling of line height), using hit areas and spacing.
//     - hit areas (::after pseudo-element and padding/negative margins) take at most half the free space to neighbours.
//   • Never shrinks an element that is already large enough.
//   • Never covers a neighbouring interactive target (targets never overlap).
//   • Measures each interactive element once; elements added later are handled by themselves.
//   • A new targetSize redoes the sizes in a new s.group(), never by clearing and redoing on each change of the page.
//   • Leaves focus indicators and focus styles alone (handled by focus adapter).
//
// What it cannot do:
//   • Cannot expand targets inside <canvas>, embedded <iframe>, or raster image maps.
//   • Cannot expand targets clipped by ancestor containers with overflow: hidden where expansion would exceed the container.

const TARGET_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const NO_GROW_TYPES = /^(hidden|range|color|file|image)$/i;
const BOX_TYPES = /^(checkbox|radio)$/i;
const NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|svg|OBJECT|EMBED)$/i;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/i;
const SIZES = [24, 32, 44];

function isClear(color) {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

function resolveTargetSize(options, profile) {
  const pTarget = profile?.get?.('targetSize');
  if (typeof pTarget === 'number' && pTarget >= 24) return pTarget;
  if (profile?.get?.('bigTargets') === true && !options?.targetSize) return 44;
  const optTarget = Number(options?.targetSize || options?.minSize);
  if (Number.isFinite(optTarget) && optTarget >= 24) return optTarget;
  return 24;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    this.currentGroup = null;
    this.trackedElements = new Set();
    this.seen = new WeakSet();

    let currentTargetSize = resolveTargetSize(this.options, s.profile);

    const stepSize = async (dir) => {
      let next;
      if (dir > 0) {
        next = SIZES.find((sz) => sz > currentTargetSize) ?? SIZES[SIZES.length - 1];
      } else {
        next = [...SIZES].reverse().find((sz) => sz < currentTargetSize) ?? SIZES[0];
      }
      if (next === currentTargetSize) return;
      const res = await s.profile.set({ targetSize: next });
      if (res && res.applied) {
        currentTargetSize = next;
        applyAll(currentTargetSize);
        s.announce(`Target size ${next} pixels on this site.`);
      }
    };

    s.keys.adjust({
      label: 'Target size',
      settings: ['targetSize'],
      up: () => stepSize(1),
      down: () => stepSize(-1),
    });

    s.profile.onChange((personal, changed) => {
      if (changed && 'targetSize' in changed) {
        const next = Number(changed.targetSize);
        if (Number.isFinite(next) && next >= 24 && next !== currentTargetSize) {
          currentTargetSize = next;
          applyAll(currentTargetSize);
        }
      }
    });

    const isInteractiveCandidate = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (s.page.isOurs(el) || el.hasAttribute('data-ai4a11y-ui') || el.closest('[data-ai4a11y-ui]')) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.tagName === 'INPUT' && NO_GROW_TYPES.test(el.type || '')) return false;
      return true;
    };

    const processElements = (group, elements, size, allElements) => {
      const MIN = size;
      const root = document.documentElement;
      const docW = root.clientWidth;
      const docSW = root.scrollWidth;

      const items = [];
      for (const el of elements) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let cs;
        try { cs = window.getComputedStyle(el); } catch { continue; }
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        items.push({ el, cs, r, small: r.width < MIN || r.height < MIN });
      }

      const grown = [];
      const needsHitArea = [];

      for (const it of items) {
        if (!it.small) continue;
        const { el, cs, r } = it;
        const tag = el.tagName;
        const type = (el.getAttribute('type') || '').toLowerCase();

        // 1. Checkboxes and radio buttons
        if (tag === 'INPUT' && BOX_TYPES.test(type)) {
          if (cs.opacity !== '0' && cs.position !== 'absolute') {
            group.setAttr(el, 'data-ai4a11y-bt', 'box');
          }
          const label = el.closest('label') || (el.labels && el.labels[0]);
          if (label) {
            try {
              if (window.getComputedStyle(label).pointerEvents === 'none') {
                group.setAttr(label, 'data-ai4a11y-bt', 'label');
              }
            } catch {}
          }
          continue;
        }

        // Inline elements don't accept min-width/min-height in CSS; they get hit area
        if (cs.display === 'inline' || cs.display === 'contents') {
          needsHitArea.push(it);
          continue;
        }

        const role = el.getAttribute('role') || '';
        const text = (el.textContent || '').trim();
        const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;
        const looksLikeButton = !isClear(cs.backgroundColor) || (parseFloat(cs.borderTopWidth) > 0 && !isClear(cs.borderTopColor));
        const overlaid = cs.position === 'absolute' || cs.position === 'fixed';

        const growable = !overlaid && (
          tag === 'BUTTON' ||
          tag === 'SELECT' ||
          tag === 'SUMMARY' ||
          (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) ||
          GROW_ROLES.test(role) ||
          iconLike ||
          (tag !== 'LABEL' && looksLikeButton)
        );

        if (!growable) {
          needsHitArea.push(it);
          continue;
        }

        // 2. Growable elements: measure ancestors before growth to detect container overflow
        const p = el.parentElement;
        const g = p && p.parentElement;
        const ancestors = [p, g].filter(Boolean);
        it.beforeOverflow = ancestors.map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);

        group.setAttr(el, 'data-ai4a11y-bt', 'grow');
        if (text && parseFloat(cs.fontSize) < MIN * 0.45 && iconLike) {
          group.setStyle(el, 'font-size', `${Math.round(MIN * 0.45)}px`, 'important');
        }
        grown.push(it);
      }

      // Check if growing caused any container or page overflow
      for (const it of grown) {
        const rAfter = it.el.getBoundingClientRect();
        const overflowed = it.beforeOverflow.some(
          ([a, w, h]) => (a.scrollWidth - a.clientWidth) > w + 1 || (a.scrollHeight - a.clientHeight) > h + 1
        ) || (rAfter.right > docW + 0.5 && it.r.right <= docW + 0.5);

        if (overflowed) {
          group.setAttr(it.el, 'data-ai4a11y-bt', null);
          group.setStyle(it.el, 'font-size', '');
          needsHitArea.push(it);
        }
      }

      if (grown.length && root.scrollWidth > docSW + 1) {
        for (const it of grown) {
          if (it.el.getAttribute('data-ai4a11y-bt') === 'grow') {
            group.setAttr(it.el, 'data-ai4a11y-bt', null);
            group.setStyle(it.el, 'font-size', '');
            needsHitArea.push(it);
          }
        }
      }

      // 3. Hit area for inline links and controls that could not grow,
      // sized against where everything sits now after the first pass.
      const rectsNow = allElements.filter((el) => el.isConnected).map((el) => ({ el, r: el.getBoundingClientRect() }));

      for (const it of needsHitArea) {
        const { el, cs } = it;
        if (el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) continue;
        if (el.getClientRects().length > 1) continue; // multi-line wrapped link
        if (cs.overflow !== 'visible') continue;

        const inner = el.querySelector(TARGET_SELECTORS);
        if (inner && !(el.tagName === 'LABEL' && [...el.querySelectorAll(TARGET_SELECTORS)].every((c) => c.tagName === 'INPUT'))) {
          continue;
        }

        const relative = cs.position === 'static';
        if (relative && [...el.querySelectorAll('*')].some((d) => /absolute|fixed/.test(window.getComputedStyle(d).position))) {
          continue;
        }

        const wantX = Math.max(0, (MIN - r.width) / 2);
        const wantY = Math.max(0, (MIN - r.height) / 2);
        let top = wantY;
        let bottom = wantY;
        let left = wantX;
        let right = wantX;

        // Take at most half the free space to any neighbouring target so targets never overlap
        for (const o of rectsNow) {
          if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
          const q = o.r;
          const overlapX = q.left < r.right + right && q.right > r.left - left;
          const overlapY = q.top < r.bottom + bottom && q.bottom > r.top - top;
          if (overlapX && q.bottom <= r.top + 0.5) top = Math.min(top, Math.max(0, (r.top - q.bottom) / 2));
          if (overlapX && q.top >= r.bottom - 0.5) bottom = Math.min(bottom, Math.max(0, (q.top - r.bottom) / 2));
          if (overlapY && q.right <= r.left + 0.5) left = Math.min(left, Math.max(0, (r.left - q.right) / 2));
          if (overlapY && q.left >= r.right - 0.5) right = Math.min(right, Math.max(0, (q.left - r.right) / 2));
        }

        // Clamp to container / viewport edges
        let box = { left: 0, right: docW, top: -window.scrollY, bottom: root.scrollHeight - window.scrollY };
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const as = window.getComputedStyle(a);
          if (as.overflowX !== 'visible' || as.overflowY !== 'visible') {
            const ar = a.getBoundingClientRect();
            const x0 = ar.left + a.clientLeft - a.scrollLeft;
            const y0 = ar.top + a.clientTop - a.scrollTop;
            box = { left: x0, right: x0 + a.scrollWidth, top: y0, bottom: y0 + a.scrollHeight };
            break;
          }
        }

        const px = (v) => Math.max(0, Math.floor(v));
        const t = px(Math.min(top, r.top - box.top));
        const b = px(Math.min(bottom, box.bottom - r.bottom));
        const l = px(Math.min(left, r.left - box.left));
        const rt = px(Math.min(right, box.right - r.right));

        if (t + b + l + rt < 2) continue;

        group.setStyle(el, '--ai4a11y-bt-t', `-${t}px`);
        group.setStyle(el, '--ai4a11y-bt-b', `-${b}px`);
        group.setStyle(el, '--ai4a11y-bt-l', `-${l}px`);
        group.setStyle(el, '--ai4a11y-bt-r', `-${rt}px`);
        group.setAttr(el, 'data-ai4a11y-bt-hit', `${t} ${rt} ${b} ${l}`);

        const tokens = ['hit'];
        if (relative) tokens.push('rel');
        group.setAttr(el, 'data-ai4a11y-bt', tokens.join(' '));
      }
    };

    const applyAll = (size) => {
      if (this.currentGroup) {
        this.currentGroup.end();
        this.currentGroup = null;
      }
      this.currentGroup = s.group();

      const css = `
:root {
  --ai4a11y-bt-size: ${size}px;
}
[data-ai4a11y-bt~="grow"] {
  min-width: var(--ai4a11y-bt-size) !important;
  min-height: var(--ai4a11y-bt-size) !important;
  box-sizing: border-box !important;
}
[data-ai4a11y-bt~="box"] {
  width: var(--ai4a11y-bt-size) !important;
  height: var(--ai4a11y-bt-size) !important;
  flex-shrink: 0 !important;
}
[data-ai4a11y-bt~="label"] {
  pointer-events: auto !important;
  cursor: pointer !important;
}
[data-ai4a11y-bt~="rel"] {
  position: relative !important;
}
[data-ai4a11y-bt~="hit"]::after {
  content: "" !important;
  position: absolute !important;
  top: var(--ai4a11y-bt-t, 0px) !important;
  bottom: var(--ai4a11y-bt-b, 0px) !important;
  left: var(--ai4a11y-bt-l, 0px) !important;
  right: var(--ai4a11y-bt-r, 0px) !important;
  pointer-events: auto !important;
  z-index: 1 !important;
}
`;
      this.currentGroup.css('bigger-targets-styles', css);

      const elements = [...document.querySelectorAll(TARGET_SELECTORS)].filter(isInteractiveCandidate);
      this.trackedElements = new Set(elements);
      for (const el of elements) this.seen.add(el);

      processElements(this.currentGroup, elements, size, elements);
    };

    applyAll(currentTargetSize);

    // Watch for dynamically added elements: size only the new element by itself,
    // never clearing or redoing existing elements.
    const docRoot = document.body || document.documentElement;
    if (docRoot) {
      s.watch.added(
        docRoot,
        (el) => {
          if (!this.s || this.s.ended || !this.currentGroup) return;
          if (!isInteractiveCandidate(el)) return;
          if (this.seen.has(el)) return;

          this.seen.add(el);
          this.trackedElements.add(el);

          processElements(this.currentGroup, [el], currentTargetSize, [...this.trackedElements]);
        },
        { selector: TARGET_SELECTORS, debounceMs: 100 }
      );
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
    this.currentGroup = null;
    this.trackedElements = null;
    this.seen = null;
  },
};
