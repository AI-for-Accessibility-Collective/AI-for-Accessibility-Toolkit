// Block 7, tooltip: content shown on hover or focus that meets WCAG 1.4.13.
//
//   s.tooltip({ trigger: 'abbr[title]', content: 'title' })
//   s.tooltip({ trigger: '.term', content: (el) => s.ai.text('define', el.textContent, { context }) })
//
// Not configurable, because each was a bug in an adapter that built its own:
//   - it can be hovered: the pointer can move onto it without it closing;
//   - Escape closes it, and it stays closed while the pointer or focus stays
//     on that trigger;
//   - it stays while its trigger has focus;
//   - a click never closes what the same click's hover or focus opened;
//   - a late answer never opens it after it was closed or moved on;
//   - it is measured at full width before it is placed, and never covers
//     the focused element (2.4.11).

import { resolveConfig } from './shared.js';

export const TOOLTIP_DEFAULTS = {
  trigger: '[title]', content: 'title', delayMs: 350, hideDelayMs: 150,
  placement: 'below', describe: true, maxWidth: 320, theme: 'dark', fontScale: 100,
};

const THEMES = {
  dark: 'background:#1f1f1f;color:#ffffff;border:1px solid #ffffff;',
  light: 'background:#ffffff;color:#1f1f1f;border:1px solid #1f1f1f;',
};

