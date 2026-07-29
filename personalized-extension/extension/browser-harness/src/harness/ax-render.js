// Rendering an accessibility tree as text. Pure — no chrome.*, no CDP, no
// imports — so it runs under node and can be tested against saved captures.
//
// The output shape matches the indented form Playwright's ariaSnapshot
// produces, which is what existing page captures are stored in. Keeping the
// two identical means a parser can be written and tested offline against saved
// files, then run unchanged against a live tab.

// Roles that carry no information of their own and only add depth. Dropping
// them keeps a snapshot readable without losing anything underneath: a skipped
// node still passes its children through, so nothing is orphaned.
export const SKIP_ROLES = new Set([
  'none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak',
]);

const val = (p) => (p && p.value !== undefined ? p.value : undefined);

/** Read one AX property off a node, e.g. 'level' on a heading. */
export function axProp(node, name) {
  const hit = (node.properties || []).find((p) => p.name === name);
  return hit ? val(hit.value) : undefined;
}

/**
 * Render AX nodes as indented text:
 *
 *   - heading "Delivering to Jane Smith" [level=2]
 *   - listitem "Order total: $31.40"
 *
 * @param {Array<Object>} nodes  raw nodes from Accessibility.getFullAXTree
 * @param {{url?: string, maxDepth?: number}} [opts]
 * @returns {string}
 */
export function bhRenderAx(nodes, opts = {}) {
  const { url = null, maxDepth = 40 } = opts;
  if (!nodes || !nodes.length) return url ? `URL: ${url}\n` : '';

  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) || nodes[0];
  const out = [];
  if (url) out.push(`URL: ${url}`, '');

  const walk = (node, depth) => {
    if (!node || depth > maxDepth) return;
    const role = val(node.role);
    const name = val(node.name);
    const skip = node.ignored === true || !role || SKIP_ROLES.has(role);

    if (!skip) {
      const level = axProp(node, 'level');
      const suffix = level !== undefined ? ` [level=${level}]` : '';
      const text = name ? ` "${name}"` : '';
      out.push(`${'  '.repeat(depth)}- ${role}${text}${suffix}`);
    }
    for (const id of node.childIds || []) {
      walk(byId.get(id), skip ? depth : depth + 1);
    }
  };
  walk(root, 0);
  return out.join('\n') + '\n';
}
