// Bionic Reading — bolds the first ~40% of each word in the page's main text,
// giving the eye a fixation point per word. A well-known reading aid for
// dyslexia and ADHD: the bolded prefix anchors each saccade so the reader's
// brain completes the word instead of decoding every letter.
//
// Reversible by construction: each processed text node is REPLACED by a
// wrapper <span> built with DOM APIs and textContent (never innerHTML from
// page text), and the ORIGINAL text node reference is kept alongside the span
// in a Set so disable() swaps the exact node back — restoring the DOM
// identically, whitespace and all.
import { announce } from '../../utils/ai.js';

// Containers whose text must never be reflowed: code and preformatted text
// (bolding changes glyph widths and meaning-by-alignment), and form fields.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT']);

// Cap the work on pathological pages (infinite feeds, giant tables).
const MAX_TEXT_NODES = 2000;

export const BionicReading = {
  markerClass: 'ai4a11y-bionic',
  enabled: false,
  processed: null,  // Set of { span, originalNode } (for exact restore)

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.processed = new Set();

    const ratio = typeof options.boldRatio === 'number' && options.boldRatio > 0 && options.boldRatio <= 1
      ? options.boldRatio
      : 0.4;

    // Prefer the page's main-content region so chrome (navs, footers, ads)
    // keeps its normal weight; fall back to the whole body.
    let root = null;
    try {
      root = document.querySelector('main, article, [role="main"], .content, #content') || document.body;
    } catch { /* root stays null; handled below */ }
    if (!root) {
      console.log('[AI4A11y] Bionic Reading: no content root found');
      announce('Bionic reading: no readable text found');
      return;
    }

    // Collect first, then mutate — replacing nodes mid-walk would skip text.
    const textNodes = [];
    let capped = false;
    try {
      capped = !this.collect(root, textNodes);
    } catch { /* keep whatever was collected */ }
    if (capped) console.log(`[AI4A11y] Bionic Reading: capped at ${MAX_TEXT_NODES} text nodes`);

    let count = 0;
    for (const textNode of textNodes) {
      try {
        const parent = textNode.parentNode;
        if (!parent) continue;
        const span = this.buildSpan(textNode.nodeValue, ratio);
        parent.replaceChild(span, textNode);
        this.processed.add({ span, originalNode: textNode });
        count++;
      } catch { /* leave this node untouched */ }
    }

    console.log(`[AI4A11y] Bionic Reading enabled (${count} text blocks)`);
    announce(count ? 'Bionic reading on' : 'Bionic reading: no readable text found');
  },

  // Depth-first text-node collection under root, skipping SKIP_TAGS subtrees
  // and spans we already built. Returns false once the cap refuses a node.
  collect(el, out) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (!/\S/.test(node.nodeValue)) continue;
        if (out.length >= MAX_TEXT_NODES) return false;
        out.push(node);
      } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName) &&
                 !(node.classList && node.classList.contains(this.markerClass))) {
        if (!this.collect(node, out)) return false;
      }
    }
    return true;
  },

  // Rebuild one text node's content as a marker <span>, bolding each word's
  // prefix. Whitespace runs are preserved verbatim as their own text nodes.
  buildSpan(text, ratio) {
    const span = document.createElement('span');
    span.className = this.markerClass;
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/\s/.test(part)) span.appendChild(document.createTextNode(part));
      else this.boldWord(span, part, ratio);
    }
    return span;
  },

  // One word: <b>prefix</b> + plain text node for the rest.
  boldWord(span, word, ratio) {
    const prefixLen = Math.min(word.length, Math.ceil(word.length * ratio));
    const b = document.createElement('b');
    b.textContent = word.slice(0, prefixLen);
    span.appendChild(b);
    if (prefixLen < word.length) span.appendChild(document.createTextNode(word.slice(prefixLen)));
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.processed) {
      for (const { span, originalNode } of this.processed) {
        try {
          span.parentNode?.replaceChild(originalNode, span);
        } catch { /* span may already be gone from the page */ }
      }
      this.processed.clear();
      this.processed = null;
    }
    console.log('[AI4A11y] Bionic Reading disabled');
    announce('Bionic reading off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yBionicReading = BionicReading;
