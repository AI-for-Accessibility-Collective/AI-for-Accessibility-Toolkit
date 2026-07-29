// Accessibility-tree read.
//
// The harness already consults the AX tree, but only as a hit-testing fallback
// -- a point query asking "what is at (x, y)". That answers where to click. It
// cannot answer what the page says.
//
// This module reads the whole tree, because for a validation layer the AX tree
// is the right source in a way the DOM is not:
//
//   * It is semantic. Roles and accessible names survive the CSS churn that
//     breaks selectors on large commercial sites.
//   * It is the same channel a screen-reader user gets. Anything read here is
//     by construction something that person could also have reached, so the
//     layer can never report a fact from a channel they do not have.
//
// The rendering lives in ax-render.js, which imports nothing, so it stays
// testable under node against saved captures.

import { bhCdp } from './lifecycle.js';
import { bhRenderAx } from './ax-render.js';

const AX_TIMEOUT_MS = 8000;

/**
 * Fetch the full accessibility tree for a tab.
 * @returns {Promise<Array<Object>>} raw AX nodes, or [] if unavailable.
 */
export async function bhAxTree(tabId) {
  try {
    await bhCdp(tabId, 'Accessibility.enable', {}, { timeoutMs: 2000 });
  } catch {
    // Already enabled, or the domain is unavailable on this target. Either way
    // getFullAXTree below is still worth attempting.
  }
  try {
    const r = await bhCdp(tabId, 'Accessibility.getFullAXTree', {},
                          { timeoutMs: AX_TIMEOUT_MS });
    return (r && r.nodes) || [];
  } catch {
    return [];
  }
}

/**
 * Read a tab's accessibility tree and render it. This is the call the
 * validation layer's reader consumes.
 *
 * @returns {Promise<{url: string|null, text: string, nodeCount: number}>}
 */
export async function bhAxSnapshot(tabId, opts = {}) {
  const nodes = await bhAxTree(tabId);
  let url = opts.url || null;
  if (!url) {
    try {
      const info = await bhCdp(tabId, 'Runtime.evaluate',
        { expression: 'location.href', returnByValue: true },
        { timeoutMs: 1500 });
      url = info?.result?.value || null;
    } catch { /* url is a convenience, not a requirement */ }
  }
  return { url, text: bhRenderAx(nodes, { ...opts, url }), nodeCount: nodes.length };
}

export { bhRenderAx };