export function tooltipBlock(s, env) {
  const { doc, win } = env;
  let n = 0;

  return function tooltip(opts = {}) {
    const c = resolveConfig(TOOLTIP_DEFAULTS, opts, env.personal, { fontScale: 'fontScale' });
    if (!s.alive()) return null;
    const id = `ai4a11y-tip-${s.id}-${++n}`.replace(/[^\w-]/g, '-');
    const tip = s.el('div', { attrs: { role: 'tooltip', id } });
    tip.hidden = true;
    const scale = Math.max(1, (Number(c.fontScale) || 100) / 100);
    s.css(`tip-${n}`, `#${id} { position: fixed; left: 0; top: 0; z-index: 2147483646; box-sizing: border-box;
  max-width: min(${Number(c.maxWidth) || 320}px, calc(100vw - 16px)); padding: 8px 10px; border-radius: 6px;
  font: ${Math.round(14 * scale)}px/1.45 system-ui, sans-serif; text-align: start; white-space: normal;
  ${THEMES[c.theme] || THEMES.dark} box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: auto; }
#${id}[hidden] { display: none !important; }`);
    s.append(doc.body, tip);

    let current = null;      // the trigger whose tooltip is open or opening
    let token = 0;           // increments on every open and close: late answers check it
    let showTimer = 0, hideTimer = 0;
    let pointerAt = null;    // the element under the pointer
    const dismissed = new Set();
    const titles = new WeakMap();

    // A trigger whose title this block moved off still counts, though it
    // may no longer match a selector like 'abbr[title]'.
    const triggerOf = (node) => {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || !el.closest || tip.contains(el)) return null;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (titles.has(n)) return n;
        try { if (n.matches(c.trigger)) return n; } catch { return null; }
      }
      return null;
    };
    const has = (el, node) => !!(el && node && (el === node || el.contains(node)));
    const overTip = () => has(tip, pointerAt);
    const focused = (t) => has(t, doc.activeElement);
    // Escape keeps a trigger closed only while the person stays on it.
    const forgetDismissed = () => {
      for (const t of [...dismissed]) if (!has(t, pointerAt) && !focused(t)) dismissed.delete(t);
    };

    const describe = (t, on) => {
      if (!c.describe) return;
      const ids = (t.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter((x) => x !== id);
      if (on) ids.push(id);
      if (ids.length) t.setAttribute('aria-describedby', ids.join(' '));
      else t.removeAttribute('aria-describedby');
      env.shared.ourAttrs.set(t, new Map([...(env.shared.ourAttrs.get(t) || []), ['aria-describedby', t.getAttribute('aria-describedby')]]));
    };

    function hide() {
      token++;
      if (showTimer) showTimer();
      if (hideTimer) hideTimer();
      if (current) describe(current, false);
      current = null;
      tip.hidden = true;
    }

    function place(t) {
      // Measure at full width: a tooltip measured where it last sat, squeezed
      // against the edge, is placed too narrow.
      tip.style.left = '0px';
      tip.style.top = '0px';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const r = t.getBoundingClientRect();
      const vw = win.innerWidth || doc.documentElement.clientWidth, vh = win.innerHeight || doc.documentElement.clientHeight;
      const gap = 6;
      const below = r.bottom + gap, above = r.top - gap - h;
      const left = Math.max(4, Math.min(r.left, vw - w - 4));
      const fits = (top) => top >= 0 && top + h <= vh;
      const covers = (top) => {
        const f = doc.activeElement;
        if (!f || f === doc.body || has(t, f) || has(tip, f)) return false;
        const fr = f.getBoundingClientRect();
        return fr.width && !(fr.right <= left || fr.left >= left + w || fr.bottom <= top || fr.top >= top + h);
      };
      const order = c.placement === 'above' ? [above, below] : [below, above];
      const top = order.find((y) => fits(y) && !covers(y)) ?? order.find(fits) ?? Math.max(0, Math.min(below, vh - h));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    }

    async function open(t) {
      if (!s.alive() || dismissed.has(t)) return;
      if (hideTimer) hideTimer();
      if (current === t && !tip.hidden) return;
      if (current && current !== t) describe(current, false);
      current = t;
      const my = ++token;
      let content;
      try {
        if (c.content === 'title') {
          if (t.hasAttribute('title')) {
            titles.set(t, t.getAttribute('title'));
            // The browser's own tooltip would show the same text on top.
            s.setAttr(t, 'title', null);
          }
          content = titles.get(t) || '';
        } else {
          content = typeof c.content === 'function' ? c.content(t) : c.content;
        }
        if (content && typeof content.then === 'function') content = await content;
      } catch { content = null; }
      // Closed, dismissed or moved on while the answer was on its way.
      if (!s.alive() || my !== token || current !== t || dismissed.has(t)) return;
      if (content === null || content === undefined || content === '') { hide(); return; }
      tip.textContent = '';
      if (typeof content === 'string') tip.textContent = content; else tip.append(content);
      tip.hidden = false;
      describe(t, true);
      place(t);
    }

    function scheduleHide() {
      if (hideTimer) hideTimer();
      hideTimer = s.timer(() => {
        if (!current) return;
        if (overTip() || has(current, pointerAt) || focused(current)) return;
        hide();
      }, Number(c.hideDelayMs) || 0);
    }

    s.listen(doc, 'mouseover', (e) => {
      pointerAt = e.target;
      forgetDismissed();
      if (has(tip, e.target)) { if (hideTimer) hideTimer(); return; }
      const t = triggerOf(e.target);
      if (t && t === current) { if (hideTimer) hideTimer(); return; }
      if (showTimer) showTimer();
      if (t) showTimer = s.timer(() => { if (has(t, pointerAt)) open(t); }, Number(c.delayMs) || 0);
      if (current) scheduleHide();
    }, true);
    s.listen(doc, 'mouseout', (e) => {
      if (e.relatedTarget) return;
      pointerAt = null;   // left the window
      if (current) scheduleHide();
    }, true);
    s.listen(doc, 'focusin', (e) => {
      forgetDismissed();
      const t = triggerOf(e.target);
      if (t) { if (showTimer) showTimer(); open(t); } else if (current && !has(tip, e.target)) scheduleHide();
    }, true);
    s.listen(doc, 'focusout', (e) => {
      if (current && has(current, e.target) && !has(current, e.relatedTarget)) scheduleHide();
      for (const t of [...dismissed]) if (has(t, e.target) && !has(t, e.relatedTarget) && !has(t, pointerAt)) dismissed.delete(t);
    }, true);
    s.listen(doc, 'keydown', (e) => {
      // Also while its answer is on its way: it must not open afterwards.
      if (e.key !== 'Escape' || !current) return;
      dismissed.add(current);
      hide();
    }, true);
    s.onEnd(hide);

    return {
      el: tip,
      open: (t) => open(t),
      hide,
      get trigger() { return current; },
    };
  };
}
