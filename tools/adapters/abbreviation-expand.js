// Abbreviation Expand — marks known abbreviations and acronyms in the page's
// main text with their full form via accessible <abbr title="..."> elements,
// and fills in titles on existing <abbr> tags that lack one. Acronyms are a
// comprehension barrier for cognitive-accessibility users, and BLV users get
// the expansion announced by their screen reader instead of a letter soup.
// No AI: a built-in dictionary (overridable per-enable) drives every match.
//
// Reversible by construction via the shared transformTextNodes primitive: each
// text node containing a match is replaced by a wrapper span built with DOM
// APIs (never innerHTML) and the exact original node is restored on disable.
// Titles we set on pre-existing <abbr> elements are tracked and removed on
// disable — an <abbr> that already had a title is never touched.
import { announce } from '../utils/ai.js';
import { transformTextNodes, injectStyle, mainRoot } from './_primitives.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});

const MAX_TEXT_NODES = 2000; // cap work on pathological pages
const STYLE_ID = 'ai4a11y-abbr-styles';

// The primitive's default skip set plus ABBR: never wrap text that is already
// inside an <abbr> — nested abbrs are invalid and would double-announce.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'SELECT', 'OPTION', 'ABBR']);

// Common abbreviations → expansions. Acronym keys are matched case-sensitively
// as whole words, so prose like "the ram butted" never trips the RAM entry.
const DICTIONARY = {
  WCAG: 'Web Content Accessibility Guidelines',
  ARIA: 'Accessible Rich Internet Applications',
  API: 'Application Programming Interface',
  URL: 'Uniform Resource Locator',
  HTML: 'HyperText Markup Language',
  CSS: 'Cascading Style Sheets',
  PDF: 'Portable Document Format',
  FAQ: 'Frequently Asked Questions',
  CEO: 'Chief Executive Officer',
  CFO: 'Chief Financial Officer',
  CTO: 'Chief Technology Officer',
  CPU: 'Central Processing Unit',
  GPU: 'Graphics Processing Unit',
  RAM: 'Random Access Memory',
  USB: 'Universal Serial Bus',
  HTTP: 'HyperText Transfer Protocol',
  HTTPS: 'HyperText Transfer Protocol Secure',
  JSON: 'JavaScript Object Notation',
  SQL: 'Structured Query Language',
  GPS: 'Global Positioning System',
  ATM: 'Automated Teller Machine',
  NASA: 'National Aeronautics and Space Administration',
  FBI: 'Federal Bureau of Investigation',
  CIA: 'Central Intelligence Agency',
  UN: 'United Nations',
  EU: 'European Union',
  DNA: 'deoxyribonucleic acid',
  ETA: 'estimated time of arrival',
  ASAP: 'as soon as possible',
  DIY: 'do it yourself',
  FYI: 'for your information',
  IMO: 'in my opinion',
  TBD: 'to be determined',
  AKA: 'also known as',
  RSVP: 'please reply',
  DOB: 'date of birth',
  'e.g.': 'for example',
  'i.e.': 'that is',
  'vs.': 'versus',
  'etc.': 'and so on',
  // Shopping and product-spec abbreviations. Stores lean on these in price
  // lines, spec tables and order summaries, where there is no room to spell
  // them out.
  MSRP: "manufacturer's suggested retail price",
  OOS: 'out of stock',
  'S&S': 'Subscribe & Save, a repeat order',
  Qty: 'quantity',
  'Qty.': 'quantity',
  'Incl.': 'includes',
  'incl.': 'including',
  'mo.': 'months',
  'Avail.': 'available',
  'Cust.': 'customer',
  BSR: 'Best Sellers Rank',
  'Mfr.': 'manufacturer',
  'Mfg.': 'manufacturer',
  'Cert.': 'certification',
  'config.': 'configuration',
  'I/O': 'input and output',
  'Wt.': 'weight',
  'Dims.': 'dimensions',
  'Dia.': 'diameter',
  'Ht.': 'height',
  'Thk.': 'thickness',
  'Vol.': 'volume',
  'Compat.': 'compatible with',
  'Batt.': 'battery',
  'Insul.': 'insulation',
  'Lum.': 'lumens, how bright it is',
  'Ingr.': 'ingredients',
  'Pcs.': 'pieces',
  'Fmt.': 'format',
  'pp.': 'pages',
  'Pp.': 'pages',
  'Pub. date': 'publication date',
  'Lang.': 'language',
  'ver.': 'version',
  'len.': 'length',
  PD: 'USB Power Delivery, a fast-charging standard',
  PPS: 'Programmable Power Supply, a fast-charging standard',
  GaN: 'gallium nitride, a chip material that runs cooler',
  LED: 'light-emitting diode',
  FCC: 'Federal Communications Commission',
  UL: 'Underwriters Laboratories, a safety testing lab',
  BT: 'Bluetooth',
  ANC: 'active noise cancellation',
  'IP rating': 'Ingress Protection rating, how well it keeps out dust and water',
  CCT: 'correlated color temperature, how warm or cool the light looks',
  CRI: 'color rendering index, how true colors look under the light',
  BPA: 'bisphenol A, a chemical in some plastics',
  GMO: 'genetically modified organism',
};
// Text a screen reader announces as it changes: rewrapping it would make the
// screen reader read the message again.
const LIVE_SEL = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
const RESCAN_MS = 400;

