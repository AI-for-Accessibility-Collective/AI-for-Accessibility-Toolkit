// Bionic Reading — bolds the first ~40% of each word in the page's main text,
// giving the eye a fixation point per word. A well-known reading aid for
// dyslexia and ADHD: the bolded prefix anchors each saccade so the reader's
// brain completes the word instead of decoding every letter.
//
// Reversible by construction via the shared transformTextNodes primitive: each
// text node is replaced by a wrapper span built with DOM APIs (never innerHTML)
// and the exact original node is restored on disable.
import { announce } from '../utils/ai.js';
import { transformTextNodes, mainRoot } from './_primitives.js';

const MAX_TEXT_NODES = 2000; // cap work on pathological pages
// Text a screen reader announces as it changes. Rewrapping it would make the
// screen reader read the message again, so it is left alone.
const LIVE_SEL = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
// Visually hidden, but read by screen readers. Not selectable, so copying the
// bolded text does not copy every word twice.
// Pages style their own spans too (".thumb span { position: absolute }"), so
// every span we add starts from a clean slate.
const RESET = 'all: unset;';
const SR_ONLY = RESET + 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none;-webkit-user-select:none;';
const RESCAN_MS = 400;

export const BionicReading = {
  markerClass: 'ai4a11y-bionic',
  enabled: false,
  handle: null,    // transformTextNodes handle for the first pass (owns the exact-restore)
  handles: null,   // later passes, for content the page adds after enable()
  observer: null,
  rescanTimer: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const ratio = (typeof options.boldRatio === 'number' && options.boldRatio > 0 && options.boldRatio <= 1)
      ? options.boldRatio : 0.4;

    const root = mainRoot();
    if (!root) { announce('Bionic reading: no readable text found'); return; }

    this.handles = [];
    this.handle = this.pass(root, ratio, MAX_TEXT_NODES);
    const count = this.handle.records.length;
    if (this.handle.capped) console.log(`[AI4A11y] Bionic Reading: capped at ${MAX_TEXT_NODES} text nodes`);
    console.log(`[AI4A11y] Bionic Reading enabled (${count} text blocks)`);
    announce(count ? 'Bionic reading on' : 'Bionic reading: no readable text found');
    this.watch(root, ratio);
  },

  // One walk over root. Skips our own wrappers (the primitive skips code/pre/etc.
  // by default) and live regions.
  pass(root, ratio, cap) {
    return transformTextNodes(root, (text, node) => {
      const parent = node.parentElement;
      if (parent && parent.closest && parent.closest(LIVE_SEL)) return null;
      return this.buildSpan(text, ratio);
    }, { skipClass: this.markerClass, cap });
  },

  // Pages add text after load (search results, a cart sheet, a countdown that
  // rewrites itself). Wrap that too, a moment after it lands. Our own
  // wrappers are ignored, so this never reacts to itself.
  watch(root, ratio) {
    if (typeof MutationObserver === 'undefined') return;
    const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.markerClass);
    this.observer = new MutationObserver((records) => {
      const fresh = records.some((r) => [...r.addedNodes].some((n) =>
        !ours(n) && !(n.parentElement && n.parentElement.closest && n.parentElement.closest(`.${this.markerClass}`)) &&
        (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.nodeValue)))));
      if (!fresh || this.rescanTimer) return;
      this.rescanTimer = setTimeout(() => {
        this.rescanTimer = null;
        if (!this.enabled) return;
        const used = this.handles.reduce((n, h) => n + h.records.length, this.handle.records.length);
        if (used >= MAX_TEXT_NODES) return;
        const h = this.pass(root, ratio, MAX_TEXT_NODES - used);
        if (h.records.length) this.handles.push(h);
      }, RESCAN_MS);
    });
    this.observer.observe(root, { childList: true, subtree: true });
  },

  // Rebuild one text node's content as a marker <span>, bolding each word's
  // prefix. Whitespace runs are preserved verbatim.
  //
  // A bold prefix splits each word into two text pieces, and screen readers
  // that move by element (VoiceOver on iOS and macOS, TalkBack) then read
  // "Fa ll De als". So the bolded copy is hidden from them and the original
  // text sits beside it, visually hidden, for them to read whole.
  buildSpan(text, ratio) {
    const span = document.createElement('span');
    span.className = this.markerClass;
    span.style.cssText = RESET;
    const shown = document.createElement('span');
    shown.style.cssText = RESET;
    shown.setAttribute('aria-hidden', 'true');
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/\s/.test(part)) shown.appendChild(document.createTextNode(part));
      else this.boldWord(shown, part, ratio);
    }
    const spoken = document.createElement('span');
    spoken.style.cssText = SR_ONLY;
    spoken.textContent = text;
    span.appendChild(shown);
    span.appendChild(spoken);
    return span;
  },

  // One word: <b>prefix</b> + plain text node for the rest.
  boldWord(span, word, ratio) {
    const prefixLen = Math.min(word.length, Math.ceil(word.length * ratio));
    const b = document.createElement('b');
    // Pages style their own <b> (a margin, a color, a label look). Reset all of that so
    // the word stays one word and only its start turns bold.
    b.style.cssText = 'all: unset; font-weight: 700;';
    b.textContent = word.slice(0, prefixLen);
    span.appendChild(b);
    if (prefixLen < word.length) span.appendChild(document.createTextNode(word.slice(prefixLen)));
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null; }
    // Later passes first: a later pass can only have wrapped text the first one did not.
    for (const h of (this.handles || []).reverse()) h.restore();
    this.handles = null;
    if (this.handle) { this.handle.restore(); this.handle = null; }
    console.log('[AI4A11y] Bionic Reading disabled');
    announce('Bionic reading off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yBionicReading = BionicReading;
