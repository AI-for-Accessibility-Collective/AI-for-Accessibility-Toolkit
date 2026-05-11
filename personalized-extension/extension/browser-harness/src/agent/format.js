// Format the enumerate() items + structurals into a browser_use-style
// indented textual tree. Mirrors browser_use/dom/serializer/serializer.py
// shape: depth via tab indent, attrs inline in the tag, direct text as a
// child line, prefix markers for shadow / scrollable / new. Structural
// containers (<form>, <ul>, <table>, etc.) appear as un-indexed grouping
// lines so the LLM can disambiguate "which form / list / table".
//
//   <form />
//       [0]<input type=email placeholder="Email" />
//       *[1]<input type=password placeholder="Password" />
//       [2]<button role=button />
//           Sign in
//   |SCROLL|[3]<div role=listbox />
//       [4]<a />
//           Recently visited
//
// Returns {text, hashes}. text is empty when items is empty.

export function _bhAgentFormatInteractiveList(items, structurals, prevHashes) {
  if (!items || !items.length) return { text: '', hashes: new Set() };
  const hashes = new Set();

  // Unify both lists keyed by id ("i<idx>" or "s<sid>"). parent_id is
  // null for top-level. Children-of map preserves the input order, which
  // pass 4 in enumerate already sorted into DOM order.
  const childrenOf = new Map();
  childrenOf.set(null, []);
  const pushChild = (pid, node) => {
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(node);
  };
  for (const it of items) pushChild(it.parent_id, it);
  for (const s of (structurals || [])) pushChild(s.parent_id, s);

  // Format an attrs object as `key=val` (quoted if value has whitespace
  // or special chars). browser_use's html_serializer always quotes; we
  // skip quotes for simple identifier-like values to keep lines compact.
  const formatAttrs = (attrs) => {
    if (!attrs) return '';
    const parts = [];
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === '') continue;
      const s = String(v);
      const needsQuotes = /[\s"<>&]/.test(s);
      parts.push(needsQuotes ? `${k}="${s.replace(/"/g, '&quot;')}"` : `${k}=${s}`);
    }
    return parts.join(' ');
  };

  const lines = [];
  const renderNode = (node, depth) => {
    const indent = '\t'.repeat(depth);
    if (node.kind === 'structural') {
      // No index, no attrs/text -- pure grouping cue. Pass-through to
      // children at depth+1.
      lines.push(`${indent}<${node.tag} />`);
    } else {
      // Indexed leaf
      const bx = Math.round((node.bbox && node.bbox.x) / 10) || 0;
      const by = Math.round((node.bbox && node.bbox.y) / 10) || 0;
      const role = (node.attrs && node.attrs.role) || '';
      const text = node.text || '';
      const hash = `${node.tag}|${role}|${text}|${bx},${by}`;
      hashes.add(hash);
      const isNew = prevHashes && prevHashes.size && !prevHashes.has(hash);
      let prefix = '';
      if (node.scrollable) prefix += '|SCROLL|';
      if (node.shadowMode) prefix += `|SHADOW(${node.shadowMode})|`;
      prefix += isNew ? '*' : '';
      const attrsStr = formatAttrs(node.attrs);
      const tag = `<${node.tag}${attrsStr ? ' ' + attrsStr : ''} />`;
      lines.push(`${indent}${prefix}[${node.idx}]${tag}`);
      if (text) lines.push(`${'\t'.repeat(depth + 1)}${text}`);
    }
    const kids = childrenOf.get(node.id);
    if (kids) {
      for (const k of kids) renderNode(k, depth + 1);
    }
  };

  for (const top of (childrenOf.get(null) || [])) renderNode(top, 0);

  return {
    text: 'Interactive elements (use click_index with these indexes):\n' + lines.join('\n'),
    hashes,
  };
}
