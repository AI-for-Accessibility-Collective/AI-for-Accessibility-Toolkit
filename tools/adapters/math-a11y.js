// Math A11y — gives mathematical notation an accessible name without AI.
// BLV users hit two classic math failures: MathML <math> islands with no
// accessible name that screen readers announce as silence or a soup of
// unlabeled glyphs, and equations rendered as <img> with an empty alt. This
// adapter derives a plain-language name structurally — an existing alttext,
// an embedded TeX annotation, or a spoken-word walk of the MathML tree
// (mfrac → "over", msup → "to the power of", msqrt → "square root of") —
// and mirrors it into aria-label. Math images get their TeX decoded out of
// render-service URLs (codecogs and friends) or an honest generic alt.
// Purely structural — no AI, no network.
//
// Reversible by construction: every attribute written is recorded with its
// prior value (absent vs. present-but-empty matters for img alt="") and
// disable() restores exactly that set. A pre-existing aria-label, role, or
// alttext is never clobbered — already-named elements are skipped up front.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';

const MAX_ELEMENTS = 100; // cap work on pathological pages
const MATH_HINT_RE = /math|equation|latex|tex|formula/i;
const TEX_PARAM_RE = /^(tex|latex|formula|eq|chl)$/i; // named tex params (incl. Google Chart chl)
const INVISIBLE_OPS_RE = /[⁡-⁤]/g; // invisible function/times/separator operators
const MAX_DEPTH = 20;

// MathML leaves whose text is read as-is.
const LEAF_TAGS = new Set(['mi', 'mn', 'mo', 'mtext', 'ms']);
// Subtrees that must not leak into the spoken form (annotations carry TeX
// source; mphantom is invisible by definition).
const SKIP_TAGS = new Set(['annotation', 'annotation-xml', 'mphantom']);

function hasAccessibleName(el) {
  const label = el.getAttribute('aria-label');
  if (label && label.trim()) return true;
  const labelledby = el.getAttribute('aria-labelledby');
  return !!(labelledby && labelledby.trim());
}

// Walk a MathML subtree into spoken words: layout tags become the phrases a
// human would say, leaves contribute their text, everything else joins its
// children. Lossy on purpose — a readable approximation beats silence.
function serializeMath(el, depth = 0) {
  if (depth > MAX_DEPTH) return '';
  const name = (el.localName || '').toLowerCase();
  if (SKIP_TAGS.has(name)) return '';
  if (LEAF_TAGS.has(name)) return (el.textContent || '').replace(INVISIBLE_OPS_RE, '').trim();

  const kids = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const s = serializeMath(c, depth + 1);
    if (s) kids.push(s);
  }
  switch (name) {
    case 'mfrac': return kids.join(' over ');
    case 'msup': return kids.length === 2 ? `${kids[0]} to the power of ${kids[1]}` : kids.join(' ');
    case 'msub': return kids.length === 2 ? `${kids[0]} sub ${kids[1]}` : kids.join(' ');
    case 'msubsup': return kids.length === 3
      ? `${kids[0]} sub ${kids[1]} to the power of ${kids[2]}` : kids.join(' ');
    case 'msqrt': return `square root of ${kids.join(' ')}`;
    case 'mroot': return kids.length === 2 ? `${kids[1]} root of ${kids[0]}` : `root of ${kids.join(' ')}`;
    default:
      // mrow/math/mstyle/semantics/mover/munder…: join children; a tag with
      // bare text and no element children (e.g. <math>E=mc2</math>) reads its text.
      if (kids.length) return kids.join(' ');
      return el.firstElementChild ? '' : (el.textContent || '').replace(INVISIBLE_OPS_RE, '').trim();
  }
}

// Best available plain-language name for a <math> element, in preference
// order: author-provided alttext (verbatim), embedded TeX annotation, spoken
// serialization. Always returns something — silence is the failure mode.
function deriveLabel(math) {
  const alttext = math.getAttribute('alttext');
  if (alttext && alttext.trim()) return alttext.trim();
  const ann = math.querySelector(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]');
  if (ann && ann.textContent && ann.textContent.trim()) return 'Math: ' + ann.textContent.trim();
  const spoken = serializeMath(math).replace(/\s+/g, ' ').trim();
  return spoken ? 'Math: ' + spoken : 'Mathematical expression';
}