export const AbbreviationExpand = {
  markerClass: 'ai4a11y-abbr',        // the injected <abbr> elements
  wrapperClass: 'ai4a11y-abbr-wrap',  // the text-node replacement wrappers
  enabled: false,
  handle: null,  // transformTextNodes handle (owns the exact-restore)
  handles: null, // later passes, for text the page adds after enable()
  titled: null,  // pre-existing <abbr> elements whose title WE set
  style: null,   // injectStyle handle
  observer: null,
  rescanTimer: null,
  spellOut: false, // options.spellOut: also write the full form out once, after the first use
  spelled: null,   // abbreviations already written out on this page

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.titled = [];
    // A title shows only on mouse hover: not on a phone, not from the
    // keyboard, and most screen readers skip it. With spellOut the first use
    // of each abbreviation also gets its full form in brackets, which
    // everyone sees and hears ("MSRP (manufacturer's suggested retail price)").
    this.spellOut = options.spellOut === true;
    this.spelled = new Set();

    // User entries merge over the defaults; a null-prototype object so page
    // text like "constructor" can never hit Object.prototype.
    const dict = Object.assign(Object.create(null), DICTIONARY, options.dictionary || {});
    const matcher = this.buildMatcher(dict);

    const root = mainRoot();
    if (!root || !matcher) { announce('Abbreviation expansion: no readable text found'); return; }

    // Part 1: existing <abbr> elements without a title get one from the
    // dictionary. :not([title]) also leaves title="" alone — never clobber.
    this.fillTitles(root, dict);

    // Part 2: dictionary keys in plain text get wrapped in <abbr title="...">.
    this.handles = [];
    this.handle = this.pass(root, dict, matcher, MAX_TEXT_NODES);

    this.style = injectStyle(STYLE_ID, `
      .${this.markerClass} {
        text-decoration: underline dotted;
        text-underline-offset: 2px;
        cursor: help;
      }`);

    const count = this.handle.records.length + this.titled.length;
    if (this.handle.capped) console.log(`[AI4A11y] Abbreviation Expand: capped at ${MAX_TEXT_NODES} text nodes`);
    console.log(`[AI4A11y] Abbreviation Expand enabled (${this.handle.records.length} text blocks, ${this.titled.length} existing abbr titles)`);
    announce(count ? 'Abbreviation expansion on' : 'Abbreviation expansion: no known abbreviations found');
    this.watch(root, dict, matcher);
  },

  pass(root, dict, matcher, cap) {
    return transformTextNodes(root, (text, node) => {
      const parent = node.parentElement;
      if (parent && parent.closest && parent.closest(LIVE_SEL)) return null;
      return this.buildWrapper(text, dict, matcher);
    }, { skipTags: SKIP_TAGS, skipClass: this.wrapperClass, cap });
  },

  // Stores re-render parts of the page (a cart line after a quantity change,
  // search results after a filter). Mark the new text too, a moment after it
  // lands. Our own wrappers are ignored, so this never reacts to itself.
  watch(root, dict, matcher) {
    if (typeof MutationObserver === 'undefined') return;
    const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.wrapperClass);
    this.observer = new MutationObserver((records) => {
      const fresh = records.some((r) => [...r.addedNodes].some((n) =>
        !ours(n) && (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.nodeValue)))));
      if (!fresh || this.rescanTimer) return;
      this.rescanTimer = setTimeout(() => {
        this.rescanTimer = null;
        if (!this.enabled) return;
        this.fillTitles(root, dict);
        const used = this.handles.reduce((n, h) => n + h.records.length, this.handle.records.length);
        if (used >= MAX_TEXT_NODES) return;
        const h = this.pass(root, dict, matcher, MAX_TEXT_NODES - used);
        if (h.records.length) this.handles.push(h);
      }, RESCAN_MS);
    });
    this.observer.observe(root, { childList: true, subtree: true });
  },

  // One global alternation over the dictionary keys, longest-first so HTTPS
  // wins over HTTP at the same position. Word boundaries are checked manually
  // per match (see buildWrapper) because keys like "e.g." end in non-word
  // characters where \b does not behave.
  buildMatcher(dict) {
    const keys = Object.keys(dict)
      .filter((k) => k && typeof dict[k] === 'string' && dict[k])
      .sort((a, b) => b.length - a.length);
    if (!keys.length) return null;
    const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(?:${escaped.join('|')})`, 'g');
  },

  // Set title on every dictionary-known <abbr> under root that has none,
  // remembering each so disable() can remove exactly what we added.
  fillTitles(root, dict) {
    for (const abbr of root.querySelectorAll('abbr:not([title])')) {
      try {
        if (abbr.classList.contains(this.markerClass)) continue; // ours, from a prior pass
        const expansion = dict[(abbr.textContent || '').trim()];
        if (typeof expansion !== 'string' || !expansion) continue;
        abbr.setAttribute('title', expansion);
        this.titled.push(abbr);
        logFix('abbr-title', abbr, '(none)', expansion);
      } catch { /* leave this abbr untouched */ }
    }
  },

  // Rebuild one text node's content as a wrapper <span> where each dictionary
  // match becomes <abbr class=... title=...>MATCH</abbr> and everything else
  // is re-emitted verbatim as text. Whole-word only: a match glued to a word
  // character on either side ("APIs", "SCRAPI") is skipped. Returns null when
  // nothing matched, so the caller leaves the node untouched.
  buildWrapper(text, dict, matcher) {
    matcher.lastIndex = 0;
    let wrap = null;
    let last = 0;
    let m;
    while ((m = matcher.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (start > 0 && /\w/.test(text[start - 1])) continue;
      if (end < text.length && /\w/.test(text[end])) continue;
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = this.wrapperClass;
        // Pages style their own spans (".thumb span { position: absolute }"):
        // ours start from a clean slate.
        wrap.style.cssText = 'all: unset;';
      }
      if (start > last) wrap.appendChild(document.createTextNode(text.slice(last, start)));
      const abbr = document.createElement('abbr');
      abbr.className = this.markerClass;
      abbr.setAttribute('title', dict[m[0]]);
      abbr.textContent = m[0];
      wrap.appendChild(abbr);
      if (this.spellOut && !this.spelled.has(m[0])) {
        this.spelled.add(m[0]);
        const full = document.createElement('span');
        full.className = `${this.markerClass}-full`;
        full.style.cssText = 'all: unset;';
        // The part before a comma: "USB Power Delivery", not the whole explanation.
        full.textContent = ` (${dict[m[0]].split(', ')[0]})`;
        wrap.appendChild(full);
      }
      logFix('abbr-expand', abbr, m[0], dict[m[0]]);
      last = end;
    }
    if (!wrap) return null;
    if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
    return wrap;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null; }
    for (const h of (this.handles || []).reverse()) h.restore();
    this.handles = null;
    if (this.handle) { this.handle.restore(); this.handle = null; }
    if (this.titled) {
      for (const abbr of this.titled) {
        try { abbr.removeAttribute('title'); } catch { /* already gone */ }
      }
      this.titled = null;
    }
    if (this.style) { this.style.remove(); this.style = null; }
    this.spelled = null;
    console.log('[AI4A11y] Abbreviation Expand disabled');
    announce('Abbreviation expansion off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yAbbreviationExpand = AbbreviationExpand;
