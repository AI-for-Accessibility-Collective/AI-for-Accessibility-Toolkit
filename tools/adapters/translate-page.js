// Translate Page — translates the page's readable text into a target language
// with AI. From the co-design study: P3 translates sites to Spanish because
// "English is my second language."
//
// It translates the page's text pieces in place (each text node keeps its
// spot), so links, buttons, photos and prices keep working and look the same.
// An earlier version replaced each paragraph or list item with flat text,
// which deleted the links and photos inside it, and it asked the AI once per
// block, 80 calls for one product page. Now many pieces go to the AI in one
// call, as numbered lines, which also gives the AI the context to leave brand
// and product names alone. Reversible: disable() puts each piece's original
// text back, and leaves alone any piece the page itself has changed since.
import { translateText, announce } from '../utils/ai.js';
import { rejectRewrite } from '../utils/ai-output.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'TEXTAREA', 'KBD', 'SAMP']);
// Never translated: text marked "do not translate", editable text, and live
// regions (changing a message makes a screen reader read it again).
const SKIP_SEL = '[translate="no"], .notranslate, [contenteditable]:not([contenteditable="false"]), ' +
  '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MAX_PIECES = 1500;   // text pieces per page
const MAX_CALLS = 40;      // AI calls per page, including text the page adds later
const BATCH_CHARS = 2000;  // characters of text per AI call
const BATCH_LINES = 50;    // pieces per AI call
const CONCURRENCY = 4;     // AI calls at once
const RESCAN_MS = 800;
// A spot the page rewrites again and again (a countdown) is left in the page's
// language after this many rounds, so it cannot keep spending AI calls.
const MAX_REDOS = 2;

// Output gate band. Character counts move a lot between scripts. On 20
// short English and Chinese or Japanese pairs written by hand for this check
// (menu labels, headings, one or two sentences), English into Chinese or
// Japanese ran from 0.15 to 0.57 of the source length and the reverse from
// 1.75 to 6.5 times, so a floor of 0.25 and a ceiling of 4 each rejected 4
// of the 20. The band is wide on purpose: it catches a piece that came back
// as almost nothing, or as several times the source, and nothing finer.
// A piece under RATIO_MIN_INPUT_CHARS (16 characters, in ai-output.js) is
// not held to the band at all: "目录" to "Table of contents" is 8.5 times
// the source.
// FLAG(review): 0.1 and 8 rest on those 20 hand-written pairs, not on model
// output, a fragment above a tenth of the source passes, and a piece under
// 16 characters accepts any length.
const MIN_TRANSLATED_RATIO = 0.1;
const MAX_TRANSLATED_RATIO = 8;

// Language names to the codes screen readers use to pick a voice. Without
// the right lang, a screen reader reads Spanish with an English voice.
const LANG_CODES = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl',
  chinese: 'zh', 'simplified chinese': 'zh-Hans', 'traditional chinese': 'zh-Hant', japanese: 'ja', korean: 'ko',
  vietnamese: 'vi', tagalog: 'tl', filipino: 'fil', hindi: 'hi', arabic: 'ar', russian: 'ru', polish: 'pl',
  ukrainian: 'uk', turkish: 'tr', persian: 'fa', hebrew: 'he', greek: 'el', thai: 'th', indonesian: 'id',
};

// Answers kept for the session, so turning translation off and on again, or
// a page re-rendering the same words, costs no AI call.
const memory = new Map();
const MEMORY_MAX = 5000;
function remember(key, value) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
  memory.set(key, value);
}

