// Bigger targets: makes small links, buttons, and form controls at least
// targetSize CSS pixels (default option 24, WCAG 2.5.8; 44 is WCAG 2.5.5) to hit,
// measuring first and changing only what is too small.
//
// Suggested in onboarding for: motor (a suggestion only, never a gate).
//
// Settings read:
//   • targetSize: minimum clickable target size in CSS pixels (24-64, default: 24)
//   • bigTargets: boolean preference (if explicitly false, adapter does not apply)
//
// What the person can adjust:
//   • targetSize with Alt+Shift+P (cycles 24, 32, 44 pixels)
//   • Alt+Shift+K saves current targetSize for every site
//
// Options:
//   • targetSize: developer default target size in CSS pixels (default: 24)
//
// Decisions:
//   • Measures before it changes anything, altering only controls that fall short.
//   • Prefers expanding the hit area without moving surrounding layout:
//     - Buttons, selects, summaries, and icon-sized controls receive min-width/min-height,
//       falling back to hit-area expansion if growing would cause container overflow.
//     - Tiny checkboxes and radio buttons are drawn at boxSize with compensating margins,
//       and unclickable labels (pointer-events: none) are made clickable.
//     - Inline text links in running text keep their natural display and line height,
//       using an invisible ::after hit area that never encroaches on neighbours or page edges.
//   • Reversible: all rules, attributes, and styles are tracked by the session and
//     completely removed on disable().
//
// What it cannot do:
//   • Cannot expand targets when adjacent interactive elements are tightly touching
//     without encroaching on the neighbouring element's target area.
//   • Cannot add pseudo-elements to replaced void elements (e.g. native image inputs).

const TARGET_SELECTORS = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[onclick]',
  '[tabindex]:not([tabindex="-1"])'
];
const TARGETS = TARGET_SELECTORS.join(',');
const MARK = 'data-ai4a11y-bt';
const NUM = 'data-ai4a11y-bt-n';
const NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|svg|OBJECT|EMBED)$/i;
const BOX_TYPES = /^(checkbox|radio)$/i;
const NO_GROW_TYPES = /^(hidden|range|file|color|image)$/i;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/i;
const CYCLE_SIZES = [24, 32, 44];

