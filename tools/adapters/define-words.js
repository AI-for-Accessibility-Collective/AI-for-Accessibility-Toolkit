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
import { mainRoot } from './_primitives.js';

// Containers whose text must never gain interactive spans: code and
// preformatted text (alignment-sensitive), form fields, and existing
// interactive elements (a span[role=button] inside a link, button or label
// would be a nested control).
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'A', 'BUTTON',
  'LABEL', 'SELECT', 'OPTION', 'SUMMARY', 'NOSCRIPT', 'TEMPLATE']);
// Also never inside these: controls built from divs, text hidden from screen
// readers, and live regions (rewrapping a message makes it be read again).
const SKIP_SEL = '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], ' +
  '[role="checkbox"], [role="radio"], [role="switch"], [contenteditable], [aria-hidden="true"], [hidden], ' +
  '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';

// Per-page bound on wrapped words: each is a potential AI call, so cap the
// worst-case cost.
const MAX_WORDS = 500;
// Only the first time a word appears is it a Tab stop, and only this many of
// them: hundreds of extra Tab stops make a page unusable from the keyboard.
// Every wrapped word still works on hover.
const MAX_TAB_STOPS = 60;
// Distinct words looked up with AI per page. Hover waits a moment first, so
// only words the reader rests on cost a call.
const MAX_LOOKUPS = 40;
const HOVER_DELAY_MS = 350;
const RESCAN_MS = 400;
const STYLE_ID = 'ai4a11y-define-styles';
const TOOLTIP_ID = 'ai4a11y-define-tooltip';
const HINT_ID = 'ai4a11y-define-hint';
// Blocks whose text is a sensible sentence context for the AI prompt.
const CONTEXT_SEL = 'p, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6';
const CONTEXT_CHARS = 200;

