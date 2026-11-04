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
//     elements with an interactive role, a <label> only when its control cannot be the target) is
//     measured once, and only those smaller than targetSize change.
//   • Nothing too small, or bigTargets off: enable() ends the session and returns false.
//   • How far each target may grow comes from s.targets.room(): between two targets each takes at most
//     half the gap when the other grows toward it, the whole gap when the other is big enough already,
//     nothing past the page's edge. The same whatever order they are measured in, so no two hit areas
//     overlap, also with what is added later. Where there is not enough room, a target grows as far as
//     it can and no further: it never covers a neighbour to reach the size.
//   • Native buttons, selects, summaries, inputs, checkboxes and radios (and elements with role button,
//     tab, menuitem, switch or option) grow their own box (min-width/min-height) with the same amount
//     taken off their margins, so nothing around them moves; margins the page set to auto stay auto.
//     Where an ancestor would cut the grown box off (overflow), they get a hit area instead.
//   • Everything else gets a hit area from s.targets.hitArea(): an invisible pseudo-element, or, for SVG
//     controls and what cannot have one, an HTML ring around it (never over it) that passes the
//     pointer's presses and clicks to it.
//   • Inline links in running text get 2px of padding on each side first, then everything is measured.
//     A link broken over two lines is left as it is.
//   • Elements added later come in batches (s.watch.added with { batch: true }): the batch and the
//     targets near it on screen are measured once; only those near it change again.
//   • A new targetSize redoes the sizes in a fresh s.group().
//   • Leaves the page's pointer-events alone; a <label> is a target only when it labels a control,
//     and never both it and its control. Nothing outside its job (no focus styles).
//
// What it cannot do:
//   • Grow a target past its neighbours: in a row of small controls closer together than targetSize,
//     each reaches what its half of the gaps allows.
//   • Hover, touch events and the context menu on a ring's area (the control itself still has them).
//   • Rings need CSS anchor positioning (Chrome 125+, Safari 26): without it, SVG controls and other
//     targets that need a ring are left as they are.
//   • Targets inside cross-origin frames, shadow roots or canvas-drawn interfaces.

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

const NO_GROW_TYPES = /^(hidden|range|file|color|image)$/i;
const GROW_TAGS = /^(BUTTON|SELECT|SUMMARY|INPUT)$/;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/i;
const SIDES = ['top', 'right', 'bottom', 'left'];
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
  // Inside an SVG drawing (not the <svg> itself): no HTML can sit next to it.
  if (el.ownerSVGElement) return false;

  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'INPUT' && type === 'hidden') return false;

  if (isInsideLinkOrButton(el)) return false;

  if (tag === 'LABEL') {
    // A <label> is a target only when it labels a control, and never both it and its control.
    const control = el.control || (el.htmlFor ? document.getElementById(el.htmlFor) : el.querySelector('input, select, textarea, button'));
    if (!control) return false;
    if (control.isConnected && !control.disabled && control.getAttribute('aria-disabled') !== 'true') {
      let ccs;
      try { ccs = window.getComputedStyle(control); } catch { return false; }
      if (ccs.display !== 'none' && ccs.visibility !== 'hidden' && parseFloat(ccs.opacity) > 0) return false;
    }
  }

  let cs;
  try { cs = window.getComputedStyle(el); } catch { return false; }
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') return false;
  if (parseFloat(cs.opacity) === 0) return false;
  if (cs.pointerEvents === 'none') return false;
  // Hidden from the eye by the page itself (a "visually hidden" skip link): a hit area there would be invisible.
  if (cs.clip && cs.clip !== 'auto') return false;

  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;

  return true;
}

