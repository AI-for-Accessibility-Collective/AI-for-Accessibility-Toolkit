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

export const BionicReading = {
  markerClass: 'ai4a11y-bionic',
  enabled: false,
  handle: null, // transformTextNodes handle (owns the exact-restore)

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const ratio = (typeof options.boldRatio === 'number' && options.boldRatio > 0 && options.boldRatio <= 1)
      ? options.boldRatio : 0.4;

    const root = mainRoot();
    if (!root) { announce('Bionic reading: no readable text found'); return; }

    // Skip our own wrappers on re-scan; the primitive skips code/pre/etc. by default.
    this.handle = transformTextNodes(root, (text) => this.buildSpan(text, ratio), {
      skipClass: this.markerClass,
      cap: MAX_TEXT_NODES,
    });
    const count = this.handle.records.length;
    if (this.handle.capped) console.log(`[AI4A11y] Bionic Reading: capped at ${MAX_TEXT_NODES} text nodes`);
    console.log(`[AI4A11y] Bionic Reading enabled (${count} text blocks)`);
    announce(count ? 'Bionic reading on' : 'Bionic reading: no readable text found');
  },

  // Rebuild one text node's content as a marker <span>, bolding each word's
  // prefix. Whitespace runs are preserved verbatim.
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
