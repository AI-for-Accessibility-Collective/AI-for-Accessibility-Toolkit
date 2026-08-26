// mount/index.js — the developer-configured delivery modes. All three are thin
// wrappers over renderControllerUI (web/ui.js); they differ ONLY in where the
// widget's root is placed. This is what "all three as options" means in
// createController({ mount: { mode } }) — one core, three attach points.
//
//   page      — a standalone controller page: fills a container (default body).
//   element   — a floating widget / drop-in fixed to a corner of the viewport.
//   companion — placed beside a companion app element (a two-pane layout).

import { renderControllerUI, CONTROLLER_CSS } from '../web/ui.js';

let cssInjected = false;
function injectCss(doc) {
  if (cssInjected) return;
  const style = doc.createElement('style');
  style.setAttribute('data-aa-controller', '');
  style.textContent = CONTROLLER_CSS;
  doc.head.appendChild(style);
  cssInjected = true;
}

/**
 * Mount the Controller UI.
 * @param {ReturnType<import('../createController.js').createController>} controller
 * @param {Object} opts
 * @param {'page'|'element'|'companion'} [opts.mode='element']
 * @param {HTMLElement} [opts.target]   page: container to fill (default body).
 *                                      companion: the app element to sit beside.
 * @param {'bottom-right'|'bottom-left'|'top-right'|'top-left'} [opts.corner='bottom-right']  element mode.
 * @param {Document} [opts.doc=document]
 * @returns {{ ui: {root:HTMLElement, focus:Function, destroy:Function}, unmount: () => void }}
 */
export function mountController(controller, { mode = 'element', target, corner = 'bottom-right', doc = document } = {}) {
  injectCss(doc);
  const ui = renderControllerUI(controller, { doc });

  let holder;
  if (mode === 'page') {
    holder = target || doc.body;
    holder.appendChild(ui.root);
  } else if (mode === 'companion') {
    if (!target) throw new Error('mountController(companion): a target app element is required');
    const wrap = doc.createElement('div');
    wrap.style.cssText = 'display:flex; gap:1rem; align-items:flex-start;';
    target.parentNode.insertBefore(wrap, target);
    const pane = doc.createElement('div'); pane.style.cssText = 'flex:0 0 22rem; position:sticky; top:1rem;';
    wrap.append(target, pane);       // app on the left, controller pane on the right
    pane.appendChild(ui.root);
    holder = pane;
  } else { // 'element' — floating widget
    const [v, h] = corner.split('-');
    ui.root.style.cssText = `position:fixed; ${v}:1rem; ${h}:1rem; z-index:2147483000; width:min(92vw,26rem);`;
    doc.body.appendChild(ui.root);
    holder = doc.body;
  }

  ui.focus();
  return {
    ui,
    unmount() { ui.destroy(); if (mode === 'companion' && holder && holder.parentNode) { /* leave the app element in place */ } },
  };
}

export default mountController;
