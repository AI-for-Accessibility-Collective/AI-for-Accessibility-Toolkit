// bigger-targets.js — Enlarges small links, buttons, and form controls to at least targetSize CSS pixels.
// Barrier: Small clickable controls are difficult or impossible for people with motor
// differences, tremors, limited fine motor control, or alternative input devices to hit reliably (WCAG 2.5.8 / 2.5.5).
//
// Suggested in onboarding for: motor (a suggestion only, never a gate).
// The person's settings it reads: targetSize, bigTargets.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Target size',
// settings ['targetSize']): up and down step targetSize through 24, 32, 44 pixels, saved for this site and announced.
//
// Options:
//   targetSize: Smallest size of an interactive control in CSS pixels. Defaults to 24 (WCAG 2.5.8 minimum; 44 is WCAG 2.5.5).
//
// Decisions:
//   • Measures interactive controls before changing anything, modifying only those that are smaller than targetSize.
//   • Prefers growing hit areas without moving surrounding content (pseudo-elements or padding with negative margin),
//     ensuring the page reflows at most once at enable() and layout shift stays under 0.1.
//   • Inline links in running text maintain line-height and line readability without doubling line spacing.
//   • Never shrinks any element that already meets or exceeds targetSize.
//   • Never covers neighbouring targets: hit areas expand into free space and take at most half the distance to adjacent targets.
//   • A new targetSize redoes all sizes in a new s.group(), cleanly undoing previous styles without clearing on page changes.
//   • Uses s.watch.added with { batch: true } to process dynamically added elements in a single pass without re-measuring existing targets.
//   • Focus styles are left entirely to the browser or dedicated focus adapters (nothing outside its job).
//   • All added rules, classes, and attributes are fully reversible on disable() via the session.
//
// What it cannot do:
//   • Cannot expand targets within native OS dropdown dialogs or third-party cross-origin iframes.
//   • Cannot guarantee 44px targets when adjacent interactive controls touch with zero clearance without overlapping.

const TARGET_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
];
const TARGETS = TARGET_SELECTORS.join(',');
const MARK = 'data-ai4a11y-bt';
const ID_ATTR = 'data-ai4a11y-bt-id';
const NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|svg|OBJECT|EMBED)$/i;
const BOX_TYPES = /^(checkbox|radio)$/i;
const NO_GROW_TYPES = /^(hidden|range|file|color|image)$/i;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/i;

