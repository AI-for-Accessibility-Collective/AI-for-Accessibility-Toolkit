// Shared adapter primitives — the small, orthogonal building blocks that
// adapters (and, through them, skills) compose. Extracting these kills the
// duplication that had grown across the adapter family (three separate
// text-node walkers, ~ten hand-rolled MutationObservers, five ad-hoc
// stylesheet injectors) and gives skills a real behavioral alphabet.
//
// Every primitive is REVERSIBLE by construction: it returns a handle whose
// dispose()/restore() undoes exactly what it did, so adapters stay leak-free.
// Pure DOM, no imports — safe to load in any context (guards for absent DOM).

// ── injectStyle(id, css) ────────────────────────────────────────────────────
// Inject one <style> with a stable id (idempotent — re-injecting replaces).
// Returns { remove() }.
export function injectStyle(id, css, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return { remove() {} };
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    (doc.head || doc.documentElement).appendChild(el);
  }
  el.textContent = css;
  return { el, remove() { try { doc.getElementById(id)?.remove(); } catch { /* detached */ } } };
}

// ── observeAdded(target, onElement, opts) ───────────────────────────────────
// Run onElement(node) for every element node added under `target` after now
// (and, with opts.self, for the added node itself). Returns { disconnect() }.
// A no-op stub when MutationObserver is unavailable.
export function observeAdded(target, onElement, opts = {}) {
  if (typeof MutationObserver === 'undefined' || !target) return { disconnect() {} };
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) onElement(node);
      }
    }
  });
  obs.observe(target, { childList: true, subtree: opts.subtree !== false });
  return { disconnect() { try { obs.disconnect(); } catch { /* already gone */ } } };
}

// ── transformTextNodes(root, transform, opts) ───────────────────────────────
// Walk the visible text nodes under `root`, replacing each with whatever
// `transform(text, node)` returns (a Node — typically a wrapper span built with
// DOM APIs, never innerHTML). Returns null from transform to skip a node.
// Returns a handle whose restore() puts every ORIGINAL text node back exactly
// (so links/listeners/structure survive) — the reversible engine that
// bionic-reading, define-words, and translate all needed.
//
// opts.skipTags   — uppercase tag names whose subtrees are skipped
//                   (default SCRIPT/STYLE/CODE/PRE/TEXTAREA/INPUT/NOSCRIPT).
// opts.skipClass  — a class marking already-processed wrappers to skip.
// opts.cap        — max text nodes to process (default 5000); returns capped.
const DEFAULT_SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'SELECT', 'OPTION']);

export function transformTextNodes(root, transform, opts = {}) {
  const doc = root && root.ownerDocument ? root.ownerDocument : (typeof document !== 'undefined' ? document : null);
  const records = []; // { replacement, original }
  if (!root || !doc) return { records, capped: false, restore() {} };

  const skipTags = opts.skipTags || DEFAULT_SKIP;
  const skipClass = opts.skipClass || null;
  const cap = opts.cap ?? 5000;

  // Collect first, mutate after — never walk a tree you are editing.
  const texts = [];
  const walk = (node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        if (child.nodeValue && child.nodeValue.trim()) texts.push(child);
      } else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (skipTags.has(tag)) continue;
        if (skipClass && child.classList && child.classList.contains(skipClass)) continue;
        walk(child);
      }
    }
  };
  try { walk(root); } catch { /* detached mid-walk */ }

  let capped = false;
  for (const textNode of texts) {
    if (records.length >= cap) { capped = true; break; }
    let replacement;
    try { replacement = transform(textNode.nodeValue, textNode); }
    catch { replacement = null; }
    if (!replacement) continue;
    try {
      textNode.parentNode.replaceChild(replacement, textNode);
      records.push({ replacement, original: textNode });
    } catch { /* parent gone */ }
  }

  return {
    records,
    capped,
    restore() {
      for (const { replacement, original } of records) {
        try { if (replacement.parentNode) replacement.parentNode.replaceChild(original, replacement); }
        catch { /* node gone; nothing to restore */ }
      }
      records.length = 0;
    },
  };
}

// ── mainRoot() ──────────────────────────────────────────────────────────────
// The page's primary content region (the common target for text/reading
// adapters), falling back to <body>.
export function mainRoot(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return null;
  return doc.querySelector('main, article, [role="main"], .content, #content') || doc.body || null;
}
