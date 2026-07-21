// Translate Page — translates the page's readable text into a target language
// with AI. From the co-design study: P3 translates sites to Spanish because
// "English is my second language." Reversible: each translated block keeps its
// EXACT original child nodes (links, emphasis, and their listeners), which are
// re-attached on disable — the translated view is flat text, but restore is
// lossless.
import { translateText, announce } from '../../utils/ai.js';

// Leaf text blocks worth translating (a block containing another block is
// skipped so we never translate the same text twice).
const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, caption, dd, dt, th, td, summary';
const SKIP_ANCESTOR = 'script, style, code, pre, textarea, [contenteditable="true"]';
const MAX_BLOCKS = 80;   // per-page AI cost bound
const BATCH = 4;         // concurrency bound

export const TranslatePage = {
  enabled: false,
  translated: null,   // Set of { el, originalNodes: Node[] }
  targetLang: 'English',

  async enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.translated = new Set();
    this.targetLang = options.targetLang || options.lang || 'English';

    const root = document.querySelector('main, article, [role="main"]') || document.body;
    if (!root) { announce('Nothing to translate'); return; }

    let blocks;
    try {
      blocks = [...root.querySelectorAll(BLOCK_SEL)].filter((el) =>
        el.textContent.trim().length > 1 &&
        !el.closest(SKIP_ANCESTOR) &&
        !el.querySelector(BLOCK_SEL));   // leaf blocks only
    } catch { blocks = []; }

    const targets = blocks.slice(0, MAX_BLOCKS);
    if (blocks.length > targets.length) {
      console.log(`[AI4A11y] Translate: translating ${targets.length} of ${blocks.length} blocks (cost cap)`);
    }

    announce(`Translating to ${this.targetLang}…`);
    let done = 0;
    for (let i = 0; i < targets.length && this.enabled; i += BATCH) {
      await Promise.all(targets.slice(i, i + BATCH).map(async (el) => {
        const original = el.textContent;
        let out;
        try { out = await translateText(original, this.targetLang); }
        catch { return; } // provider failure → leave this block untouched
        if (!out || !this.enabled || !el.isConnected) return;
        // Keep the EXACT original child nodes (detached but referenced) so
        // disable() can re-attach them — links/listeners survive the round-trip.
        const originalNodes = [...el.childNodes];
        el.textContent = out;
        this.translated.add({ el, originalNodes });
        done++;
      }));
    }
    console.log(`[AI4A11y] Translate Page: ${done} blocks → ${this.targetLang}`);
    announce(done ? `Translated ${done} passages to ${this.targetLang}` : 'Translation unavailable');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.translated) {
      for (const { el, originalNodes } of this.translated) {
        try {
          if (!el.isConnected) continue;
          el.textContent = '';
          for (const node of originalNodes) el.appendChild(node);
        } catch { /* node gone; nothing to restore */ }
      }
      this.translated.clear();
      this.translated = null;
    }
    announce('Original text restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yTranslatePage = TranslatePage;
