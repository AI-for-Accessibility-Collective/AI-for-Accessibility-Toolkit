// Block 8, panel: a dialog, a disclosure region, or a full-screen view.
//
//   const p = s.panel({ kind: 'dialog', label: 'Chart data', near: chart });
//   p.body.append(table); p.open(button); ... p.close();
//
// Not configurable: it has a visible Close button at least 24 pixels; Escape
// closes it; it takes focus only when its `focus` policy says so; when it
// closes, focus goes back (to `returnTo`, else whatever opened it) only if
// focus was inside it; and placed `near` an element, it never covers it.

import { resolveConfig, UI_ATTR } from './shared.js';

export const PANEL_DEFAULTS = {
  kind: 'dialog', label: 'Panel', near: null, corner: 'bottom-right', focus: 'from-trigger',
  returnTo: null, inert: false, theme: 'page', width: 360, zIndex: 2147483646, fontScale: 100,
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function panelBlock(s, env) {
  const { doc, win } = env;
  let n = 0;

  return function panel(opts = {}) {
    const c = resolveConfig(PANEL_DEFAULTS, opts, env.personal, { fontScale: 'fontScale' });
    if (!s.alive()) return null;
    const id = `ai4a11y-panel-${s.id}-${++n}`.replace(/[^\w-]/g, '-');
    const full = c.kind === 'fullscreen';
    const root = s.el('section', {
      attrs: {
        id, role: c.kind === 'disclosure' ? 'region' : 'dialog',
        'aria-labelledby': `${id}-title`, 'aria-modal': full ? 'true' : undefined,
      },
    });
    root.hidden = true;
    const head = s.el('div', { attrs: { class: 'ai4a11y-panel-head' } });
    const title = s.el('h2', { text: c.label, attrs: { id: `${id}-title`, tabindex: '-1' } });
    const close = s.el('button', { text: 'Close', attrs: { type: 'button' } });
    const body = s.el('div', { attrs: { class: 'ai4a11y-panel-body' } });
    head.append(title, close);
    root.append(head, body);

    // The page's own look, unless the builder chose a theme.
    const pageStyle = win.getComputedStyle(doc.body || doc.documentElement);
    const theme = c.theme === 'dark' ? { bg: '#1f1f1f', fg: '#ffffff', font: 'system-ui, sans-serif' }
      : c.theme === 'light' ? { bg: '#ffffff', fg: '#1f1f1f', font: 'system-ui, sans-serif' }
      : { bg: '#ffffff', fg: '#1f1f1f', font: pageStyle.fontFamily || 'system-ui, sans-serif' };
    const width = Math.max(200, Number(c.width) || 360);
    const scale = Math.max(1, (Number(c.fontScale) || 100) / 100);
    const corner = String(c.corner || 'bottom-right');
    const sides = `${corner.includes('top') ? 'top' : 'bottom'}: 16px; ${corner.includes('left') ? 'left' : 'right'}: 16px;`;
    s.css(`panel-${n}`, `#${id} { position: fixed; ${full ? 'inset: 0;' : `${sides} width: min(${width}px, calc(100vw - 32px)); max-height: calc(100vh - 32px);`}
  z-index: ${Number(c.zIndex) || 2147483646}; box-sizing: border-box; overflow: auto; padding: 12px 16px 16px;
  background: ${theme.bg}; color: ${theme.fg}; font-family: ${theme.font}; font-size: ${Math.round(16 * scale)}px; line-height: 1.5;
  border: 2px solid ${theme.fg}; border-radius: ${full ? '0' : '8px'}; box-shadow: 0 4px 16px rgba(0,0,0,.3); text-align: start; }
#${id}[hidden] { display: none !important; }
#${id} .ai4a11y-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
#${id} h2 { all: revert; margin: 0; font: 600 1.1em/1.3 inherit; color: inherit; }
#${id} button { all: revert; min-width: 44px; min-height: 32px; padding: 4px 12px; font: inherit; color: ${theme.fg}; background: transparent; border: 2px solid ${theme.fg}; border-radius: 6px; cursor: pointer; }
#${id} :focus-visible { outline: 3px solid ${theme.fg} !important; outline-offset: 2px !important; }`);
    s.append(doc.body, root);

    let opener = null;
    let inerted = [];

    function position() {
      const near = c.near && c.near.isConnected ? c.near : null;
      if (full || !near) return;
      // Beside its target, never over it: below, else above, else the corner.
      const r = near.getBoundingClientRect();
      const vh = win.innerHeight, vw = win.innerWidth;
      const w = root.offsetWidth, h = root.offsetHeight;
      const left = Math.max(16, Math.min(r.left, vw - w - 16));
      const top = r.bottom + 8 + h <= vh ? r.bottom + 8 : r.top - 8 - h >= 0 ? r.top - 8 - h : null;
      if (top === null) return;
      Object.assign(root.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    }

    function open(by) {
      if (!s.alive() || !root.hidden) return;
      opener = by || doc.activeElement;
      root.hidden = false;
      position();
      if (full && c.inert) {
        // Everything else is out of reach while it is open, except live
        // regions, so the page's announcements still reach a screen reader.
        for (const child of doc.body.children) {
          if (child === root || child.hasAttribute(UI_ATTR) || child.hasAttribute('inert') || child.matches('[aria-live], [role="status"], [role="alert"]')) continue;
          child.setAttribute('inert', '');
          inerted.push(child);
        }
      }
      if (c.focus === 'always' || (c.focus === 'from-trigger' && by)) title.focus();
    }

    function shut() {
      if (root.hidden) return;
      const hadFocus = root.contains(doc.activeElement);
      root.hidden = true;
      for (const el of inerted) el.removeAttribute('inert');
      inerted = [];
      if (hadFocus) {
        const back = [c.returnTo, opener].find((el) => el && el.isConnected && el !== doc.body);
        if (back && typeof back.focus === 'function') back.focus();
      }
    }

    s.listen(close, 'click', shut);
    s.listen(full ? doc : root, 'keydown', (e) => {
      if (e.key !== 'Escape' || root.hidden) return;
      e.stopPropagation();
      shut();
    }, full);
    s.onEnd(shut);

    return {
      el: root, body, title, closeButton: close,
      open, close: shut,
      get isOpen() { return !root.hidden; },
      focusable: () => [...root.querySelectorAll(FOCUSABLE)],
    };
  };
}
