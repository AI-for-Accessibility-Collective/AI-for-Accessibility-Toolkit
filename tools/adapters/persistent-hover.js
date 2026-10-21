// Persistent Hover — keeps hover-revealed content on screen until the user
// dismisses it (WCAG 1.4.13 Content on Hover or Focus). CSS :hover tooltips
// and native `title` bubbles vanish the moment the pointer drifts, so
// low-vision users — who move slowly or track a magnified viewport — never
// get to read them. This adapter mirrors `title` text into one accessible
// tooltip that STAYS: it is hoverable (pointer-events: auto, per 1.4.13),
// survives plain mouseout, and hides only on Escape or when the pointer
// reaches a different titled element.
//
// Pop-ups the page opens with CSS :hover (e.g. `.tip:hover .bubble { display:
// block }`) have no title to mirror and close the moment the pointer leaves.
// Each such rule is copied with :hover swapped for an attribute, and the last
// element the pointer opened keeps that attribute, so its pop-up stays open
// until Escape or until the pointer opens another one.
//
// Reversible by construction: one injected stylesheet, one tooltip element,
// two document listeners stored as refs, and the attribute on at most one
// element — disable() removes exactly those and never touches the page's own
// titles or styles.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';

const OPEN_ATTR = 'data-ai4a11y-hover-open';
const HOVER = /:hover(?![\w-])/g;