// A margin the page set to auto (its computed value, not the pixels it resolves to).
function isAutoMargin(el, side) {
  try {
    const v = el.computedStyleMap && el.computedStyleMap().get(`margin-${side}`);
    return !!v && String(v) === 'auto';
  } catch { return false; }
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

    const isSmall = (r, MIN) => r.width < MIN || r.height < MIN;
    const candidatesIn = (list) => {
      const out = [];
      for (const el of list) if (isCandidate(el, s)) out.push(el);
      return out;
    };

    if (!candidatesIn(root.querySelectorAll(TARGET_QUERY)).some((el) => isSmall(el.getBoundingClientRect(), currentTargetSize))) {
      this.disable();
      return false;
    }

    let group = null;
    let nextId = 1;
    // Every target seen, small or not: el -> { grown: { top, right, bottom, left } | null, kind }
    const records = new Map();

    const mark = (el, token) => {
      const cur = el.getAttribute('data-ai4a11y-bt') || '';
      const tokens = new Set(cur.split(/\s+/).filter(Boolean));
      tokens.add(token);
      const next = [...tokens].join(' ');
      if (next !== cur) group.setAttr(el, 'data-ai4a11y-bt', next);
    };
    const idOf = (el) => {
      let id = el.getAttribute('data-ai4a11y-bt-id');
      if (!id) { id = String(nextId++); group.setAttr(el, 'data-ai4a11y-bt-id', id); }
      return id;
    };

    // Its own box grows by e on each side, and its margins give the same back.
    const grow = (el, e, g) => {
      const pad = (a, b) => (g.boxSizing === 'content-box' ? a + b : 0);
      group.setStyle(el, 'min-width', `${e.rect.width + e.left + e.right - pad(g.px, g.bx)}px`, 'important');
      group.setStyle(el, 'min-height', `${e.rect.height + e.top + e.bottom - pad(g.py, g.by)}px`, 'important');
      for (const side of SIDES) {
        if (!g.auto[side]) group.setStyle(el, `margin-${side}`, `${g.margin[side] - e[side]}px`, 'important');
      }
    };

    const growInfo = (el) => {
      // An SVG control's hit area comes from HTML around it, never from resizing the drawing.
      if (el instanceof SVGElement) return null;
      let cs;
      try { cs = window.getComputedStyle(el); } catch { return null; }
      const tag = el.tagName.toUpperCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role') || '';
      const native = GROW_TAGS.test(tag) && !(tag === 'INPUT' && NO_GROW_TYPES.test(type));
      if (!(native || GROW_ROLES.test(role)) || cs.display === 'inline') return null;
      const n = (v) => parseFloat(v) || 0;
      return {
        boxSizing: cs.boxSizing,
        px: n(cs.paddingLeft) + n(cs.paddingRight), py: n(cs.paddingTop) + n(cs.paddingBottom),
        bx: n(cs.borderLeftWidth) + n(cs.borderRightWidth), by: n(cs.borderTopWidth) + n(cs.borderBottomWidth),
        margin: { top: n(cs.marginTop), right: n(cs.marginRight), bottom: n(cs.marginBottom), left: n(cs.marginLeft) },
        auto: Object.fromEntries(SIDES.map((side) => [side, isAutoMargin(el, side)])),
      };
    };

    // Size the small ones among `fresh` (new to us) and `again` (known, near what is new),
    // keeping clear of every target in `known`. Reads everything, then writes.
    const size = (fresh, again, known, MIN) => {
      // Inline links in running text get spacing first; it is the one change that moves text.
      const inline = fresh.filter((el) => el.tagName === 'A' && isSmall(el.getBoundingClientRect(), MIN) && window.getComputedStyle(el).display === 'inline');
      for (const el of inline) mark(el, 'inline-link');
      // The size each had before it grew.
      const rects = new Map();
      for (const el of known) {
        const r = el.getBoundingClientRect();
        const g = records.get(el)?.grown;
        rects.set(el, g
          ? { left: r.left + g.left, top: r.top + g.top, right: r.right - g.right, bottom: r.bottom - g.bottom, width: r.width - g.left - g.right, height: r.height - g.top - g.bottom }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      }
      const small = [...fresh, ...again].filter((el) => rects.has(el) && isSmall(rects.get(el), MIN));
      const room = group.targets.room(small, { size: MIN, others: known, rects });

      const grows = [];
      const hits = new Map();
      for (const el of small) {
        const e = room.get(el);
        if (!e) continue;
        const rec = records.get(el);
        const info = rec?.kind ? rec.info : !e.clipped && growInfo(el);
        if (info) grows.push([el, e, info]);
        else hits.set(el, e);
      }
      for (const [el, e, info] of grows) {
        idOf(el);
        mark(el, 'grow');
        grow(el, e, info);
        records.set(el, { kind: 'grow', info, grown: { top: e.top, right: e.right, bottom: e.bottom, left: e.left } });
      }
      for (const el of hits.keys()) idOf(el);
      const how = group.targets.hitAreas(hits, {
        attrs: (el) => ({ 'data-ai4a11y-bt': 'overlay', 'data-ai4a11y-bt-overlay-for': el.getAttribute('data-ai4a11y-bt-id') }),
      });
      for (const [el, h] of how) {
        if (h) mark(el, 'hit');
        records.set(el, { kind: 'hit', grown: null });
      }
      for (const el of fresh) if (!records.has(el)) records.set(el, { kind: null, grown: null });
    };

    const redoAll = () => {
      if (group) group.end();
      group = s.group();
      nextId = 1;
      records.clear();
      group.css('base', '[data-ai4a11y-bt~="inline-link"] { padding-left: 2px !important; padding-right: 2px !important; }');
      const all = candidatesIn(root.querySelectorAll(TARGET_QUERY));
      size(all, [], all, currentTargetSize);
    };

    redoAll();

    s.watch.added(
      root,
      (addedElements) => {
        if (!s.alive()) return;
        const MIN = currentTargetSize;
        for (const el of [...records.keys()]) if (!el.isConnected) records.delete(el);

        const fresh = new Set();
        for (const added of addedElements) {
          if (!records.has(added) && isCandidate(added, s)) fresh.add(added);
          if (added.querySelectorAll) {
            for (const d of added.querySelectorAll(TARGET_QUERY)) if (!records.has(d) && isCandidate(d, s)) fresh.add(d);
          }
        }
        if (!fresh.size) return;

        // The known targets near the batch on screen are sized again with it; the rest stay as they are.
        const batch = [...fresh].map((el) => el.getBoundingClientRect());
        const again = [];
        for (const [el, rec] of records) {
          if (!rec.kind) continue;
          const r = el.getBoundingClientRect();
          if (batch.some((b) => Math.max(b.left - r.right, r.left - b.right) <= 2 * MIN && Math.max(b.top - r.bottom, r.top - b.bottom) <= 2 * MIN)) again.push(el);
        }
        size([...fresh], again, [...records.keys(), ...fresh], MIN);
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
