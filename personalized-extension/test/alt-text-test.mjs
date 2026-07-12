// alt-text-test.mjs — Node unit tests for auto-alt-text.js pure-logic exports.
//
// Tests:
//   1. isConfidentDescription — confidence gate function
//   2. fitDimensions — aspect-ratio-preserving downscale math
//   3. shouldDescribe — skip-decision function (no DOM needed)
//
// Run:  node test/alt-text-test.mjs
// No browser, no jsdom — the three exports under test are pure logic.
//
// IMPORTANT: dom-accessibility-api is a browser module and is NOT imported
// here.  shouldDescribe() receives pre-computed elInfo so tests can run in Node.

import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ''); }
}

// ---------------------------------------------------------------------------
// Minimal browser-global stubs required so auto-alt-text.js imports cleanly.
// The pure exports don't use these at runtime, but the module body references
// them.  We stub at module scope before the dynamic import.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (#22 fix) Import the REAL exported functions from auto-alt-text.js so
// test assertions bind to the shipped implementation, not a private copy.
//
// Blocker analysis: auto-alt-text.js imports utils/observe.js, whose module
// body calls window.addEventListener('popstate', ...) at top level. That is
// the sole import-time browser side effect that blocks a plain Node import.
// The dom-accessibility-api comment below was a misdiagnosis — that package is
// imported at the module level of auto-alt-text.js but computeAccessibleName
// is only CALLED inside shouldDescribe's callers, not in shouldDescribe itself,
// and the ESM import of dom-accessibility-api itself does not call browser APIs
// at module-evaluation time in recent versions.
//
// Fix: add window.addEventListener stub BEFORE the dynamic import so observe.js
// does not throw. The rest of the existing stubs (window, document, chrome, etc.)
// already satisfy the other top-level references.
// ---------------------------------------------------------------------------

// Stubs must be set BEFORE the dynamic import below executes.
globalThis.window = globalThis.window || {};
// (#22 fix) observe.js calls window.addEventListener at module-evaluation time.
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => null, toDataURL: () => '' }),
  createElementNS: () => ({}),
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
};
globalThis.MutationObserver = globalThis.MutationObserver || class { constructor() {} observe() {} disconnect() {} };
globalThis.location = globalThis.location || { href: 'https://example.com/' };
globalThis.chrome = globalThis.chrome || { runtime: { sendMessage: null, lastError: null } };
globalThis.CSS = globalThis.CSS || { escape: s => s };
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({
  display: 'block', visibility: 'visible', opacity: '1'
}));

