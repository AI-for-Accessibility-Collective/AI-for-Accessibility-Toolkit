// Language Tag — wraps runs of foreign-script text in lang-attributed spans so
// screen readers switch to the right pronunciation engine. Unmarked foreign
// text is a classic BLV papercut: without a lang attribute a screen reader
// reads 世界 or Привет with the page language's pronunciation rules, producing
// noise. Pure Unicode-script heuristics — no AI, no network.
//
// Reversible by construction via the shared transformTextNodes primitive: each
// mixed-script text node is replaced by a wrapper span built with DOM APIs
// (never innerHTML) and the exact original node is restored on disable. If the
// page's <html> lacks a lang attribute, a best guess is added (and removed on
// disable — a pre-existing lang is never touched).
import { announce } from '../../utils/ai.js';
import { transformTextNodes, mainRoot } from './_primitives.js';

const MAX_TEXT_NODES = 2000; // cap work on pathological pages
const SAMPLE_CHAR_BUDGET = 4000; // chars sampled to determine the page's main script

// Code-point ranges per writing script. BMP-only on purpose: these cover the
// scripts screen readers commonly mispronounce; anything outside counts as
// neutral (punctuation, digits, symbols) and is never wrapped.
const SCRIPT_RANGES = [
  ['Latin', [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0x24f]]],
  ['Han', [[0x4e00, 0x9fff], [0x3400, 0x4dbf], [0xf900, 0xfaff]]],
  ['Hiragana', [[0x3040, 0x309f]]],
  ['Katakana', [[0x30a0, 0x30ff], [0x31f0, 0x31ff]]],
  ['Hangul', [[0xac00, 0xd7af], [0x1100, 0x11ff], [0x3130, 0x318f]]],
  ['Arabic', [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff]]],
  ['Cyrillic', [[0x0400, 0x04ff], [0x0500, 0x052f]]],
  ['Hebrew', [[0x0590, 0x05ff]]],
  ['Devanagari', [[0x0900, 0x097f]]],
  ['Greek', [[0x0370, 0x03ff], [0x1f00, 0x1fff]]],
  ['Thai', [[0x0e00, 0x0e7f]]],
];

// Best-guess BCP 47 tag per script. Latin appears only for the <html> lang
// fallback — Latin runs are never wrapped (we can't tell English from French).
const SCRIPT_LANG = {
  Latin: 'en', Han: 'zh', Hiragana: 'ja', Katakana: 'ja', Hangul: 'ko',
  Arabic: 'ar', Cyrillic: 'ru', Hebrew: 'he', Devanagari: 'hi', Greek: 'el', Thai: 'th',
};

const KANA_RE = /[぀-ヿㇰ-ㇿ]/; // Hiragana + Katakana (incl. phonetic extensions)

function scriptOf(cp) {
  for (const [script, ranges] of SCRIPT_RANGES) {
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return script;
  }
  return null;
}

// Sample the page's visible text and return the dominant script's language
// (default "en" for Latin). Kanji alongside kana reads as Japanese, not
// Chinese. Mirrors the transform's skip list so code/scripts don't skew the
// count toward Latin.
const SAMPLE_SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT', 'SELECT', 'OPTION']);

function detectMainLang(root) {
  const counts = new Map();
  let budget = SAMPLE_CHAR_BUDGET;
  const walk = (node) => {
    for (let child = node.firstChild; child && budget > 0; child = child.nextSibling) {
      if (child.nodeType === 3) {
        for (const ch of child.nodeValue) {
          if (budget-- <= 0) break;
          const script = scriptOf(ch.codePointAt(0));
          if (script) counts.set(script, (counts.get(script) || 0) + 1);
        }
      } else if (child.nodeType === 1 && !SAMPLE_SKIP.has(child.tagName)) {
        walk(child);
      }
    }
  };
  try { walk(root); } catch { /* detached mid-walk */ }

  let main = 'Latin', best = 0;
  for (const [script, n] of counts) {
    if (n > best) { best = n; main = script; }
  }
  const kana = (counts.get('Hiragana') || 0) + (counts.get('Katakana') || 0);
  if (main === 'Han' && kana > 0) return 'ja';
  return SCRIPT_LANG[main] || 'en';
}

export const LanguageTag = {
  markerClass: 'ai4a11y-lang',
  enabled: false,
  handle: null, // transformTextNodes handle (owns the exact-restore)
  mainLang: null, // page's dominant language while enabled
  htmlLangAdded: false, // we added <html lang>; remove it on disable

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    const root = mainRoot();
    if (!root) { announce('Language tags: no readable text found'); return; }

    this.mainLang = (typeof options.mainLang === 'string' && options.mainLang)
      ? options.mainLang : detectMainLang(root);

    // A page with no <html lang> at all: give the screen reader our best
    // guess for the base language too. Never touch a pre-existing lang.
    const html = document.documentElement;
    if (html && !html.hasAttribute('lang')) {
      html.setAttribute('lang', this.mainLang);
      this.htmlLangAdded = true;
    }

    // Skip our own wrappers on re-scan; the primitive skips code/pre/etc. by default.
    this.handle = transformTextNodes(root, (text) => this.buildWrapper(text), {
      skipClass: this.markerClass,
      cap: MAX_TEXT_NODES,
    });
    const count = this.handle.records.length;
    if (this.handle.capped) console.log(`[AI4A11y] Language Tag: capped at ${MAX_TEXT_NODES} text nodes`);
    console.log(`[AI4A11y] Language Tag enabled (${count} text nodes tagged, main language "${this.mainLang}")`);
    announce(count ? 'Language tags on' : 'Language tags: no foreign-language text found');
  },

  // Rebuild one mixed-script text node as a marker <span>: runs of a foreign
  // script become <span lang="xx"> children, everything else stays plain text
  // nodes. Returns null (skip) when the node has no foreign-script run, so
  // same-script text is left untouched.
  buildWrapper(text) {
    const hasKana = KANA_RE.test(text);
    const runs = [];
    for (const ch of text) {
      const lang = this.langOfChar(ch.codePointAt(0), hasKana);
      const last = runs[runs.length - 1];
      if (last && last.lang === lang) last.text += ch;
      else runs.push({ lang, text: ch });
    }
    if (!runs.some((run) => run.lang)) return null;

    const span = document.createElement('span');
    span.className = this.markerClass;
    for (const run of runs) {
      if (run.lang) {
        const tagged = document.createElement('span');
        tagged.setAttribute('lang', run.lang);
        tagged.textContent = run.text;
        span.appendChild(tagged);
      } else {
        span.appendChild(document.createTextNode(run.text));
      }
    }
    return span;
  },

  // Language a character should be announced in, or null when it needs no tag
  // (neutral chars, Latin, or the page's own language).
  langOfChar(cp, hasKana) {
    const script = scriptOf(cp);
    if (!script || script === 'Latin') return null;
    let lang = SCRIPT_LANG[script];
    // Han characters near kana (or on a Japanese page) are kanji, not Chinese.
    if (script === 'Han' && (hasKana || this.mainLang === 'ja')) lang = 'ja';
    return lang === this.mainLang ? null : lang;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.handle) { this.handle.restore(); this.handle = null; }
    if (this.htmlLangAdded) {
      try { document.documentElement.removeAttribute('lang'); } catch { /* doc gone */ }
      this.htmlLangAdded = false;
    }
    this.mainLang = null;
    console.log('[AI4A11y] Language Tag disabled');
    announce('Language tags off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yLanguageTag = LanguageTag;