export const DefineWords = {
  markerClass: 'ai4a11y-define',        // the per-word interactive spans
  wrapperClass: 'ai4a11y-define-wrap',  // the text-node replacement wrappers
  enabled: false,
  wrapped: null,      // Set of { span (wrapper), originalNode } (for exact restore)
  definitions: null,  // Map lowercased word -> Promise of a definition or null (null cached too, so a dead provider isn't re-asked)
  showHandler: null,
  hideHandler: null,
  keyHandler: null,
  current: null,      // the word span the reader is on right now
  hoverTimer: null,
  observer: null,
  rescanTimer: null,
  count: 0,           // words wrapped
  tabStops: 0,
  seen: null,         // lowercased words that already have a Tab stop
  said: null,         // definitions already read out to a keyboard user
  ready: null,        // Map lowercased word -> definition, for lookups that have finished

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.wrapped = new Set();
    this.definitions = new Map();
    this.ready = new Map();
    this.seen = new Set();
    this.count = 0;
    this.tabStops = 0;

    const minLength = typeof options.minLength === 'number' && options.minLength > 0
      ? options.minLength
      : 8;

    // Prefer the page's main-content region so chrome (navs, footers, ads)
    // stays untouched; fall back to the whole body. #main is the usual id of
    // a main region that is built from a plain div.
    let root = null;
    try {
      root = document.querySelector('main, article, [role="main"]') || document.getElementById('main') || mainRoot();
    } catch { /* root stays null; handled below */ }
    if (!root) {
      console.log('[AI4A11y] Define Words: no content root found');
      announce('Define words: no readable text found');
      return;
    }

    this.injectStyles();
    this.wrapUnder(root, minLength);
    if (this.count >= MAX_WORDS) console.log(`[AI4A11y] Define Words: capped at ${MAX_WORDS} words`);

    // One delegated listener set for every span — added on the document so a
    // single pair of references is all disable() needs to remove.
    this.showHandler = (e) => this.handleShow(e);
    this.hideHandler = (e) => this.handleHide(e);
    this.keyHandler = (e) => { if (e.key === 'Escape') this.hideTooltip(); };
    document.addEventListener('mouseover', this.showHandler);
    document.addEventListener('focusin', this.showHandler);
    document.addEventListener('mouseout', this.hideHandler);
    document.addEventListener('focusout', this.hideHandler);
    document.addEventListener('keydown', this.keyHandler);
    this.watch(root, minLength);

    console.log(`[AI4A11y] Define Words enabled (${this.count} words)`);
    announce(this.count ? 'Word definitions on: hover or focus an underlined word' : 'Define words: no long words found');
  },

  // Collect first, then mutate — replacing nodes mid-walk would skip text.
  wrapUnder(root, minLength) {
    const textNodes = [];
    try { this.collect(root, textNodes); } catch { /* keep whatever was collected */ }
    let added = 0;
    for (const textNode of textNodes) {
      if (this.count >= MAX_WORDS) break;
      try {
        const parent = textNode.parentNode;
        if (!parent) continue;
        const built = this.buildWrapper(textNode.nodeValue, minLength, MAX_WORDS - this.count);
        if (!built) continue;  // no qualifying word — leave the node untouched
        parent.replaceChild(built.wrap, textNode);
        this.wrapped.add({ span: built.wrap, originalNode: textNode });
        this.count += built.wrappedCount;
        added += built.wrappedCount;
      } catch { /* leave this node untouched */ }
    }
    return added;
  },

  // Depth-first text-node collection under root, skipping SKIP_TAGS subtrees,
  // SKIP_SEL subtrees, wrappers we already built, and text nobody can see
  // (a focusable word inside visually hidden text would be an invisible Tab stop).
  collect(el, out) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (/\S/.test(node.nodeValue) && this.isVisible(el)) out.push(node);
      } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName) &&
                 !(node.classList && node.classList.contains(this.wrapperClass)) &&
                 !(node.matches && node.matches(SKIP_SEL))) {
        this.collect(node, out);
      }
    }
  },

  // Rendered and bigger than a visually-hidden 1px box. Where there is no
  // layout (jsdom, a detached tree) everything counts as visible.
  isVisible(el) {
    if (typeof el.getClientRects !== 'function') return true;
    if (!el.getClientRects().length) return !document.documentElement.getClientRects().length; // display:none, unless there is no layout at all
    const r = el.getBoundingClientRect();
    return !(r.width <= 1 && r.height <= 1 && (r.width || r.height)); // a 1px visually-hidden box
  },

  // Pages add text after load (search results, a cart sheet). Wrap that too,
  // a moment after it lands. Our own wrappers are ignored, so this never
  // reacts to itself.
  watch(root, minLength) {
    if (typeof MutationObserver === 'undefined') return;
    const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.wrapperClass);
    this.observer = new MutationObserver((records) => {
      const fresh = records.some((r) => [...r.addedNodes].some((n) =>
        !ours(n) && n.id !== TOOLTIP_ID && (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.nodeValue)))));
      if (!fresh || this.rescanTimer || this.count >= MAX_WORDS) return;
      this.rescanTimer = setTimeout(() => {
        this.rescanTimer = null;
        if (this.enabled) this.wrapUnder(root, minLength);
      }, RESCAN_MS);
    });
    this.observer.observe(root, { childList: true, subtree: true });
  },

  // Rebuild one text node as a wrapper <span>: qualifying words (alphabetic,
  // long enough, within budget) become interactive spans; everything else —
  // short words, punctuation, whitespace — is re-emitted verbatim as text.
  // Returns null when nothing qualified, so the caller leaves the node alone.
  buildWrapper(text, minLength, budget) {
    const wrap = document.createElement('span');
    wrap.className = this.wrapperClass;
    // Pages style their own spans (".thumb span { position: absolute }"):
    // ours start from a clean slate.
    wrap.style.cssText = 'all: unset;';
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
    span.style.cssText = 'all: unset; text-decoration: underline dotted; text-underline-offset: 2px; cursor: help;';
    span.textContent = word;
    const key = word.toLowerCase();
    if (!this.seen || this.seen.has(key) || this.tabStops >= MAX_TAB_STOPS) return span;
    this.seen.add(key);
    this.tabStops++;
    span.setAttribute('tabindex', '0');
    span.setAttribute('role', 'button');
    // The word itself is the name, so a screen reader reading the sentence
    // still says the sentence ("an extraordinary button tale", not "an
    // Define extraordinary button tale"). What it does is the description,
    // which is read when the word gets focus.
    span.setAttribute('aria-describedby', HINT_ID);
    return span;
  },

  injectStyles() {
    try {
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // The focus ring is a box-shadow: pages that switch the focus outline
        // off with !important cannot hide it.
        style.textContent = `
          .${this.markerClass}:focus {
            outline: 2px solid #1a5fb4 !important;
            outline-offset: 1px !important;
            box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1a5fb4 !important;
            border-radius: 2px !important;
          }
          #${TOOLTIP_ID} {
            position: absolute;
            z-index: 2147483647;
            box-sizing: border-box;
            max-width: min(320px, calc(100vw - 16px));
            padding: 8px 10px;
            background: #1c1c1e;
            color: #ffffff;
            font: 14px/1.4 system-ui, sans-serif;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
            pointer-events: none;
          }`;
        (document.head || document.documentElement).appendChild(style);
      }
      if (!document.getElementById(HINT_ID)) {
        const hint = document.createElement('span');
        hint.id = HINT_ID;
        hint.hidden = true;
        hint.style.cssText = 'display: none !important;';
        hint.textContent = 'Shows a short definition';
        (document.body || document.documentElement).appendChild(hint);
      }
    } catch { /* page still works without the underline styling */ }
  },

  handleShow(event) {
    try {
      const target = event.target;
      const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
      if (!span) return;
      clearTimeout(this.hoverTimer);
      this.current = span;
      const byKeyboard = event.type === 'focusin';
      // A word already looked up shows at once. Otherwise wait a moment, so
      // sweeping the pointer across a paragraph, or tabbing past words, does
      // not send every word to the AI.
      if (this.ready && this.ready.has((span.textContent || '').trim().toLowerCase())) {
        this.showDefinition(span, byKeyboard).catch(() => {});
        return;
      }
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        if (this.current === span) this.showDefinition(span, byKeyboard).catch(() => {});
      }, HOVER_DELAY_MS);
    } catch { /* never let a hover break the page */ }
  },

  handleHide(event) {
    try {
      const target = event.target;
      const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
      if (!span) return;
      // Moving between the parts of one word is not leaving it.
      if (event.type === 'mouseout' && event.relatedTarget && span.contains(event.relatedTarget)) return;
      if (this.current === span) this.current = null;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
      this.hideTooltip();
    } catch { /* nothing to hide */ }
  },

  // One lookup per word, shared by every hover and focus that asks while it
  // is on its way. Returns null once the lookup budget is spent.
  lookup(word, span) {
    const key = word.toLowerCase();
    if (this.definitions.has(key)) return this.definitions.get(key);
    if (this.definitions.size >= MAX_LOOKUPS) return null;
    const p = (async () => {
      let def = null;
      try { def = (await defineWord(word, this.sentenceContext(span))) || null; }
      catch (e) {  // provider failure: same as unavailable, and say why
        console.warn('[AI4A11y] Define Words: no definition shown, provider error:', e);
      }
      this.ready?.set(key, def);
      return def;
    })();
    this.definitions.set(key, p);
    return p;
  },

  async showDefinition(span, byKeyboard) {
    if (!this.enabled || !this.definitions) return;
    const word = (span.textContent || '').trim();
    if (!word) return;
    const key = word.toLowerCase();
    const p = this.lookup(word, span);
    if (!p) return;
    const def = await p;
    if (!this.enabled || !this.definitions) return;  // disabled mid-flight
    if (!def) return;  // unavailable → show nothing, never crash
    // The reader has moved on: a late answer must not pop up somewhere else.
    if (this.current !== span) return;
    this.showTooltip(span, def);
    // A keyboard user waited for this one: say it, since the focus
    // announcement has already been read without it.
    if (byKeyboard && !this.said?.has(key)) {
      this.said = this.said || new Set();
      this.said.add(key);
      announce(`${word}: ${def}`);
    }
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
      tip.style.display = 'block';
      const rect = span.getBoundingClientRect();
      // Keep the tooltip on screen: near the right edge it would otherwise
      // push the page sideways on a phone.
      const viewW = document.documentElement.clientWidth || window.innerWidth || 0;
      const tipW = tip.offsetWidth || 0;
      const left = viewW && tipW ? Math.min(rect.left, viewW - tipW - 8) : rect.left;
      tip.style.left = `${Math.max(8, left) + (window.scrollX || 0)}px`;
      tip.style.top = `${rect.bottom + (window.scrollY || 0) + 6}px`;
      if (span.hasAttribute('tabindex')) span.setAttribute('aria-describedby', TOOLTIP_ID);
    } catch { /* tooltip is best-effort */ }
  },

  hideTooltip() {
    try {
      const tip = document.getElementById(TOOLTIP_ID);
      if (tip) tip.style.display = 'none';
      for (const s of document.querySelectorAll(`[aria-describedby="${TOOLTIP_ID}"]`)) s.setAttribute('aria-describedby', HINT_ID);
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
    if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    clearTimeout(this.rescanTimer); this.rescanTimer = null;
    clearTimeout(this.hoverTimer); this.hoverTimer = null;
    this.current = null;
    try { document.getElementById(TOOLTIP_ID)?.remove(); } catch { /* already gone */ }
    try { document.getElementById(STYLE_ID)?.remove(); } catch { /* already gone */ }
    try { document.getElementById(HINT_ID)?.remove(); } catch { /* already gone */ }
    if (this.wrapped) {
      // A word that has focus is about to be swapped out. Keep the keyboard
      // where it was: focus the paragraph it was in (for as long as it has
      // focus) instead of dropping the reader back at the top of the page.
      const active = document.activeElement;
      const onWord = active && active.classList && active.classList.contains(this.markerClass);
      let block = null;
      for (const { span, originalNode } of this.wrapped) {
        try {
          if (onWord && span.contains(active)) block = span.parentElement;
          span.parentNode?.replaceChild(originalNode, span);
        } catch { /* wrapper may already be gone from the page */ }
      }
      if (block && block.isConnected && !block.hasAttribute('tabindex')) {
        block.setAttribute('tabindex', '-1');
        block.addEventListener('blur', () => block.removeAttribute('tabindex'), { once: true });
        try { block.focus({ preventScroll: true }); } catch { /* not focusable */ }
      }
      this.wrapped.clear();
      this.wrapped = null;
    }
    if (this.definitions) {
      this.definitions.clear();
      this.definitions = null;
    }
    this.seen = null;
    this.said = null;
    this.ready = null;
    console.log('[AI4A11y] Define Words disabled');
    announce('Word definitions off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yDefineWords = DefineWords;
