// contrast-test.mjs — Node unit tests for utils/color.js
// Run: node test/contrast-test.mjs
// No browser needed. Pure logic via colorjs.io.

import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the module relative to the project root so Node resolves colorjs.io
// from node_modules.
const colorModule = path.resolve(__dirname, '..', 'utils', 'color.js');

let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS:', name);
  } else {
    fail++;
    console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : '');
  }
}

function approx(a, b, tol = 0.05) {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
const {
  parseColor,
  contrastWCAG21,
  meetsContrastAA,
  compositeOver,
  nearestAccessibleColor,
  contrastAPCA,
  getLuminance,
  getContrastRatio,
} = await import(colorModule);

// ---------------------------------------------------------------------------
// 1. parseColor — formats
// ---------------------------------------------------------------------------

{
  const hex6 = parseColor('#ff0000');
  check('parseColor: #rrggbb parses', hex6 !== null, hex6);

  const hex3 = parseColor('#f00');
  check('parseColor: #rgb shorthand parses', hex3 !== null, hex3);

  const rgb = parseColor('rgb(100, 150, 200)');
  check('parseColor: rgb() parses', rgb !== null, rgb);

  const rgba = parseColor('rgba(0, 0, 0, 0.5)');
  check('parseColor: rgba() parses', rgba !== null, rgba);
  if (rgba) {
    check('parseColor: rgba alpha captured', approx(rgba.alpha ?? 0.5, 0.5, 0.01), rgba.alpha);
  }

  const hsl = parseColor('hsl(120, 50%, 50%)');
  check('parseColor: hsl() parses', hsl !== null, hsl);

  const oklch = parseColor('oklch(0.7 0.15 180)');
  check('parseColor: oklch() parses', oklch !== null, oklch);

  const named = parseColor('red');
  check('parseColor: named color parses', named !== null, named);

  const transparent = parseColor('transparent');
  check('parseColor: transparent returns null', transparent === null, transparent);

  const rgba0 = parseColor('rgba(0, 0, 0, 0)');
  check('parseColor: rgba(0,0,0,0) returns null', rgba0 === null, rgba0);

  const empty = parseColor('');
  check('parseColor: empty string returns null', empty === null, empty);

  const garbage = parseColor('not-a-color');
  check('parseColor: garbage returns null', garbage === null, garbage);
}

// ---------------------------------------------------------------------------
// 2. contrastWCAG21 — known pairs
// ---------------------------------------------------------------------------
{
  // #777777 on white: ~4.48:1  (just below 4.5 — should FAIL)
  const ratio777 = contrastWCAG21('#777777', '#ffffff');
  check('contrastWCAG21: #777 on #fff ≈ 4.48', ratio777 !== null && approx(ratio777, 4.48, 0.15), ratio777);

  // #767676 on white: ≈ 4.54:1 (just above 4.5 — should PASS)
  const ratio767 = contrastWCAG21('#767676', '#ffffff');
  check('contrastWCAG21: #767676 on #fff ≈ 4.54', ratio767 !== null && approx(ratio767, 4.54, 0.15), ratio767);

  // black on white = 21:1
  const black = contrastWCAG21('#000000', '#ffffff');
  check('contrastWCAG21: black on white = 21:1', black !== null && approx(black, 21, 0.5), black);

  // white on white = 1:1
  const white = contrastWCAG21('#ffffff', '#ffffff');
  check('contrastWCAG21: white on white = 1:1', white !== null && approx(white, 1, 0.01), white);

  // null input → null
  const nullResult = contrastWCAG21('transparent', '#ffffff');
  check('contrastWCAG21: transparent fg returns null', nullResult === null, nullResult);
}

// ---------------------------------------------------------------------------
// 3. meetsContrastAA — thresholds
// ---------------------------------------------------------------------------
{
  // #767676 on white passes normal (≈4.54)
  check('meetsContrastAA: #767676 on white passes', meetsContrastAA('#767676', '#ffffff'), null);

  // #777777 on white fails normal
  check('meetsContrastAA: #777777 on white fails', !meetsContrastAA('#777777', '#ffffff'), null);

  // #777777 on white should pass large text (3:1 threshold)
  check('meetsContrastAA: #777777 on white passes largeText', meetsContrastAA('#777777', '#ffffff', { largeText: true }), null);

  // black on white passes both
  check('meetsContrastAA: black on white passes normal', meetsContrastAA('#000000', '#ffffff'), null);
  check('meetsContrastAA: black on white passes largeText', meetsContrastAA('#000000', '#ffffff', { largeText: true }), null);

  // transparent fg → false
  check('meetsContrastAA: transparent fg returns false', !meetsContrastAA('transparent', '#ffffff'), null);
}

// ---------------------------------------------------------------------------
// 4. compositeOver — alpha compositing
// ---------------------------------------------------------------------------
{
  // 50% black over white → ~rgb(128 128 128) or close
  const halfBlack = compositeOver('rgba(0,0,0,0.5)', '#ffffff');
  check('compositeOver: 50% black over white returns an object', halfBlack !== null && typeof halfBlack === 'object', halfBlack);

  if (halfBlack && halfBlack.coords) {
    const r = halfBlack.coords[0] ?? 0;
    // Should be around 0.5 (0–1 range in sRGB)
    check('compositeOver: 50% black over white ≈ mid-gray', approx(r, 0.5, 0.05), r);
    check('compositeOver: result is fully opaque', (halfBlack.alpha ?? 1) >= 0.99, halfBlack.alpha);
  }

  // Fully opaque fg — no compositing needed
  const opaque = compositeOver('#ff0000', '#ffffff');
  check('compositeOver: opaque fg passes through', opaque !== null, opaque);

  // Transparent fg → falls back to bg
  const trans = compositeOver('rgba(0,0,0,0)', '#ffffff');
  // Should be white or near-white
  if (trans && trans.coords) {
    check('compositeOver: transparent fg → white', trans.coords[0] > 0.9, trans.coords[0]);
  } else {
    check('compositeOver: transparent fg returns object', trans !== null, trans);
  }
}

// ---------------------------------------------------------------------------
// 5. nearestAccessibleColor — output passes AA, preserves hue, handles extremes
// ---------------------------------------------------------------------------
{
  // Low-contrast gray (#cccccc on white) → should give a much darker gray
  const fixed = nearestAccessibleColor('#cccccc', '#ffffff');
  check('nearestAccessibleColor: returns a string', typeof fixed === 'string', fixed);
  check('nearestAccessibleColor: result passes AA', meetsContrastAA(fixed, '#ffffff'), fixed);

  // Hue preservation: red with low contrast → should stay reddish
  const redFixed = nearestAccessibleColor('#ff9999', '#ffffff');
  check('nearestAccessibleColor: red on white → passes AA', meetsContrastAA(redFixed, '#ffffff'), redFixed);
  // The fixed color should be a parseable sRGB color
  check('nearestAccessibleColor: result is parseable', parseColor(redFixed) !== null, redFixed);

  // White on white → must find a dark enough color
  const whiteOnWhite = nearestAccessibleColor('#ffffff', '#ffffff');
  check('nearestAccessibleColor: white-on-white result passes AA', meetsContrastAA(whiteOnWhite, '#ffffff'), whiteOnWhite);

  // Black on black → must find a light enough color
  const blackOnBlack = nearestAccessibleColor('#000000', '#000000');
  check('nearestAccessibleColor: black-on-black result passes AA', meetsContrastAA(blackOnBlack, '#000000'), blackOnBlack);

  // Already passing color — should return something that still passes
  const alreadyPassing = nearestAccessibleColor('#000000', '#ffffff');
  check('nearestAccessibleColor: already-passing → still passes', meetsContrastAA(alreadyPassing, '#ffffff'), alreadyPassing);

  // Dark body: dark blue (#334466) on near-black (#1a1a2e) should NOT become black-on-black
  const darkFixed = nearestAccessibleColor('#334466', '#1a1a2e');
  check('nearestAccessibleColor: dark body passes AA', meetsContrastAA(darkFixed, '#1a1a2e'), darkFixed);
  // Should not be the exact same as the background
  check('nearestAccessibleColor: dark body result is not the same color', darkFixed.toLowerCase() !== 'rgb(26 26 46)', darkFixed);

  // Large-text threshold
  const largeFixed = nearestAccessibleColor('#999999', '#ffffff', { target: 3 });
  check('nearestAccessibleColor: large-text target passes 3:1', meetsContrastAA(largeFixed, '#ffffff', { largeText: true }), largeFixed);
}

// ---------------------------------------------------------------------------
// 6. contrastAPCA — advisory, returns a number, NOT used by meetsContrastAA
// ---------------------------------------------------------------------------
{
  const apca = contrastAPCA('#000000', '#ffffff');
  check('contrastAPCA: black on white returns a number', typeof apca === 'number', apca);
  check('contrastAPCA: black on white has large absolute Lc', Math.abs(apca) > 50, apca);

  const apcaNull = contrastAPCA('transparent', '#ffffff');
  check('contrastAPCA: transparent returns null', apcaNull === null, apcaNull);

  // CRITICAL: meetsContrastAA must not use APCA
  // Verify by checking that a color that barely passes WCAG21 (4.54:1) is
  // correctly approved by meetsContrastAA regardless of APCA value
  const wcagPass = meetsContrastAA('#767676', '#ffffff');
  const apcaVal = contrastAPCA('#767676', '#ffffff');
  check('meetsContrastAA uses WCAG21, not APCA (independent of APCA value)', wcagPass === true, { wcagPass, apcaVal });
}

// ---------------------------------------------------------------------------
// 7. Legacy shims — getLuminance, getContrastRatio
// ---------------------------------------------------------------------------
{
  const lum = getLuminance('#ffffff');
  check('getLuminance: white ≈ 1.0', lum !== null && approx(lum, 1.0, 0.05), lum);

  const lumBlack = getLuminance('#000000');
  check('getLuminance: black ≈ 0.0', lumBlack !== null && approx(lumBlack, 0.0, 0.01), lumBlack);

  const lumNull = getLuminance('transparent');
  check('getLuminance: transparent returns null', lumNull === null, lumNull);

  const ratio = getContrastRatio('#000000', '#ffffff');
  check('getContrastRatio: black on white ≈ 21', ratio !== null && approx(ratio, 21, 0.5), ratio);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== contrast-test.mjs: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