export const TranslatePage = {
  enabled: false,
  translated: null,   // Set of { node, original, value } — one per translated text piece
  targetLang: 'English',
  session: 0,
  calls: 0,
  observer: null,
  rescanTimer: null,
  redos: null,        // WeakMap element -> times its text was translated again
  values: null,       // WeakMap text node -> the translation we put in it
  tried: null,        // WeakMap text node -> the text it had when we last sent it
  langBefore: undefined,

  async enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const session = ++this.session;
    this.translated = new Set();
    this.redos = new WeakMap();
    this.values = new WeakMap();
    this.tried = new WeakMap();
    this.calls = 0;
    this.targetLang = options.targetLang || options.lang || 'English';

    // The whole page: a translated page with an English menu and footer is
    // only half translated.
    const root = document.body;
    if (!root) { announce('Nothing to translate'); return; }

    announce(`Translating to ${this.targetLang}…`);
    const done = await this.translateUnder(root, session, false);
    if (session !== this.session || !this.enabled) return;
    console.log(`[AI4A11y] Translate Page: ${done} text pieces → ${this.targetLang}` +
      (this.calls >= MAX_CALLS ? ' (stopped at the AI call limit)' : ''));
    announce(done ? `Translated ${done} passages to ${this.targetLang}` : 'Translation unavailable');
    this.watch(root, session);
  },

  // Every text piece under root worth translating: it has letters, and it is
  // not code, a script, a live region, or text marked not to translate.
  collect(root) {
    const out = [];
    const walk = (el) => {
      for (let n = el.firstChild; n && out.length < MAX_PIECES; n = n.nextSibling) {
        if (n.nodeType === 3) {
          if (/\p{L}/u.test(n.nodeValue) && !this.isOurs(n)) out.push(n);
        } else if (n.nodeType === 1) {
          if (SKIP_TAGS.has(n.tagName)) continue;
          if (n.namespaceURI && n.namespaceURI !== HTML_NS) continue;
          if (n.matches && n.matches(SKIP_SEL)) continue;
          walk(n);
        }
      }
    };
    try { walk(root); } catch { /* detached mid-walk */ }
    return out;
  },

  isOurs(node) {
    return !!this.values && this.values.get(node) === node.nodeValue;
  },

  // Translate every piece under root: answers already in memory land at once,
  // the rest go to the AI in batches. Returns how many pieces changed.
  async translateUnder(root, session, later) {
    const lang = this.targetLang;
    const nodes = this.collect(root);
    const pending = new Map(); // text -> [nodes]
    let done = 0;
    for (const node of nodes) {
      // Sent before and unchanged since: it failed, or came back the same
      // ("Redbird", "USB-C"). Asking again would cost a call for nothing.
      if (this.tried.get(node) === node.nodeValue) continue;
      this.tried.set(node, node.nodeValue);
      if (later) {
        // Text the page put back or rewrote. A spot that keeps changing (a
        // countdown) stops being translated after a few rounds.
        const host = node.parentElement;
        const n = (host && this.redos.get(host)) || 0;
        if (host && n >= MAX_REDOS) continue;
        if (host) this.redos.set(host, n + 1);
      }
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      const known = memory.get(lang + '\n' + text);
      if (known) { done += this.apply(node, known); continue; }
      if (!pending.has(text)) pending.set(text, []);
      pending.get(text).push(node);
    }

    // Batches of whole pieces, in page order, so the top of the page is done first.
    const batches = [];
    let batch = [], size = 0;
    for (const text of pending.keys()) {
      if (batch.length && (batch.length >= BATCH_LINES || size + text.length > BATCH_CHARS)) { batches.push(batch); batch = []; size = 0; }
      batch.push(text); size += text.length;
    }
    if (batch.length) batches.push(batch);

    let next = 0;
    const worker = async () => {
      while (next < batches.length && this.enabled && session === this.session && this.calls < MAX_CALLS) {
        const texts = batches[next++];
        this.calls++;
        const answers = await this.ask(texts, lang);
        if (!this.enabled || session !== this.session) return;
        texts.forEach((text, i) => {
          const out = answers[i];
          if (out == null) return;
          remember(lang + '\n' + text, out);
          for (const node of pending.get(text)) done += this.apply(node, out);
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    if (done && this.langBefore === undefined && LANG_CODES[lang.toLowerCase()]) {
      // Tell screen readers which voice to use for the page now.
      this.langBefore = document.documentElement.getAttribute('lang');
      document.documentElement.setAttribute('lang', LANG_CODES[lang.toLowerCase()]);
    }
    return done;
  },

  // One AI call for a batch. A single piece goes as it is; several go as
  // numbered lines, and each line that comes back is matched to its piece by
  // its number, so one garbled line costs only that piece. Every answer is
  // gated before it replaces what the reader sees: a refusal or a fragment
  // leaves the piece as it was.
  async ask(texts, lang) {
    const answers = new Array(texts.length).fill(null);
    let reply;
    const input = texts.length === 1 ? texts[0] : texts.map((t, i) => `[${i + 1}] ${t}`).join('\n');
    try { reply = await translateText(input, lang); }
    catch (e) { // provider failure: leave these pieces untouched, and say why
      console.warn('[AI4A11y] Translate: left text untouched, provider error:', e);
      return answers;
    }
    if (reply == null) return answers;
    let outs;
    if (texts.length === 1) outs = [reply];
    else {
      if (typeof reply !== 'string') return answers;
      outs = new Array(texts.length).fill(null);
      let at = -1;
      for (const line of reply.split('\n')) {
        const m = /^\s*\[(\d{1,3})\]\s?(.*)$/.exec(line);
        if (m) { at = Number(m[1]) - 1; if (at >= 0 && at < outs.length) outs[at] = m[2]; else at = -1; }
        else if (at >= 0 && line.trim()) outs[at] += ' ' + line.trim(); // a long line the model wrapped
      }
    }
    let rejectedCount = 0;
    outs.forEach((out, i) => {
      if (out == null) return;
      const rejected = rejectRewrite(out, texts[i], { minRatio: MIN_TRANSLATED_RATIO, maxRatio: MAX_TRANSLATED_RATIO }) ||
        (texts.length > 1 && /\[\d{1,3}\]/.test(out) ? 'holds another line' : null);
      if (rejected) { rejectedCount++; return; }
      answers[i] = out.trim();
    });
    if (rejectedCount) console.warn(`[AI4A11y] Translate: left ${rejectedCount} piece(s) untouched, rejected model output`);
    return answers;
  },

  // Put a translation in one text node, keeping the spaces around it so words
  // next to links and bold text do not run together.
  apply(node, out) {
    if (!node.parentNode) return 0;
    const original = node.nodeValue;
    const lead = /^\s*/.exec(original)[0], trail = /\s*$/.exec(original)[0];
    const value = lead + out + trail;
    if (value === original) return 0;
    node.nodeValue = value;
    this.values.set(node, value);
    this.translated.add({ node, original, value });
    return 1;
  },

  // Pages add text after load (search results, a cart sheet, an error). It is
  // translated too, a moment after it lands, within the same call budget.
  watch(root, session) {
    if (typeof MutationObserver === 'undefined' || this.calls >= MAX_CALLS) return;
    this.observer = new MutationObserver((records) => {
      const fresh = records.some((r) => r.type === 'characterData'
        ? !this.isOurs(r.target)
        : [...r.addedNodes].some((n) => n.nodeType === 1 || (n.nodeType === 3 && /\p{L}/u.test(n.nodeValue))));
      if (!fresh || this.rescanTimer) return;
      this.rescanTimer = setTimeout(async () => {
        this.rescanTimer = null;
        if (!this.enabled || session !== this.session) return;
        if (this.calls >= MAX_CALLS) { this.observer?.disconnect(); return; }
        await this.translateUnder(root, session, true);
      }, RESCAN_MS);
    });
    this.observer.observe(root, { childList: true, characterData: true, subtree: true });
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.session++;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null; }
    if (this.translated) {
      for (const { node, original, value } of this.translated) {
        // A piece the page has rewritten since is the page's now: leave it.
        try { if (node.nodeValue === value) node.nodeValue = original; } catch { /* node gone */ }
      }
      this.translated.clear();
      this.translated = null;
    }
    if (this.langBefore !== undefined) {
      if (this.langBefore === null) document.documentElement.removeAttribute('lang');
      else document.documentElement.setAttribute('lang', this.langBefore);
      this.langBefore = undefined;
    }
    announce('Original text restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yTranslatePage = TranslatePage;
