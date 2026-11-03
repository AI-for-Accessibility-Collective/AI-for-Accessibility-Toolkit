// Persistent Hover — keeps hover-revealed content on screen until the user
// dismisses it (WCAG 1.4.13 Content on Hover or Focus). CSS :hover tooltips
// and native `title` bubbles vanish the moment the pointer drifts, so
// low-vision users — who move slowly or track a magnified viewport — never
// get to read them. This adapter mirrors `title` text into one accessible
// tooltip that STAYS: it is hoverable (pointer-events: auto, per 1.4.13),
// survives plain mouseout, works on keyboard focus (WCAG 2.1.1), and hides
// on Escape or when moving to a different titled element.
//
// Pop-ups the page opens with CSS :hover (e.g. `.tip:hover .bubble { display:
// block }`) have no title to mirror and close the moment the pointer leaves.
// Each such rule is copied with :hover swapped for an attribute, and the last
// element the pointer or focus opened keeps that attribute, so its pop-up
// stays open until Escape or until another one is opened. Moving focus away to
// an untitled element dismisses the tooltip so newly focused controls are never
// obscured (WCAG 2.4.11).
//
// Tooltip placement is constrained to the viewport so it never overflows off
// screen even at 320px narrow viewports (WCAG 1.4.10), flips above the trigger
// when needed to prevent obscuring content, and tracks scroll position.
//
// Reversible by construction: one injected stylesheet, one tooltip element,
// listeners stored as refs, and the attribute on at most one element —
// disable() removes exactly those and never touches the page's own titles or
// styles.
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
  dismissed: [],         // elements dismissed with Escape, until pointer/focus leaves them
  pointerAt: null,       // the element the pointer last moved onto (null: off the page)
  focusTimer: null,
  onMouseOver: null,     // stored listener refs (for exact removal)
  onMouseOut: null,
  onKeyDown: null,
  onFocusIn: null,
  onFocusOut: null,
  onScroll: null,

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
        max-width: min(320px, calc(100vw - 16px));
        box-sizing: border-box;
        overflow-wrap: break-word;
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
      this.pointerAt = target;
      if (this.tip && (target === this.tip || this.tip.contains(target))) return;
      if (this.isDismissed(target)) return;

      this.keepOpen(target);
      const el = target.closest ? target.closest('[title]') : null;
      if (!el) return;
      const text = (el.getAttribute('title') || '').trim();
      if (!text || el === this.current) return;
      this.show(el, text);
    };
    document.addEventListener('mouseover', this.onMouseOver, true);
    // The pointer left the page.
    this.onMouseOut = (e) => { if (!e.relatedTarget) this.pointerAt = null; };
    document.addEventListener('mouseout', this.onMouseOut, true);

    this.onFocusIn = (e) => {
      if (!this.enabled) return;
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      if (this.tip && (target === this.tip || this.tip.contains(target))) return;
      if (this.isDismissed(target)) return;

      this.keepOpen(target);
      const el = target.closest ? target.closest('[title]') : null;
      const text = el ? (el.getAttribute('title') || '').trim() : '';
      if (text && el !== this.current) this.show(el, text);
      // If focus moved away from the current titled element and neither it
      // nor the tooltip is under the pointer, hide the tooltip so it does not
      // obscure newly focused elements (WCAG 2.4.11).
      else if (this.current && this.current !== el && !this.hovered(this.current) && !this.hovered(this.tip)) this.hide();
      // If focus moved outside the opened CSS popup trigger, and it is not
      // hovered by the mouse, close it.
      if (this.opened && (!target.closest || !target.closest(this.triggers)) && !this.hovered(this.opened)) this.close();
    };
    document.addEventListener('focusin', this.onFocusIn, true);

    this.onFocusOut = (e) => {
      if (!this.enabled) return;
      // Focus left a dismissed element (and the pointer is not on it): it can open again.
      const next = e.relatedTarget;
      this.dismissed = this.dismissed.filter(d => this.hovered(d) || (next && d.contains(next)));
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        this.focusTimer = null;
        if (!this.enabled) return;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        if (!active || active === document.body || active === document.documentElement) {
          if (this.current && !this.hovered(this.current) && !this.hovered(this.tip)) this.hide();
          if (this.opened && !this.hovered(this.opened)) this.close();
        }
      }, 10);
    };
    document.addEventListener('focusout', this.onFocusOut, true);

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.key === 'Escape') {
        // What the pointer or focus is still on stays closed until they leave
        // it; what they had already left can open again straight away.
        const active = document.activeElement;
        this.dismissed = [this.current, this.opened].filter(d => d && (this.hovered(d) || (active && d.contains(active))));
        this.hide();
        this.close();
      }
    };
    document.addEventListener('keydown', this.onKeyDown, true);

    this.onScroll = () => {
      if (!this.enabled || !this.current || !this.tip) return;
      this.position(this.current);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
      window.addEventListener('resize', this.onScroll, { passive: true });
    }

    console.log('[AI4A11y] Persistent Hover enabled');
    announce('Hover tooltips now stay on screen. Press Escape to dismiss one');
  },

  // Under the pointer: where it last moved, or :hover.
  hovered(el) {
    if (!el) return false;
    if (this.pointerAt && el.contains(this.pointerAt)) return true;
    try { return el.matches(':hover'); } catch { return false; }
  },

  // Moving onto (or focusing) target leaves every dismissed element that does
  // not contain it; a dismissed element that does stays closed.
  isDismissed(target) {
    this.dismissed = this.dismissed.filter(d => d.contains(target));
    if (!this.dismissed.length) return false;
    const el = target.closest ? target.closest('[title]') : null;
    const host = (this.triggers && target.closest) ? target.closest(this.triggers) : null;
    return this.dismissed.some(d => d === el || d === host);
  },

  // Fill the tooltip with the element's title text (textContent, never
  // innerHTML) and position it safely within the viewport.
  show(el, text) {
    if (!this.tip) return;
    this.current = el;
    this.tip.textContent = text;
    this.position(el);
  },

  position(el) {
    if (!this.tip || !el) return;
    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { return; }
    if (!rect) return;

    const winW = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const winH = (typeof window !== 'undefined' && window.innerHeight) || 800;

    // If trigger element scrolled off-screen, hide tooltip
    if (rect.bottom < 0 || rect.top > winH || rect.right < 0 || rect.left > winW) {
      this.tip.hidden = true;
      return;
    }

    this.tip.hidden = false;
    // Measure at full width: where the last tooltip sat (near the right
    // edge) would squeeze this one into fewer, taller lines.
    this.tip.style.left = '0px';
    this.tip.style.top = '0px';
    let tipRect = null;
    try { tipRect = this.tip.getBoundingClientRect(); } catch { /* detached */ }
    const tipW = (tipRect && tipRect.width) || this.tip.offsetWidth || 160;
    const tipH = (tipRect && tipRect.height) || this.tip.offsetHeight || 36;

    // Prefer placing below the trigger with a 6px gap.
    // If it would overflow viewport bottom and there is room above, place above (WCAG 2.4.11).
    let y = rect.bottom + 6;
    if (y + tipH > winH - 6 && rect.top >= tipH + 6) {
      y = rect.top - tipH - 6;
    }
    const maxTop = Math.max(6, winH - tipH - 6);
    const top = Math.max(6, Math.min(y, maxTop));

    const maxLeft = Math.max(6, winW - tipW - 6);
    const left = Math.max(6, Math.min(rect.left, maxLeft));

    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
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
    if (this.onMouseOut) { document.removeEventListener('mouseout', this.onMouseOut, true); this.onMouseOut = null; }
    clearTimeout(this.focusTimer); this.focusTimer = null;
    if (this.onKeyDown) { document.removeEventListener('keydown', this.onKeyDown, true); this.onKeyDown = null; }
    if (this.onFocusIn) { document.removeEventListener('focusin', this.onFocusIn, true); this.onFocusIn = null; }
    if (this.onFocusOut) { document.removeEventListener('focusout', this.onFocusOut, true); this.onFocusOut = null; }
    if (this.onScroll && typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScroll, { passive: true, capture: true });
      window.removeEventListener('resize', this.onScroll, { passive: true });
      this.onScroll = null;
    }
    if (this.style) { this.style.remove(); this.style = null; }
    if (this.tip) { this.tip.remove(); this.tip = null; }
    this.current = null;
    this.dismissed = [];
    this.pointerAt = null;
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
