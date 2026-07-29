// Define Words — makes long words in the page's main text interactive: hover
// or keyboard focus fetches a plain-language definition with AI and shows it
// in a tooltip. From the co-design study: Chloe wants plainer language — but
// unlike simplify-text this keeps the original wording and explains on demand,
// so the reader learns the hard word instead of losing it.
//
// Reversible by construction: each processed text node is REPLACED by a
// wrapper <span> built with DOM APIs and textContent (never innerHTML from
// page text), and the ORIGINAL text node reference is kept alongside the
// wrapper in a Set so disable() swaps the exact node back — restoring the DOM
// identically, whitespace and all.
import { defineWord, announce } from '../utils/ai.js';

// Containers whose text must never gain interactive spans: code and
// preformatted text (alignment-sensitive), form fields, and existing
// interactive elements (a span[role=button] inside a link or button would be
// a nested-control accessibility violation).
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'A', 'BUTTON']);

// Per-page bound on wrapped words: each is a focusable element and a
// potential AI call, so cap the tab-stop clutter and the worst-case cost.
const MAX_WORDS = 500;
const STYLE_ID = 'ai4a11y-define-styles';
const TOOLTIP_ID = 'ai4a11y-define-tooltip';
// Blocks whose text is a sensible sentence context for the AI prompt.
const CONTEXT_SEL = 'p, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6';
const CONTEXT_CHARS = 200;