// Split a selector list on its top-level commas (not those inside :is(...)).
function splitSelectors(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// For a selector like `.card:hover > .btn`, the element whose hover reveals
// something (`.card`); null when :hover styles the hovered element itself
// (`a:hover`) or sits inside a functional pseudo-class.
function hoverTrigger(sel) {
  const m = /:hover(?![\w-])/.exec(sel);
  if (!m) return null;
  let depth = 0, i;
  for (i = 0; i < m.index; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
  }
  if (depth) return null;
  for (i = m.index + 6; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    else if (!depth && /[\s>+~]/.test(c)) break;
  }
  if (!sel.slice(i).trim()) return null;
  let trigger = sel.slice(0, i).replace(HOVER, '').trim();
  if (!trigger || /[\s>+~]$/.test(trigger)) trigger += '*';
  return trigger;
}

// Declarations that make something appear.
function reveals(style) {
  const d = style.getPropertyValue('display'), v = style.getPropertyValue('visibility'), o = style.getPropertyValue('opacity');
  return (d && d !== 'none') || v === 'visible' || (o !== '' && parseFloat(o) > 0);
}

export const PersistentHover = {
  styleId: 'ai4a11y-persistent-hover-styles',
  tipId: 'ai4a11y-hover-tip',
  enabled: false,
  style: null,           // injectStyle handle
  tip: null,             // the single reusable tooltip element
  current: null,         // the titled element the tooltip is showing for
  triggers: '',          // selector list of elements whose :hover reveals a pop-up
  opened: null,          // the one element holding OPEN_ATTR
  onMouseOver: null,     // stored listener refs (for exact removal)
  onKeyDown: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    // High-contrast on both light and dark pages; overridable for
    // user-profile theming.
    const background = (options && options.background) || '#1c1c1e';
    const color = (options && options.color) || '#ffffff';
    const kept = this.hoverRules();
    this.triggers = kept.triggers.join(', ');
    this.style = injectStyle(this.styleId, kept.css + `
      #${this.tipId} {
        position: fixed;
        z-index: 2147483647;
        max-width: 320px;
        padding: 8px 12px;
        border-radius: 6px;
        background: ${background};
        color: ${color};
        font: 500 15px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        pointer-events: auto !important;
      }
    `);

    const tip = document.createElement('div');
    tip.id = this.tipId;
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    // Inline too, so the tooltip is hoverable even if the page's own CSS
    // out-specifies our stylesheet.
    tip.style.pointerEvents = 'auto';
    (document.body || document.documentElement).appendChild(tip);
    this.tip = tip;

    // Show the tooltip when the pointer reaches a titled element. Untitled
    // targets (and the tooltip itself) are ignored, so plain mouseout never
    // hides it — that persistence is the whole point.
    this.onMouseOver = (e) => {
      if (!this.enabled) return;
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      if (this.tip && (target === this.tip || this.tip.contains(target))) return;
      this.keepOpen(target);
      const el = target.closest ? target.closest('[title]') : null;
      if (!el) return;
      const text = (el.getAttribute('title') || '').trim();
      if (!text || el === this.current) return;
      this.show(el, text);
    };
    document.addEventListener('mouseover', this.onMouseOver, true);

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.key === 'Escape') { this.hide(); this.close(); }
    };
    document.addEventListener('keydown', this.onKeyDown, true);

    console.log('[AI4A11y] Persistent Hover enabled');
    announce('Hover tooltips now stay on screen. Press Escape to dismiss one');
  },

  // Fill the tooltip with the element's title text (textContent, never
  // innerHTML) and place it just below the element.
  show(el, text) {
    if (!this.tip) return;
    this.current = el;
    this.tip.textContent = text;
    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { /* detached */ }
    // position: fixed → viewport coordinates apply directly. No scroll offsets,
    // and no dependence on the initial containing block, which a positioned or
    // transformed ancestor would otherwise shift the tooltip against.
    const x = rect ? rect.left : 0;
    const y = (rect ? rect.bottom : 0) + 6;
    this.tip.style.left = `${Math.max(0, x)}px`;
    this.tip.style.top = `${Math.max(0, y)}px`;
    this.tip.hidden = false;
  },

  hide() {
    if (this.tip) this.tip.hidden = true;
    this.current = null;
  },

  // Copies of the page's :hover rules that reveal something, keyed to
  // OPEN_ATTR instead of :hover. Same specificity as the originals and later
  // in the page, so they show exactly what hovering shows. Stylesheets from
  // other origins can't be read and are skipped.
  hoverRules() {
    const out = { css: '', triggers: [] };
    if (typeof document === 'undefined' || !document.styleSheets) return out;
    const walk = (rules, wrap) => {
      for (const rule of Array.from(rules || [])) {
        try {
          if (rule.selectorText && rule.style && rule.selectorText.includes(':hover') && reveals(rule.style)) {
            const keep = [];
            for (const sel of splitSelectors(rule.selectorText)) {
              const trigger = hoverTrigger(sel);
              if (!trigger) continue;
              keep.push(sel.replace(HOVER, `[${OPEN_ATTR}]`));
              if (!out.triggers.includes(trigger)) out.triggers.push(trigger);
            }
            if (keep.length) out.css += wrap(`${keep.join(', ')} { ${rule.style.cssText} }`) + '\n';
          } else if (rule.cssRules) {
            const cond = rule.media ? `@media ${rule.media.mediaText}` : rule.conditionText ? `@supports ${rule.conditionText}` : '';
            walk(rule.cssRules, cond ? (css) => wrap(`${cond} { ${css} }`) : wrap);
          }
        } catch { /* a rule it can't read */ }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode && sheet.ownerNode.id && sheet.ownerNode.id.startsWith('ai4a11y-')) continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; /* another origin */ }
      walk(rules, (css) => css);
    }
    // A trigger that isn't a valid selector here would make closest() throw.
    out.triggers = out.triggers.filter((t) => { try { document.documentElement.matches(t); return true; } catch { return false; } });
    return out;
  },

  // The pointer reached `el`: if it is in an element whose :hover opens a
  // pop-up, that element's pop-up stays open (and any other one closes).
  keepOpen(el) {
    if (!this.triggers || !el.closest) return;
    let host = null;
    try { host = el.closest(this.triggers); } catch { return; }
    if (!host || host === this.opened) return;
    this.close();
    host.setAttribute(OPEN_ATTR, '');
    this.opened = host;
  },

  close() {
    if (this.opened) { try { this.opened.removeAttribute(OPEN_ATTR); } catch { /* detached */ } }
    this.opened = null;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.onMouseOver) { document.removeEventListener('mouseover', this.onMouseOver, true); this.onMouseOver = null; }
    if (this.onKeyDown) { document.removeEventListener('keydown', this.onKeyDown, true); this.onKeyDown = null; }
    if (this.style) { this.style.remove(); this.style = null; }
    if (this.tip) { this.tip.remove(); this.tip = null; }
    this.current = null;
    this.close();
    this.triggers = '';
    console.log('[AI4A11y] Persistent Hover disabled');
    announce('Persistent hover off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yPersistentHover = PersistentHover;