function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')).trim() || null; }
  catch { return s.trim() || null; }
}

// Pull TeX source out of a math-render URL (latex.codecogs.com/png?x%5E2,
// mathtex.cgi?tex=…, Google Chart chl=…). Null when the URL doesn't look
// like a render service or carries no expression.
function texFromUrl(src) {
  let url;
  try { url = new URL(src, window.location.href); } catch { return null; }
  if (!MATH_HINT_RE.test(url.hostname + url.pathname)) return null;
  const query = url.search.slice(1);
  if (query) {
    for (const part of query.split('&')) {
      const eq = part.indexOf('=');
      if (eq > 0 && TEX_PARAM_RE.test(part.slice(0, eq))) return safeDecode(part.slice(eq + 1));
    }
    // codecogs style: the whole query IS the tex.
    return safeDecode(query);
  }
  // Tex in the path itself: only trust a segment with unmistakable TeX syntax.
  const seg = (url.pathname.split('/').pop() || '').replace(/\.(png|svg|gif|jpe?g)$/i, '');
  const decoded = seg ? safeDecode(seg) : null;
  return decoded && /[\\^_{}]/.test(decoded) ? decoded : null;
}

export const MathA11y = {
  styleId: 'ai4a11y-math-style',
  enabled: false,
  records: [],       // { el, attrs: [{ name, old }] } — old === null means "was absent"
  styleHandle: null, // injectStyle handle for the focus outline

  // Record the attribute's prior state, then write it — the unit of reversibility.
  setTracked(el, name, value, attrs) {
    attrs.push({ name, old: el.hasAttribute(name) ? el.getAttribute(name) : null });
    el.setAttribute(name, value);
  },

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const cap = options.cap ?? MAX_ELEMENTS;
    let mathCount = 0, imgCount = 0;

    // MathML islands without an accessible name → role="math" + aria-label.
    for (const math of document.querySelectorAll('math')) {
      if (this.records.length >= cap) break;
      if (math.getAttribute('aria-hidden') === 'true') continue;
      if (hasAccessibleName(math)) continue;
      const attrs = [];
      this.setTracked(math, 'aria-label', deriveLabel(math), attrs);
      if (!math.hasAttribute('role')) this.setTracked(math, 'role', 'math', attrs);
      this.records.push({ el: math, attrs });
      mathCount++;
    }

    // Equation images with an empty/missing alt → decoded TeX or an honest generic.
    for (const img of document.querySelectorAll('img')) {
      if (this.records.length >= cap) break;
      if (img.getAttribute('aria-hidden') === 'true') continue;
      const alt = img.getAttribute('alt');
      if (alt && alt.trim()) continue;
      const src = img.getAttribute('src') || '';
      if (!MATH_HINT_RE.test(`${img.className} ${alt || ''} ${src}`)) continue;
      const tex = texFromUrl(src);
      const attrs = [];
      this.setTracked(img, 'alt',
        tex ? `Equation: ${tex}` : 'Mathematical equation (no description available)', attrs);
      this.records.push({ el: img, attrs });
      imgCount++;
    }

    // Subtle focus outline so labeled math is visually findable when focused
    // (e.g. by a screen reader's virtual cursor or a browse-mode highlight).
    this.styleHandle = injectStyle(this.styleId,
      '[role="math"]:focus { outline: 2px solid #1a5fb4; outline-offset: 2px; }');

    console.log(`[AI4A11y] Math A11y enabled (${mathCount} MathML, ${imgCount} images labeled)`);
    announce(this.records.length ? 'Math labels on' : 'Math labels: no unlabeled math found');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    for (const { el, attrs } of this.records) {
      for (const { name, old } of attrs) {
        try {
          if (old === null) el.removeAttribute(name);
          else el.setAttribute(name, old);
        } catch { /* element gone; nothing to restore */ }
      }
    }
    this.records = [];
    if (this.styleHandle) { this.styleHandle.remove(); this.styleHandle = null; }
    console.log('[AI4A11y] Math A11y disabled');
    announce('Math labels off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yMathA11y = MathA11y;