function isClear(color) {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

function getCandidates(doc) {
  const found = new Set();
  for (const el of doc.querySelectorAll(TARGETS)) {
    if (!el.closest || !el.closest('[data-ai4a11y-ui]')) found.add(el);
  }
  if (doc.body) {
    for (const el of doc.body.getElementsByTagName('*')) {
      if (found.has(el) || (el.hasAttribute && el.hasAttribute('data-ai4a11y-ui'))) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (cs.cursor !== 'pointer') continue;
      const p = el.parentElement;
      if (p && p !== doc.body && getComputedStyle(p).cursor === 'pointer') continue;
      if (el.closest && (el.closest(TARGETS) || el.closest('[data-ai4a11y-ui]'))) continue;
      found.add(el);
    }
  }
  return [...found];
}

function baseRules(minSize, boxSize) {
  return `
html.ai4a11y-bigger-targets [${MARK}~="grow"] { min-width: ${minSize}px !important; min-height: ${minSize}px !important; }
html.ai4a11y-bigger-targets [${MARK}~="glyph"] { font-size: ${Math.round(minSize * 0.45)}px !important; }
html.ai4a11y-bigger-targets [${MARK}~="box"] { width: ${boxSize}px !important; height: ${boxSize}px !important; flex-shrink: 0 !important; }
html.ai4a11y-bigger-targets [${MARK}~="label"] { pointer-events: auto !important; cursor: pointer !important; }
html.ai4a11y-bigger-targets [${MARK}~="rel"] { position: relative !important; }
html.ai4a11y-bigger-targets [${MARK}~="hit"]::after { content: "" !important; position: absolute !important; cursor: pointer !important; }
html.ai4a11y-bigger-targets :focus-visible { outline: 3px solid #1a73e8 !important; outline-offset: 2px !important; }
`;
}

export default {
  s: null,

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());

    const doc = document;
    if (!doc.body) return false;

    const personal = s.profile.get() || {};
    if (personal.bigTargets === false) {
      s.end();
      this.s = null;
      return false;
    }

    let currentSize = Number(personal.targetSize) || Number(options?.targetSize) || 24;
    const marked = new Set();
    const sheet = s.css('bigger-targets', '', { scope: 'ai4a11y-bigger-targets' });

    function clearMarks() {
      for (const el of marked) {
        s.setAttr(el, MARK, null);
        s.setAttr(el, NUM, null);
      }
      marked.clear();
      sheet.update('');
    }

    function apply() {
      if (!s.alive()) return false;
      const MIN = currentSize;
      const BOX = currentSize;
      const root = doc.documentElement;

      clearMarks();

      const list = getCandidates(doc);
      if (!list.length) return false;

      const items = [];
      for (const el of list) {
        let r;
        try { r = el.getBoundingClientRect(); } catch { continue; }
        if (!r.width || !r.height) continue;
        let cs;
        try { cs = getComputedStyle(el); } catch { continue; }
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        items.push({ el, cs, r, small: r.width < MIN || r.height < MIN });
      }

      const hadSmall = items.some((it) => it.small);
      if (!hadSmall) return false;

      const docW = root.clientWidth;
      const docSW = root.scrollWidth;
      let rects = items.map((it) => ({ el: it.el, r: it.el.getBoundingClientRect() }));
      const grown = [];

      for (const it of items) {
        const { el, cs, r } = it;
        if (!it.small || el.disabled) continue;
        const tag = el.tagName.toUpperCase();
        const type = (el.getAttribute('type') || '').toLowerCase();

        if (tag === 'INPUT' && BOX_TYPES.test(type)) {
          if (cs.opacity !== '0' && cs.position !== 'absolute' && (r.width < BOX || r.height < BOX)) {
            it.kind = 'box';
          }
          const label = el.closest('label') || (el.labels && el.labels[0]);
          if (label) {
            try {
              if (getComputedStyle(label).pointerEvents === 'none') {
                s.setAttr(label, MARK, 'label');
                marked.add(label);
              }
            } catch {}
          }
          if (it.kind !== 'box') it.kind = 'input';
          continue;
        }

        if (cs.display === 'inline' || cs.display === 'contents') continue;
        const role = (el.getAttribute('role') || '').toLowerCase();
        const text = (el.textContent || '').trim();
        const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;
        const looksLikeButton = !isClear(cs.backgroundColor) || (parseFloat(cs.borderTopWidth) > 0 && !isClear(cs.borderTopColor));
        const overlaid = cs.position === 'absolute' || cs.position === 'fixed';
        const growable = !overlaid && (tag === 'BUTTON' || tag === 'SELECT' || tag === 'SUMMARY' ||
          (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) || GROW_ROLES.test(role) || iconLike ||
          (tag !== 'LABEL' && looksLikeButton));

        if (!growable) continue;

        const p = el.parentElement, g = p && p.parentElement;
        it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
        it.kind = 'grow';
        it.needsGlyph = text && parseFloat(cs.fontSize) < MIN * 0.45 && iconLike;
        s.setAttr(el, MARK, it.needsGlyph ? 'grow glyph' : 'grow');
        marked.add(el);
        grown.push(it);
      }

      sheet.update(baseRules(MIN, BOX));

      const undo = grown.filter((it) => {
        const r = it.el.getBoundingClientRect();
        return it.before.some(([a, w, h]) => (a.scrollWidth - a.clientWidth) > w + 1 || (a.scrollHeight - a.clientHeight) > h + 1) ||
          (r.right > docW + 0.5 && it.r.right <= docW + 0.5);
      });
      for (const it of undo) {
        s.setAttr(it.el, MARK, null);
        it.kind = null;
      }
      if (grown.length && root.scrollWidth > docSW + 1) {
        for (const it of grown) {
          if (it.kind === 'grow') {
            s.setAttr(it.el, MARK, null);
            it.kind = null;
          }
        }
      }

      rects = items.map((it) => ({ el: it.el, r: it.el.getBoundingClientRect() }));
      const hits = [];

      for (const it of items) {
        if (!it.small || it.kind) continue;
        const { el, cs } = it;
        if (NO_PSEUDO.test(el.tagName) || el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) continue;
        if (el.getClientRects().length > 1) continue;
        if (cs.overflow !== 'visible') continue;
        const after = getComputedStyle(el, '::after').content;
        if (after && after !== 'none' && after !== 'normal') continue;

        const inner = el.querySelector(TARGETS);
        if (inner && !(el.tagName === 'LABEL' && [...el.querySelectorAll(TARGETS)].every((c) => c.tagName === 'INPUT'))) continue;

        const relative = cs.position === 'static';
        if (relative && [...el.querySelectorAll('*')].some((d) => /absolute|fixed/.test(getComputedStyle(d).position))) continue;

        const diffX = Math.max(0, MIN - r.width);
        const diffY = Math.max(0, MIN - r.height);
        const tWant = Math.ceil(diffY / 2);
        const bWant = Math.floor(diffY / 2);
        const lWant = Math.ceil(diffX / 2);
        const rtWant = Math.floor(diffX / 2);

        let top = tWant, bottom = bWant, left = lWant, right = rtWant;

        for (const o of rects) {
          if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
          const q = o.r;
          const overlapX = q.left < r.right + right && q.right > r.left - left;
          const overlapY = q.top < r.bottom + bottom && q.bottom > r.top - top;
          if (overlapX && q.bottom <= r.top + 0.5) top = Math.min(top, Math.max(0, Math.floor((r.top - q.bottom - 1) / 2)));
          if (overlapX && q.top >= r.bottom - 0.5) bottom = Math.min(bottom, Math.max(0, Math.floor((q.top - r.bottom - 1) / 2)));
          if (overlapY && q.right <= r.left + 0.5) left = Math.min(left, Math.max(0, Math.floor((r.left - q.right - 1) / 2)));
          if (overlapY && q.left >= r.right - 0.5) right = Math.min(right, Math.max(0, Math.floor((q.left - r.right - 1) / 2)));
        }

        let box = { left: 0, right: docW, top: -window.scrollY, bottom: root.scrollHeight - window.scrollY };
        for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
          const sStyle = getComputedStyle(a);
          if (sStyle.overflowX !== 'visible' || sStyle.overflowY !== 'visible') {
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
        if (t + b + l + rt < 1) continue;
        hits.push({ el, relative, t, b, l, rt });
      }

      let num = 1;
      const perElement = [];

      for (const it of items) {
        if (it.kind === 'box') {
          const diffX = Math.max(0, BOX - it.r.width);
          const diffY = Math.max(0, BOX - it.r.height);
          const padX = Math.round(diffX / 2);
          const padY = Math.round(diffY / 2);
          s.setAttr(it.el, NUM, String(num));
          s.setAttr(it.el, MARK, 'box');
          marked.add(it.el);
          perElement.push(`html.ai4a11y-bigger-targets [${NUM}="${num}"] { width: ${BOX}px !important; height: ${BOX}px !important; margin: -${padY}px -${padX}px !important; flex-shrink: 0 !important; }`);
          num++;
        } else if (it.kind === 'grow') {
          s.setAttr(it.el, NUM, String(num));
          s.setAttr(it.el, MARK, it.needsGlyph ? 'grow glyph' : 'grow');
          marked.add(it.el);
          num++;
        }
      }

      for (const h of hits) {
        s.setAttr(h.el, NUM, String(num));
        s.setAttr(h.el, MARK, h.relative ? 'hit rel' : 'hit');
        marked.add(h.el);
        perElement.push(`html.ai4a11y-bigger-targets [${NUM}="${num}"]::after { top: -${h.t}px; right: -${h.rt}px; bottom: -${h.b}px; left: -${h.l}px; }`);
        num++;
      }

      sheet.update(baseRules(MIN, BOX) + '\n' + perElement.join('\n'));
      return true;
    }

    const applied = apply();
    if (!applied) {
      s.end();
      this.s = null;
      return false;
    }

    let resizeTimer = null;
    s.listen(window, 'resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => apply(), 300);
    });

    s.watch.added(doc.body, () => apply(), { debounceMs: 400 });

    s.keys.shortcut({ code: 'KeyP', alt: true, shift: true }, async () => {
      const idx = CYCLE_SIZES.indexOf(currentSize);
      const nextSize = idx !== -1 ? CYCLE_SIZES[(idx + 1) % CYCLE_SIZES.length] : 24;
      currentSize = nextSize;
      apply();
      await s.profile.set({ targetSize: nextSize });
      s.announce(`Target size ${nextSize} pixels on this site. Press Alt+Shift+K to use on every site.`);
    });

    s.keys.shortcut({ code: 'KeyK', alt: true, shift: true }, async () => {
      await s.profile.set({ targetSize: currentSize }, { scope: 'all' });
      s.announce(`Target size ${currentSize} pixels on every site.`);
    });

    s.profile.onChange((newPersonal, changed) => {
      if ('bigTargets' in changed && newPersonal.bigTargets === false) {
        clearMarks();
        return;
      }
      if ('targetSize' in changed && newPersonal.targetSize && newPersonal.targetSize !== currentSize) {
        currentSize = newPersonal.targetSize;
        apply();
      }
    });

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  }
};