export const DefineWords = {
  markerClass: 'ai4a11y-define',        // the per-word interactive spans
  wrapperClass: 'ai4a11y-define-wrap',  // the text-node replacement wrappers
  enabled: false,
  wrapped: null,      // Set of { span (wrapper), originalNode } (for exact restore)
  definitions: null,  // Map lowercased word -> definition (null cached too, so a dead provider isn't re-asked)
  showHandler: null,
  hideHandler: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.wrapped = new Set();
    this.definitions = new Map();

    const minLength = typeof options.minLength === 'number' && options.minLength > 0
      ? options.minLength
      : 8;

    // Prefer the page's main-content region so chrome (navs, footers, ads)
    // stays untouched; fall back to the whole body.
    let root = null;
    try {
      root = document.querySelector('main, article, [role="main"]') || document.body;
    } catch { /* root stays null; handled below */ }
    if (!root) {
      console.log('[AI4A11y] Define Words: no content root found');
      announce('Define words: no readable text found');
      return;
    }

    // Collect first, then mutate — replacing nodes mid-walk would skip text.
    const textNodes = [];
    try { this.collect(root, textNodes); } catch { /* keep whatever was collected */ }

    let count = 0;
    for (const textNode of textNodes) {
      if (count >= MAX_WORDS) break;
      try {
        const parent = textNode.parentNode;
        if (!parent) continue;
        const built = this.buildWrapper(textNode.nodeValue, minLength, MAX_WORDS - count);
        if (!built) continue;  // no qualifying word — leave the node untouched
        parent.replaceChild(built.wrap, textNode);
        this.wrapped.add({ span: built.wrap, originalNode: textNode });
        count += built.wrappedCount;
      } catch { /* leave this node untouched */ }
    }
    if (count >= MAX_WORDS) console.log(`[AI4A11y] Define Words: capped at ${MAX_WORDS} words`);

    this.injectStyles();

    // One delegated listener set for every span — added on the document so a
    // single pair of references is all disable() needs to remove.
    this.showHandler = (e) => this.handleShow(e);
    this.hideHandler = (e) => this.handleHide(e);
    document.addEventListener('mouseover', this.showHandler);
    document.addEventListener('focusin', this.showHandler);
    document.addEventListener('mouseout', this.hideHandler);
    document.addEventListener('focusout', this.hideHandler);

    console.log(`[AI4A11y] Define Words enabled (${count} words)`);
    announce(count ? 'Word definitions on: hover or focus an underlined word' : 'Define words: no long words found');
  },

  // Depth-first text-node collection under root, skipping SKIP_TAGS subtrees
  // and wrappers we already built.
  collect(el, out) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (/\S/.test(node.nodeValue)) out.push(node);
      } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName) &&
                 !(node.classList && node.classList.contains(this.wrapperClass))) {
        this.collect(node, out);
      }
    }
  },

  // Rebuild one text node as a wrapper <span>: qualifying words (alphabetic,
  // long enough, within budget) become interactive spans; everything else —
  // short words, punctuation, whitespace — is re-emitted verbatim as text.
  // Returns null when nothing qualified, so the caller leaves the node alone.
  buildWrapper(text, minLength, budget) {
    const wrap = document.createElement('span');
    wrap.className = this.wrapperClass;
    let last = 0, wrappedCount = 0;
    const re = /[A-Za-z]+/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[0].length < minLength || wrappedCount >= budget) continue;
      if (m.index > last) wrap.appendChild(document.createTextNode(text.slice(last, m.index)));
      wrap.appendChild(this.buildWordSpan(m[0]));
      last = m.index + m[0].length;
      wrappedCount++;
    }
    if (!wrappedCount) return null;
    if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
    return { wrap, wrappedCount };
  },

  buildWordSpan(word) {
    const span = document.createElement('span');
    span.className = this.markerClass;
    span.setAttribute('tabindex', '0');
    span.setAttribute('role', 'button');
    span.setAttribute('aria-label', `Define ${word}`);
    span.textContent = word;
    return span;
  },

  injectStyles() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .${this.markerClass} {
          text-decoration: underline dotted;
          text-underline-offset: 2px;
          cursor: help;
        }
        .${this.markerClass}:focus {
          outline: 2px solid #4A90D9;
          outline-offset: 1px;
        }
        #${TOOLTIP_ID} {
          position: absolute;
          z-index: 2147483647;
          max-width: 320px;
          padding: 8px 10px;
          background: #1c1c1e;
          color: #ffffff;
          font: 14px/1.4 system-ui, sans-serif;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          pointer-events: none;
        }`;
      (document.head || document.documentElement).appendChild(style);
    } catch { /* page still works without the underline styling */ }
  },

  handleShow(event) {
    try {
      const target = event.target;
      const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
      if (span) this.showDefinition(span).catch(() => {});
    } catch { /* never let a hover break the page */ }
  },

  handleHide(event) {
    try {
      const target = event.target;
      if (target && target.closest && target.closest(`.${this.markerClass}`)) this.hideTooltip();
    } catch { /* nothing to hide */ }
  },

  async showDefinition(span) {
    if (!this.enabled || !this.definitions) return;
    const word = (span.textContent || '').trim();
    if (!word) return;
    const key = word.toLowerCase();
    let def;
    if (this.definitions.has(key)) {
      def = this.definitions.get(key);
    } else {
      let def2;
      try { def2 = await defineWord(word, this.sentenceContext(span)); }
      catch { def2 = null; }  // provider failure → same as unavailable
      if (!this.enabled || !this.definitions) return;  // disabled mid-flight
      this.definitions.set(key, def2 || null);
      def = def2;
    }
    if (!def) return;  // unavailable → show nothing, never crash
    this.showTooltip(span, def);
  },

  // The surrounding sentence(s) for the AI prompt: the enclosing text block's
  // content, whitespace-collapsed and truncated to a bounded prompt size.
  sentenceContext(span) {
    try {
      const block = span.closest(CONTEXT_SEL) || span.parentNode;
      return (block?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_CHARS);
    } catch { return ''; }
  },

  showTooltip(span, text) {
    try {
      let tip = document.getElementById(TOOLTIP_ID);
      if (!tip) {
        tip = document.createElement('div');
        tip.id = TOOLTIP_ID;
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
      }
      tip.textContent = text;
      const rect = span.getBoundingClientRect();
      tip.style.left = `${Math.max(0, rect.left + (window.scrollX || 0))}px`;
      tip.style.top = `${rect.bottom + (window.scrollY || 0) + 6}px`;
      tip.style.display = 'block';
    } catch { /* tooltip is best-effort */ }
  },

  hideTooltip() {
    try {
      const tip = document.getElementById(TOOLTIP_ID);
      if (tip) tip.style.display = 'none';
    } catch { /* already gone */ }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.showHandler) {
      document.removeEventListener('mouseover', this.showHandler);
      document.removeEventListener('focusin', this.showHandler);
      this.showHandler = null;
    }
    if (this.hideHandler) {
      document.removeEventListener('mouseout', this.hideHandler);
      document.removeEventListener('focusout', this.hideHandler);
      this.hideHandler = null;
    }
    try { document.getElementById(TOOLTIP_ID)?.remove(); } catch { /* already gone */ }
    try { document.getElementById(STYLE_ID)?.remove(); } catch { /* already gone */ }
    if (this.wrapped) {
      for (const { span, originalNode } of this.wrapped) {
        try {
          span.parentNode?.replaceChild(originalNode, span);
        } catch { /* wrapper may already be gone from the page */ }
      }
      this.wrapped.clear();
      this.wrapped = null;
    }
    if (this.definitions) {
      this.definitions.clear();
      this.definitions = null;
    }
    console.log('[AI4A11y] Define Words disabled');
    announce('Word definitions off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yDefineWords = DefineWords;
