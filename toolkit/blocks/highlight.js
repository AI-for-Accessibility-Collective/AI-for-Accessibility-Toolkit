// Block 5, highlight: show the person where they are.
//
//   s.highlight.element(el, opts)  mark an element (background, outline or underline)
//   s.highlight.range(range, opts) mark a stretch of text without changing the page's nodes
//   s.highlight.follow(opts)       a band that follows the pointer or focus (a reading ruler)
//   s.highlight.focusRing(opts)    a strong focus ring on every focusable element
//
// Contrast is checked: a highlight that would make text unreadable is not
// drawn that way (a background that fails 4.5:1 against the text becomes an
// outline). Ranges use the CSS Custom Highlight API, so highlighting words
// never wraps or splits the page's text. Motion follows reduced motion.

import { resolveConfig, reducedMotion } from './shared.js';
import { backgroundOf, textColorOf, contrast, pick, parseColor } from './color.js';

const BACKGROUNDS = ['#fff3a0', '#ffe066', '#cfe8ff', '#d4f5d4', '#1a1a1a'];
const LINES = ['#1a5fb4', '#c01c28', '#9a5b00', '#000000', '#ffbf00', '#ffffff'];

export const HIGHLIGHT_DEFAULTS = { style: 'background', color: 'auto', width: 3 };
export const FOLLOW_DEFAULTS = { source: ['pointer', 'focus'], height: 40, dimOutside: 0.4, color: '#ffe066' };
export const RING_DEFAULTS = { color: 'auto', width: 3 };

export function highlightBlock(s, env) {
  const { doc, win } = env;
  let n = 0;

  // How to draw a highlight on `el` that keeps its text readable.
  function paint(el, c) {
    const text = textColorOf(el, win);
    const bg = backgroundOf(el, win);
    if (c.style === 'background') {
      const wanted = c.color === 'auto' ? null : parseColor(c.color);
      const color = wanted && contrast(wanted, text) >= 4.5 ? c.color : pick(BACKGROUNDS, text, 4.5);
      if (color) return `background-color: ${color} !important; box-shadow: 0 0 0 2px ${color} !important;`;
    }
    const wanted = c.color === 'auto' || c.style === 'background' ? null : parseColor(c.color);
    const line = wanted && contrast(wanted, bg) >= 3 ? c.color : pick(LINES, bg, 3) || '#000000';
    if (c.style === 'underline') return `text-decoration: underline ${c.width}px ${line} !important; text-underline-offset: 3px !important;`;
    return `outline: ${c.width}px solid ${line} !important; outline-offset: 2px !important;`;
  }

  function element(target, opts = {}) {
    const c = resolveConfig(HIGHLIGHT_DEFAULTS, opts, env.personal, {});
    const cls = `ai4a11y-hl-${s.id}-${++n}`;
    const sheet = s.css(`hl-${n}`, '');
    let current = null;
    const move = (el) => {
      if (!s.alive()) return;
      if (current && current !== el) current.classList.remove(cls);
      current = el || null;
      if (!current) return;
      sheet?.update(`.${cls} { ${paint(current, c)} }`);
      if (!current.classList.contains(cls)) current.classList.add(cls);
    };
    s.onEnd(() => { if (current) { current.classList.remove(cls); if (!current.getAttribute('class')) current.removeAttribute('class'); } current = null; });
    move(target);
    return { move, clear: () => move(null), get element() { return current; } };
  }

  function range(initial, opts = {}) {
    const c = resolveConfig({ color: 'auto' }, opts, env.personal, {});
    const name = `ai4a11y-${s.id}-r${++n}`.replace(/[^\w-]/g, '-');
    const registry = win.CSS && win.CSS.highlights;
    const supported = !!(registry && typeof win.Highlight === 'function');
    // Both colours are set, so the text stays readable whatever the page's.
    const bg = c.color === 'auto' ? '#ffe066' : c.color;
    const fg = contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff';
    s.css(`range-${n}`, `::highlight(${name}) { background-color: ${bg}; color: ${fg}; }`);
    const hl = supported ? new win.Highlight() : null;
    if (hl) { registry.set(name, hl); s.onEnd(() => registry.delete(name)); }
    const move = (r) => {
      if (!hl || !s.alive()) return;
      hl.clear();
      if (r) hl.add(r);
    };
    move(initial);
    return { move, clear: () => move(null), supported };
  }

  function follow(opts = {}) {
    const c = resolveConfig(FOLLOW_DEFAULTS, opts, env.personal, {});
    const sources = Array.isArray(c.source) ? c.source : [c.source];
    const still = reducedMotion(env);
    const pane = (name) => {
      const el = s.el('div', { attrs: { 'aria-hidden': 'true', 'data-ai4a11y-band': name } });
      el.setAttribute('style', `position:fixed;left:0;right:0;pointer-events:none;z-index:2147483645;${still ? '' : 'transition:top .08s linear,height .08s linear;'}`);
      return s.append(doc.body, el);
    };
    const dim = Math.max(0, Math.min(0.9, Number(c.dimOutside) || 0));
    const above = dim ? pane('above') : null;
    const band = pane('band');
    const below = dim ? pane('below') : null;
    const h = Math.max(8, Number(c.height) || 40);
    if (dim) {
      above.style.background = below.style.background = `rgba(0,0,0,${dim})`;
      above.style.top = '0px';
      band.style.background = 'transparent';
    } else {
      band.style.background = c.color;
      band.style.opacity = '0.3';
      band.style.mixBlendMode = 'multiply';
    }
    let y = (win.innerHeight || 600) / 2;
    const draw = () => {
      const top = Math.round(y - h / 2);
      band.style.top = `${top}px`;
      band.style.height = `${h}px`;
      if (dim) {
        above.style.height = `${Math.max(0, top)}px`;
        below.style.top = `${top + h}px`;
        below.style.bottom = '0px';
      }
    };
    let queued = false;
    const moveTo = (nextY) => {
      y = nextY;
      if (queued) return;
      queued = true;
      s.frame(() => { queued = false; draw(); });
    };
    if (sources.includes('pointer')) s.listen(doc, 'pointermove', (e) => moveTo(e.clientY), { passive: true, capture: true });
    if (sources.includes('focus')) {
      s.listen(doc, 'focusin', (e) => {
        const r = e.target?.getBoundingClientRect?.();
        if (r && r.height) moveTo(r.top + r.height / 2);
      }, true);
    }
    draw();
    const panes = [above, band, below].filter(Boolean);
    return {
      moveTo,
      hide: () => panes.forEach((p) => { p.hidden = true; }),
      show: () => panes.forEach((p) => { p.hidden = false; }),
    };
  }

  function focusRing(opts = {}) {
    const c = resolveConfig(RING_DEFAULTS, opts, env.personal, {});
    const width = Math.max(2, Math.min(8, Number(c.width) || 3));
    const color = c.color === 'auto' ? '#1a5fb4' : c.color;
    const scope = `ai4a11y-ring-${s.id}`.replace(/[^\w-]/g, '-');
    // Two rings, a light one inside a dark one, so one of them shows on any
    // background; the box-shadow survives a page's outline: none !important.
    s.css('ring', `html.${scope} :focus-visible {
  outline: ${width}px solid ${color} !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 2px #ffffff, 0 0 0 ${width + 2}px ${color} !important;
}`, { scope });
    return { scope };
  }

  return { element, range, follow, focusRing };
}