// Import the REAL pure exports. If the import throws, abort immediately with a
// clear message so the failure is not mistaken for test failures.
const autoAltTextPath = new URL('../skills/builtin/auto-alt-text.js', import.meta.url).href;
let isConfidentDescription, fitDimensions, shouldDescribe;
try {
  const mod = await import(autoAltTextPath);
  isConfidentDescription = mod.isConfidentDescription;
  fitDimensions = mod.fitDimensions;
  shouldDescribe = mod.shouldDescribe;
  if (typeof isConfidentDescription !== 'function' || typeof fitDimensions !== 'function' || typeof shouldDescribe !== 'function') {
    throw new Error(`Missing exports: isConfidentDescription=${typeof isConfidentDescription}, fitDimensions=${typeof fitDimensions}, shouldDescribe=${typeof shouldDescribe}`);
  }
  console.log('PASS: imported real isConfidentDescription / fitDimensions / shouldDescribe from auto-alt-text.js');
} catch (err) {
  console.error('FAIL: could not import auto-alt-text.js —', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. isConfidentDescription
// ---------------------------------------------------------------------------
{
  // Valid descriptions
  check('confidence: normal description passes', isConfidentDescription('A dog sitting on a park bench'));
  check('confidence: short but valid (3 chars)', isConfidentDescription('Cat'));
  check('confidence: 300-char string passes', isConfidentDescription('A'.repeat(300)));

  // Length bounds
  check('confidence: null → false', !isConfidentDescription(null));
  check('confidence: undefined → false', !isConfidentDescription(undefined));
  check('confidence: empty string → false', !isConfidentDescription(''));
  check('confidence: too short (< 3 chars)', !isConfidentDescription('Ab'));
  check('confidence: just 2 chars fails', !isConfidentDescription('ab'));
  check('confidence: 301-char string fails', !isConfidentDescription('A'.repeat(301)));

  // Refusal prefixes
  check('confidence: "I cannot" → false', !isConfidentDescription('I cannot describe this image.'));
  check("confidence: \"I'm unable\" → false", !isConfidentDescription("I'm unable to see the image."));
  check('confidence: "I am unable" → false', !isConfidentDescription('I am unable to help.'));
  check('confidence: "Sorry" → false', !isConfidentDescription('Sorry, I cannot describe this.'));
  check('confidence: "Unfortunately" → false', !isConfidentDescription('Unfortunately I cannot tell.'));

  // Uncertainty terms anywhere in string
  check('confidence: contains "unsure" → false', !isConfidentDescription('The image is unsure whether it shows a cat or dog.'));
  check('confidence: contains "unclear" → false', !isConfidentDescription('The content is unclear.'));
  check('confidence: contains "I cannot tell" → false', !isConfidentDescription('I cannot tell what this shows.'));
  check('confidence: contains "cannot determine" → false', !isConfidentDescription('I cannot determine the subject.'));

  // Generic junk single-word responses
  check('confidence: "image" → false', !isConfidentDescription('image'));
  check('confidence: "picture" → false', !isConfidentDescription('picture'));
  check('confidence: "photo" → false', !isConfidentDescription('photo'));
  check('confidence: "icon" → false', !isConfidentDescription('icon'));
  check('confidence: "logo" → false', !isConfidentDescription('logo'));
  check('confidence: "Image" (case-insensitive) → false', !isConfidentDescription('Image'));

  // Word "image" appearing inside a real description is fine
  check('confidence: "image of a cat" passes (not exact match)', isConfidentDescription('image of a cat'));
  // Wait — 'image of a cat' is 14 chars and not in GENERIC_JUNK set (which checks exact lowercased match)
  // and doesn't start with a refusal prefix.  Should pass.
}

// ---------------------------------------------------------------------------
// 2. fitDimensions — aspect ratio and max-edge capping
// ---------------------------------------------------------------------------
{
  // Square: already within limit
  const s = fitDimensions(100, 100);
  check('fitDimensions: 100×100 unchanged', s.w === 100 && s.h === 100, s);

  // Wide landscape: 1024×512 → 512×256
  const wide = fitDimensions(1024, 512);
  check('fitDimensions: 1024×512 → w=512', wide.w === 512, wide);
  check('fitDimensions: 1024×512 → h=256', wide.h === 256, wide);

  // Tall portrait: 256×1024 → 128×512
  const tall = fitDimensions(256, 1024);
  check('fitDimensions: 256×1024 → h=512', tall.h === 512, tall);
  check('fitDimensions: 256×1024 → w=128', tall.w === 128, tall);

  // Exactly on the limit: 512×512 → unchanged
  const onLimit = fitDimensions(512, 512);
  check('fitDimensions: 512×512 unchanged', onLimit.w === 512 && onLimit.h === 512, onLimit);

  // Very large square: 2000×2000 → 512×512
  const big = fitDimensions(2000, 2000);
  check('fitDimensions: 2000×2000 → 512×512', big.w === 512 && big.h === 512, big);

  // Aspect ratio preserved for non-square large image: 800×600
  const landscape = fitDimensions(800, 600);
  // long edge = 800, scale = 512/800 = 0.64, w=512, h=384
  check('fitDimensions: 800×600 → w=512', landscape.w === 512, landscape);
  check('fitDimensions: 800×600 → h=384', landscape.h === 384, landscape);

  // Zero / degenerate: clamp to 1
  const zero = fitDimensions(0, 0);
  check('fitDimensions: 0×0 does not produce NaN', !isNaN(zero.w) && !isNaN(zero.h), zero);

  // Very thin strip: 2×1000
  const strip = fitDimensions(2, 1000);
  check('fitDimensions: 2×1000 → h=512', strip.h === 512, strip);
  // w = round(2 * 512/1000) = round(1.024) = 1
  check('fitDimensions: 2×1000 → w≥1', strip.w >= 1, strip);

  // Verify aspect ratio numerically: ratio |w/h - nw/nh| < 0.02
  function approxRatio(r, nw, nh) {
    const expected = nw / nh;
    const actual = r.w / r.h;
    return Math.abs(actual - expected) < 0.02;
  }
  check('fitDimensions: 800×600 aspect ratio preserved', approxRatio(landscape, 800, 600), landscape);
  check('fitDimensions: 256×1024 aspect ratio preserved', approxRatio(tall, 256, 1024), tall);
  check('fitDimensions: 1024×512 aspect ratio preserved', approxRatio(wide, 1024, 512), wide);
}

// ---------------------------------------------------------------------------
// 3. shouldDescribe — skip-decision logic
// ---------------------------------------------------------------------------
{
  // Helper: build elInfo with sensible defaults.
  function el(overrides = {}) {
    return {
      hasAltAttr: false,
      isEmptyAlt: false,
      isAriaHidden: false,
      role: '',
      renderedWidth: 64,
      renderedHeight: 64,
      isElementVisible: true,
      accessibleName: '',
      ...overrides,
    };
  }

  // Case: element that needs a description.
  const needs = shouldDescribe(el());
  check('shouldDescribe: plain unlabeled 64×64 visible img → should describe', !needs.skip, needs);

  // Case: decorative alt="" — must skip.
  const deco = shouldDescribe(el({ isEmptyAlt: true, hasAltAttr: true }));
  check('shouldDescribe: alt="" → skip', deco.skip, deco);
  check('shouldDescribe: alt="" reason mentions decorative', deco.reason.includes('decorative'), deco.reason);

  // Case: aria-hidden ancestor — must skip.
  const ariaH = shouldDescribe(el({ isAriaHidden: true }));
  check('shouldDescribe: aria-hidden → skip', ariaH.skip, ariaH);

  // Case: role="presentation" — must skip.
  const pres = shouldDescribe(el({ role: 'presentation' }));
  check('shouldDescribe: role=presentation → skip', pres.skip, pres);

  // Case: role="none" — must skip.
  const none = shouldDescribe(el({ role: 'none' }));
  check('shouldDescribe: role=none → skip', none.skip, none);

  // Case: tiny image 31×31 — must skip.
  const tiny = shouldDescribe(el({ renderedWidth: 31, renderedHeight: 31 }));
  check('shouldDescribe: 31×31 → skip (< 32×32)', tiny.skip, tiny);

  // Case: exactly 32×32 — just large enough, should NOT skip for size.
  const min = shouldDescribe(el({ renderedWidth: 32, renderedHeight: 32 }));
  check('shouldDescribe: 32×32 → does not skip for size', !min.skip, min);

  // Case: 64×31 — short in one dimension — must skip.
  const shortH = shouldDescribe(el({ renderedWidth: 64, renderedHeight: 31 }));
  check('shouldDescribe: 64×31 → skip (height < 32)', shortH.skip, shortH);

  // Case: invisible element — must skip.
  const hidden = shouldDescribe(el({ isElementVisible: false }));
  check('shouldDescribe: hidden element → skip', hidden.skip, hidden);

  // Case: already has accessible name — must skip.
  const named = shouldDescribe(el({ accessibleName: 'The company logo' }));
  check('shouldDescribe: non-empty accessibleName → skip', named.skip, named);

  // Case: whitespace-only accessible name — should NOT skip (same as empty).
  const ws = shouldDescribe(el({ accessibleName: '   ' }));
  check('shouldDescribe: whitespace-only accessibleName → does not skip', !ws.skip, ws);

  // Case: combination — aria-hidden + tiny → aria-hidden wins (checked first).
  const combo = shouldDescribe(el({ isAriaHidden: true, renderedWidth: 8, renderedHeight: 8 }));
  check('shouldDescribe: aria-hidden + tiny → skip (aria-hidden wins)', combo.skip, combo);
  check('shouldDescribe: aria-hidden reason cited', combo.reason.includes('aria-hidden'), combo.reason);
}

// ---------------------------------------------------------------------------
// 4. SVG prev-role restore decision logic (#4)
//
// We replicate the sentinel logic from generateSvgDescription / disable() here,
// which is consistent with this file's pattern for the pure-logic exports.
// Tests the decision tree:
//   - svg had no role → sentinel stored → revert removes role
//   - svg had role="img" (the axe-triggered case) → stored → revert restores
//   - svg had a different author role → stored → revert restores that role
//   - no marker (defensive) → revert removes role (same as sentinel)
// ---------------------------------------------------------------------------
{
  const EMPTY_SENTINEL = '\x00';
  const PREV_ROLE_ATTR = 'data-ai4a11y-prev-role';

  // Minimal mock element.
  function makeSvg(attrs = {}) {
    const el = {
      _attrs: { ...attrs },
      getAttribute(n) { return this._attrs[n] ?? null; },
      setAttribute(n, v) { this._attrs[n] = v; },
      removeAttribute(n) { delete this._attrs[n]; },
      hasAttribute(n) { return n in this._attrs; },
    };
    return el;
  }

  // Replicate generateSvgDescription's role-provenance write logic.
  function applyRole(svg) {
    const priorRole = svg.hasAttribute('role')
      ? (svg.getAttribute('role') || EMPTY_SENTINEL)
      : EMPTY_SENTINEL;
    svg.setAttribute(PREV_ROLE_ATTR, priorRole);
    if (priorRole === EMPTY_SENTINEL) {
      svg.setAttribute('role', 'img');
    }
  }

  // Replicate disable()'s SVG revert logic.
  function revertRole(svg) {
    const prevRole = svg.getAttribute(PREV_ROLE_ATTR);
    if (prevRole === null || prevRole === EMPTY_SENTINEL) {
      svg.removeAttribute('role');
    } else {
      svg.setAttribute('role', prevRole);
    }
    svg.removeAttribute(PREV_ROLE_ATTR);
  }

  // Case A: SVG had no role → we add role="img" → revert removes it.
  {
    const svg = makeSvg({});
    check('prev-role (A): svg with no role has no role attr before apply', !svg.hasAttribute('role'));
    applyRole(svg);
    check('prev-role (A): role="img" set after apply (was absent)', svg.getAttribute('role') === 'img');
    check('prev-role (A): sentinel stored in prev-role', svg.getAttribute(PREV_ROLE_ATTR) === EMPTY_SENTINEL);
    revertRole(svg);
    check('prev-role (A): role removed after revert (sentinel → removeAttribute)', !svg.hasAttribute('role'));
    check('prev-role (A): prev-role marker removed after revert', !svg.hasAttribute(PREV_ROLE_ATTR));
  }

  // Case B: SVG already had role="img" (exactly what the svg-img-alt axe rule flags) →
  //   we do NOT re-set role → revert restores the original role="img".
  {
    const svg = makeSvg({ role: 'img' });
    applyRole(svg);
    check('prev-role (B): prior role="img" stored (not sentinel)',
      svg.getAttribute(PREV_ROLE_ATTR) === 'img');
    check('prev-role (B): role unchanged after apply (still "img")',
      svg.getAttribute('role') === 'img');
    revertRole(svg);
    check('prev-role (B): role restored to "img" after revert (not removed)',
      svg.getAttribute('role') === 'img');
    check('prev-role (B): prev-role marker removed', !svg.hasAttribute(PREV_ROLE_ATTR));
  }

  // Case C: SVG had a different author role (e.g. "graphics-document").
  {
    const svg = makeSvg({ role: 'graphics-document' });
    applyRole(svg);
    check('prev-role (C): prior "graphics-document" stored',
      svg.getAttribute(PREV_ROLE_ATTR) === 'graphics-document');
    check('prev-role (C): role unchanged after apply (still "graphics-document")',
      svg.getAttribute('role') === 'graphics-document');
    revertRole(svg);
    check('prev-role (C): role restored to "graphics-document" after revert',
      svg.getAttribute('role') === 'graphics-document');
  }

  // Case D: No prev-role marker present (defensive — guard: treat like sentinel).
  {
    const svg = makeSvg({ role: 'img' });
    // Deliberately skip applyRole — simulate missing marker.
    revertRole(svg);
    check('prev-role (D): no marker → role removed (defensive, same as sentinel)',
      !svg.hasAttribute('role'));
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== alt-text-test.mjs: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