function isClear(color) {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

function hasExistingAfter(el) {
  try {
    const after = window.getComputedStyle(el, '::after').content;
    return !!after && after !== 'none' && after !== 'normal';
  } catch {
    return false;
  }
}

function getNextSize(current) {
  if (current < 24) return 24;
  if (current < 32) return 32;
  return 44;
}

function getPrevSize(current) {
  if (current > 32) return 32;
  if (current > 24) return 24;
  return current <= 0 ? 0 : 24;
}

function markElement(el, token, group) {
  const cur = el.getAttribute(MARK) || '';
  const tokens = new Set(cur ? cur.split(/\s+/) : []);
  for (const t of token.split(/\s+/)) {
    if (t) tokens.add(t);
  }
  group.setAttr(el, MARK, [...tokens].join(' '));
}

function unmarkElement(el, group, ...tokensToRemove) {
  const cur = el.getAttribute(MARK) || '';
  const tokens = (cur ? cur.split(/\s+/) : []).filter((t) => !tokensToRemove.includes(t));
  group.setAttr(el, MARK, tokens.length ? tokens.join(' ') : null);
}

function getCandidates(root, s) {
  const list = [];
  if (root.matches && root.matches(TARGETS)) {
    if (!s.page.isOurs(root) && !root.closest('[data-ai4a11y-ui]')) {
      if (!root.disabled && root.getAttribute('aria-disabled') !== 'true') {
        list.push(root);
      }
    }
  }
  const matches = root.querySelectorAll(TARGETS);
  for (const el of matches) {
    if (s.page.isOurs(el) || el.closest('[data-ai4a11y-ui]')) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') continue;
    const parentTarget = el.parentElement ? el.parentElement.closest(TARGETS) : null;
    if (parentTarget && !s.page.isOurs(parentTarget)) {
      if (!(parentTarget.tagName === 'LABEL' && el.tagName === 'INPUT')) {
        continue;
      }
    }
    list.push(el);
  }
  return list;
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const doc = document;
    if (!doc || (!doc.body && !doc.documentElement)) return false;

    const s = (this.s = this.toolkit.session());

    // Resolve initial target size
    const profileTargetSize = s.profile.get('targetSize');
    const bigTargetsPref = s.profile.get('bigTargets');
    let activeSize = 24;

    if (profileTargetSize !== undefined && profileTargetSize !== null && Number.isFinite(Number(profileTargetSize))) {
      activeSize = Number(profileTargetSize);
    } else if (bigTargetsPref === false) {
      activeSize = 0;
    } else if (this.options.targetSize !== undefined && Number.isFinite(Number(this.options.targetSize))) {
      activeSize = Number(this.options.targetSize);
    }

    let currentGroup = null;
    let processed = new WeakSet();
    let allTargetRects = [];
    let ruleCounter = 0;
    let rulesCss = '';
    let rulesSheet = null;

    const processTargets = (elements, group, targetSize) => {
      if (targetSize <= 0 || !group || group.ended) return;
      const root = doc.documentElement;
      const docW = root.clientWidth;
      const docSW = root.scrollWidth;
      const boxSize = Math.max(24, Math.min(targetSize, Math.round(targetSize * 0.55)));

      // ── READ PASS: detect small interactive elements
      const candidates = [];
      const scrollContainerCache = new WeakMap();
      for (const el of elements) {
        if (!el || !el.isConnected || processed.has(el)) continue;
        if (s.page.isOurs(el) || el.closest('[data-ai4a11y-ui]')) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

        const tag = el.tagName;
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'INPUT' && NO_GROW_TYPES.test(type)) continue;

        let r;
        try {
          r = el.getBoundingClientRect();
        } catch {
          continue;
        }
        if (r.width < 4 || r.height < 4) continue;

        let cs;
        try {
          cs = window.getComputedStyle(el);
        } catch {
          continue;
        }
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

        const isSmall = r.width < targetSize || r.height < targetSize;
        allTargetRects.push({ el, r });
        processed.add(el);

        if (!isSmall) continue;
        candidates.push({ el, cs, r });
      }

      if (!candidates.length) return;

      // ── WRITE PASS 1: marks for boxes and growable buttons
      const marks = [];
      const grown = [];

      for (const item of candidates) {
        const { el, cs, r } = item;
        const tag = el.tagName;
        const type = (el.getAttribute('type') || '').toLowerCase();

        // Checkboxes and radios
        if (tag === 'INPUT' && BOX_TYPES.test(type)) {
          if (cs.opacity !== '0' && cs.position !== 'absolute' && (r.width < boxSize || r.height < boxSize)) {
            marks.push([el, 'box']);
            item.kind = 'box';
          }
          let label = el.closest('label') || (el.labels && el.labels[0]);
          if (!label && el.id) {
            try {
              label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            } catch {
              label = null;
            }
          }
          if (label) {
            try {
              if (window.getComputedStyle(label).pointerEvents === 'none') {
                marks.push([label, 'label']);
              }
            } catch {
              /* ignore */
            }
          }
          continue;
        }

        // Inline elements don't accept min-width/min-height layout sizing
        if (cs.display === 'inline' || cs.display === 'contents') continue;

        const role = el.getAttribute('role') || '';
        const text = (el.textContent || '').trim();
        const iconLike = r.width < targetSize && r.height < targetSize && (text.length <= 2 || !!el.querySelector('svg, img, i'));
        const looksLikeButton = !isClear(cs.backgroundColor) || (parseFloat(cs.borderTopWidth) > 0 && !isClear(cs.borderTopColor));
        const overlaid = cs.position === 'absolute' || cs.position === 'fixed';
        const growable =
          !overlaid &&
          (tag === 'BUTTON' ||
            tag === 'SELECT' ||
            tag === 'SUMMARY' ||
            (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) ||
            GROW_ROLES.test(role) ||
            iconLike ||
            (tag !== 'LABEL' && looksLikeButton));

        if (!growable) continue;

        const p = el.parentElement;
        const g = p && p.parentElement;
        item.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
        item.kind = 'grow';
        const token = text && parseFloat(cs.fontSize) < targetSize * 0.45 && iconLike ? 'grow glyph' : 'grow';
        marks.push([el, token]);
        grown.push(item);
      }

      for (const [el, token] of marks) {
        markElement(el, token, group);
      }

      // ── READ PASS 2: check container overflow for grown elements
      if (grown.length) {
        const undo = grown.filter((it) => {
          const curR = it.el.getBoundingClientRect();
          return (
            it.before.some(([a, w, h]) => a.scrollWidth - a.clientWidth > w + 1 || a.scrollHeight - a.clientHeight > h + 1) ||
            (curR.right > docW + 0.5 && it.r.right <= docW + 0.5)
          );
        });

        for (const it of undo) {
          unmarkElement(it.el, group, 'grow', 'glyph');
          it.kind = null;
        }

        if (root.scrollWidth > docSW + 1) {
          for (const it of grown) {
            if (it.kind === 'grow') {
              unmarkElement(it.el, group, 'grow', 'glyph');
              it.kind = null;
            }
          }
        }
      }

      // ── READ PASS 3: calculate hit areas for remaining small controls
      const newRules = [];

      for (const item of candidates) {
        if (item.kind) continue;
        const { el, cs } = item;
        const curR = el.getBoundingClientRect();
        if (curR.width >= targetSize && curR.height >= targetSize) continue;
        if (el.getClientRects().length > 1) continue;

        const canPseudo = !NO_PSEUDO.test(el.tagName) && cs.overflow === 'visible' && !hasExistingAfter(el);

        // Check if control wraps other targets
        const inner = el.querySelector(TARGETS);
        if (inner && !(el.tagName === 'LABEL' && [...el.querySelectorAll(TARGETS)].every((c) => c.tagName === 'INPUT'))) {
          continue;
        }

        const wantX = Math.max(0, (targetSize - curR.width) / 2);
        const wantY = Math.max(0, (targetSize - curR.height) / 2);
        let top = wantY;
        let bottom = wantY;
        let left = wantX;
        let right = wantX;

        // Never cover neighbouring controls: take at most half the free space
        for (const o of allTargetRects) {
          if (o.el === el) continue;
          const q = o.r;
          if (q.bottom < curR.top - targetSize || q.top > curR.bottom + targetSize) continue;
          if (q.right < curR.left - targetSize || q.left > curR.right + targetSize) continue;
          if (o.el.contains(el) || el.contains(o.el)) continue;

          const overlapX = q.left < curR.right + right && q.right > curR.left - left;
          const overlapY = q.top < curR.bottom + bottom && q.bottom > curR.top - top;
          if (overlapX && q.bottom <= curR.top + 0.5) top = Math.min(top, Math.max(0, (curR.top - q.bottom) / 2));
          if (overlapX && q.top >= curR.bottom - 0.5) bottom = Math.min(bottom, Math.max(0, (q.top - curR.bottom) / 2));
          if (overlapY && q.right <= curR.left + 0.5) left = Math.min(left, Math.max(0, (curR.left - q.right) / 2));
          if (overlapY && q.left >= curR.right - 0.5) right = Math.min(right, Math.max(0, (q.left - curR.right) / 2));
        }

        // Clamp against scrollable container boundaries and page edges
        let box = { left: 0, right: docW, top: -window.scrollY, bottom: root.scrollHeight - window.scrollY };
        let scrollParent = null;
        for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
          if (scrollContainerCache.has(a)) {
            scrollParent = scrollContainerCache.get(a);
            break;
          }
          let sBox;
          try {
            sBox = window.getComputedStyle(a);
          } catch {
            continue;
          }
          if (sBox.overflowX !== 'visible' || sBox.overflowY !== 'visible') {
            scrollParent = a;
            break;
          }
        }
        if (el.parentElement) scrollContainerCache.set(el.parentElement, scrollParent);
        if (scrollParent) {
          const ar = scrollParent.getBoundingClientRect();
          const x0 = ar.left + scrollParent.clientLeft - scrollParent.scrollLeft;
          const y0 = ar.top + scrollParent.clientTop - scrollParent.scrollTop;
          box = { left: x0, right: x0 + scrollParent.scrollWidth, top: y0, bottom: y0 + scrollParent.scrollHeight };
        }

        const px = (v) => Math.max(0, Math.floor(v));
        const t = px(Math.min(top, curR.top - box.top));
        const b = px(Math.min(bottom, box.bottom - curR.bottom));
        const l = px(Math.min(left, curR.left - box.left));
        const rt = px(Math.min(right, box.right - curR.right));

        if (t + b + l + rt < 1) continue;

        ruleCounter++;
        const ruleId = ruleCounter;
        group.setAttr(el, ID_ATTR, String(ruleId));

        if (canPseudo) {
          const rel = cs.position === 'static';
          markElement(el, rel ? 'hit rel' : 'hit', group);
          newRules.push(
            `html.ai4a11y-bigger-targets [${ID_ATTR}="${ruleId}"]::after { top: -${t}px !important; right: -${rt}px !important; bottom: -${b}px !important; left: -${l}px !important; }`
          );
        } else {
          markElement(el, 'pad', group);
          newRules.push(
            `html.ai4a11y-bigger-targets [${ID_ATTR}="${ruleId}"] { padding-top: ${t}px !important; padding-right: ${rt}px !important; padding-bottom: ${b}px !important; padding-left: ${l}px !important; margin-top: -${t}px !important; margin-right: -${rt}px !important; margin-bottom: -${b}px !important; margin-left: -${l}px !important; }`
          );
        }
      }

      // ── WRITE PASS 4: update per-element hit area stylesheet
      if (newRules.length && rulesSheet) {
        rulesCss += (rulesCss ? '\n' : '') + newRules.join('\n');
        rulesSheet.update(rulesCss);
      }
    };

    const applyTargetSize = (size) => {
      if (currentGroup) {
        currentGroup.end();
        currentGroup = null;
      }

      processed = new WeakSet();
      allTargetRects = [];
      ruleCounter = 0;
      rulesCss = '';
      rulesSheet = null;

      if (size <= 0) return;

      currentGroup = s.group();
      const boxSize = Math.max(24, Math.min(size, Math.round(size * 0.55)));
      const baseCss = `
html.ai4a11y-bigger-targets [${MARK}~="grow"] {
  min-width: ${size}px !important;
  min-height: ${size}px !important;
}
html.ai4a11y-bigger-targets [${MARK}~="glyph"] {
  font-size: ${Math.max(12, Math.round(size * 0.45))}px !important;
}
html.ai4a11y-bigger-targets [${MARK}~="box"] {
  width: ${boxSize}px !important;
  height: ${boxSize}px !important;
  flex-shrink: 0 !important;
}
html.ai4a11y-bigger-targets [${MARK}~="label"] {
  pointer-events: auto !important;
  cursor: pointer !important;
}
html.ai4a11y-bigger-targets [${MARK}~="rel"] {
  position: relative !important;
}
html.ai4a11y-bigger-targets [${MARK}~="hit"]::after {
  content: "" !important;
  position: absolute !important;
  pointer-events: auto !important;
}
`;
      currentGroup.css('bt-base', baseCss, { scope: 'ai4a11y-bigger-targets' });
      rulesSheet = currentGroup.css('bt-rules', '');

      const root = doc.body || doc.documentElement;
      const initialCandidates = getCandidates(root, s);
      processTargets(initialCandidates, currentGroup, size);
    };

    // Apply current size
    applyTargetSize(activeSize);

    // Watch for elements added later in batches
    const root = doc.body || doc.documentElement;
    s.watch.added(
      root,
      (batch) => {
        if (activeSize <= 0 || !currentGroup || currentGroup.ended) return;
        const newCandidates = [];
        for (const node of batch) {
          if (node.nodeType !== 1) continue;
          if (s.page.isOurs(node) || node.closest('[data-ai4a11y-ui]')) continue;
          if (node.matches && node.matches(TARGETS) && !processed.has(node)) {
            if (!node.disabled && node.getAttribute('aria-disabled') !== 'true') {
              newCandidates.push(node);
            }
          }
          for (const child of node.querySelectorAll(TARGETS)) {
            if (!processed.has(child) && !s.page.isOurs(child) && !child.closest('[data-ai4a11y-ui]')) {
              if (!child.disabled && child.getAttribute('aria-disabled') !== 'true') {
                newCandidates.push(child);
              }
            }
          }
        }
        if (!newCandidates.length) return;
        processTargets(newCandidates, currentGroup, activeSize);
      },
      { batch: true }
    );

    // Follow profile changes made elsewhere
    s.profile.onChange((personal, changed) => {
      if (!changed) return;
      if ('targetSize' in changed || 'bigTargets' in changed) {
        let newSize = activeSize;
        if (changed.targetSize !== undefined && changed.targetSize !== null && Number.isFinite(Number(changed.targetSize))) {
          newSize = Number(changed.targetSize);
        } else if (changed.bigTargets === false && !('targetSize' in changed)) {
          newSize = 0;
        }
        if (newSize !== activeSize) {
          activeSize = newSize;
          applyTargetSize(newSize);
        }
      }
    });

    // Provide shortcut adjustment
    s.keys.adjust({
      label: 'Target size',
      settings: ['targetSize'],
      up: async () => {
        const next = getNextSize(activeSize);
        if (next !== activeSize) {
          const r = await s.profile.set({ targetSize: next });
          if (r && r.applied) {
            activeSize = next;
            applyTargetSize(next);
            s.announce(`Target size ${next} pixels on this site.`);
          }
        }
      },
      down: async () => {
        const prev = getPrevSize(activeSize);
        if (prev !== activeSize) {
          const r = await s.profile.set({ targetSize: prev });
          if (r && r.applied) {
            activeSize = prev;
            applyTargetSize(prev);
            s.announce(`Target size ${prev} pixels on this site.`);
          }
        }
      },
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
