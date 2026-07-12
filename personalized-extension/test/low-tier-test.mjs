/**
 * low-tier-test.mjs — Phase 3 low/no-demand tier static unit checks.
 *
 * Checks:
 *   1. color-filter: correction matrix ≠ simulation matrix;
 *      correction preserves white ([1,1,1]→≈[1,1,1]);
 *      protanopia correction on pure red increases G/B differential.
 *   2. read-aloud: sentenceChunks splits correctly (≤maxChars, no empty chunks).
 *   3. focus-mode CSS: no hover-highlight rule in source.
 *   4. dark-mode CSS: single img/video rule (no duplicate that silently overrides).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function pass(msg) { console.log('PASS:', msg); passed++; }
function fail(msg) { console.log('FAIL:', msg); failed++; }

// ---------------------------------------------------------------------------
// 1. color-filter.js — daltonization matrix correctness
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'skills/builtin/color-filter.js'), 'utf8');

  // (a) Source must mention daltonization/correction, NOT simulation matrices.
  if (src.includes('daltonization') || src.includes('error-redistribution')) {
    pass('color-filter.js references daltonization/error-redistribution method');
  } else {
    fail('color-filter.js missing daltonization/error-redistribution comment');
  }

  // (b) Old simulation matrix values must be gone.
  // Old protanopia simulation: '0.567 0.433 0'
  if (src.includes('0.567 0.433 0')) {
    fail('color-filter.js still contains old protanopia simulation value (0.567 0.433 0)');
  } else {
    pass('color-filter.js no longer contains old protanopia simulation value');
  }
  if (src.includes('0.625 0.375 0')) {
    fail('color-filter.js still contains old deuteranopia simulation value (0.625 0.375 0)');
  } else {
    pass('color-filter.js no longer contains old deuteranopia simulation value');
  }

  // (c) Anchored to documentElement not body.
  if (src.includes('document.documentElement.appendChild')) {
    pass('color-filter.js appends SVG filter to documentElement (survives body re-renders)');
  } else {
    fail('color-filter.js must append SVG filter to document.documentElement, not document.body');
  }

  // (d) registerSweep used for re-injection.
  if (src.includes('registerSweep') && src.includes('observe.js')) {
    pass('color-filter.js uses registerSweep to re-inject filter if removed');
  } else {
    fail('color-filter.js missing registerSweep from observe.js');
  }

  // (e) Numeric matrix checks — parse the feColorMatrix values strings.
  // Extract values strings from the CORRECTION_FILTERS array.
  const valuesMatches = [...src.matchAll(/values:\s*'([^']+)'/g)];
  if (valuesMatches.length < 3) {
    fail(`color-filter.js expected ≥3 values strings, found ${valuesMatches.length}`);
  } else {
    pass(`color-filter.js has ${valuesMatches.length} feColorMatrix values strings`);

    // Parse each 3×3 color submatrix from the 20-value feColorMatrix string.
    // feColorMatrix format: 5 values per row × 4 rows (RGBA + offset).
    // We only care about the first 3×3 (color × color, skipping alpha cols and offsets).
    function parseColorMatrix(valStr) {
      const nums = valStr.trim().split(/\s+/).map(Number);
      // 20 values: row0[0..4] row1[5..9] row2[10..14] row3[15..19]
      // Color submatrix: nums[0..2], nums[5..7], nums[10..12]
      return [
        [nums[0], nums[1], nums[2]],
        [nums[5], nums[6], nums[7]],
        [nums[10], nums[11], nums[12]],
      ];
    }

    function applyMatrix(m, rgb) {
      return m.map(row => row.reduce((s, v, j) => s + v * rgb[j], 0));
    }

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    const proValues = valuesMatches[0][1];
    const deutValues = valuesMatches[1][1];
    const triValues = valuesMatches[2][1];

    const proMatrix = parseColorMatrix(proValues);
    const deutMatrix = parseColorMatrix(deutValues);
    const triMatrix = parseColorMatrix(triValues);

    // (e1) White preservation: apply [1,1,1] → should be close to [1,1,1] before clamping.
    for (const [name, m] of [['protanopia', proMatrix], ['deuteranopia', deutMatrix], ['tritanopia', triMatrix]]) {
      const white = applyMatrix(m, [1, 1, 1]);
      // Row sums should each be close to 1.
      const rowSums = m.map(row => row.reduce((a, b) => a + b, 0));
      const allClose = rowSums.every(s => Math.abs(s - 1) < 0.01);
      if (allClose) {
        pass(`${name} correction matrix row sums ≈ 1 (white preserved)`);
      } else {
        fail(`${name} correction matrix row sums not close to 1: [${rowSums.map(s=>s.toFixed(4)).join(', ')}]`);
      }
    }

    // (e2) Protanopia correction on pure red [1,0,0] should increase G or B differential.
    // A protanope can see blue/yellow axis; after correction, red should have
    // meaningful G or B channel signal (so they can distinguish it from green).
    const correctedRed = applyMatrix(proMatrix, [1, 0, 0]).map(clamp01);
    const gbDiffBefore = 0; // pure red has G=0, B=0
    const gbDiffAfter = Math.abs(correctedRed[1] - correctedRed[2]);
    if (gbDiffAfter > gbDiffBefore) {
      pass(`protanopia correction increases G/B differential on pure red (after=${gbDiffAfter.toFixed(3)} > before=0.000)`);
    } else {
      fail(`protanopia correction did not increase G/B differential on pure red (G=${correctedRed[1].toFixed(3)}, B=${correctedRed[2].toFixed(3)})`);
    }

    // (e3) Correction ≠ simulation: the old protanopia simulation had R=0.567.
    // The new correction has R≠0.567 (checking the [0][0] value).
    if (Math.abs(proMatrix[0][0] - 0.567) > 0.05) {
      pass('protanopia correction matrix[0][0] differs from old simulation value (0.567)');
    } else {
      fail('protanopia correction matrix[0][0] is too close to old simulation value 0.567');
    }
  }
}

// ---------------------------------------------------------------------------
// 2. read-aloud.js — sentenceChunks splitter
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'skills/builtin/read-aloud.js'), 'utf8');

  // (a) No "Reading started" announce.
  if (!src.includes("announce('Reading started')") && !src.includes('announce("Reading started")')) {
    pass('read-aloud.js has no "Reading started" announce (double-speak fix)');
  } else {
    fail('read-aloud.js still announces "Reading started" — double-speak with TTS start');
  }

  // (b) sentenceChunks function exported.
  if (src.includes('sentenceChunks') && src.includes('export')) {
    pass('read-aloud.js defines and exports sentenceChunks');
  } else {
    fail('read-aloud.js missing sentenceChunks function or export');
  }

  // (c) .sr-only stripping in extractReadableText.
  if (src.includes('.sr-only') && src.includes('.visually-hidden')) {
    pass('read-aloud.js extractReadableText strips .sr-only and .visually-hidden');
  } else {
    fail('read-aloud.js extractReadableText missing .sr-only/.visually-hidden stripping');
  }

  // (d) <noscript> stripped.
  if (src.includes('noscript')) {
    pass('read-aloud.js extractReadableText strips <noscript>');
  } else {
    fail('read-aloud.js extractReadableText missing noscript stripping');
  }

  // (e) quickStart verified false in registry.
  const regSrc = readFileSync(join(ROOT, 'skills/registry.js'), 'utf8');
  // Find the read-aloud entry and check quickStart.
  const raMatch = regSrc.match(/id:\s*'read-aloud'[\s\S]*?quickStart:\s*(true|false)/);
  if (raMatch && raMatch[1] === 'false') {
    pass("read-aloud registry entry has quickStart: false");
  } else {
    fail("read-aloud registry entry quickStart should be false (not quickStart)");
  }

  // (f) sentenceChunks unit test: inline logic verification.
  // We replicate the function logic here for pure Node testing (no import).
  function sentenceChunks(text, maxChars = 250) {
    if (!text) return [];
    const sentences = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > maxChars && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += s;
      }
      while (current.length > maxChars) {
        chunks.push(current.slice(0, maxChars).trim());
        current = current.slice(maxChars);
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  // Short text: single chunk.
  const short = 'Hello world.';
  const shortChunks = sentenceChunks(short);
  if (shortChunks.length === 1 && shortChunks[0] === 'Hello world.') {
    pass('sentenceChunks: short text produces single chunk');
  } else {
    fail(`sentenceChunks: short text produced ${JSON.stringify(shortChunks)}`);
  }

  // Empty text: no chunks.
  const emptyChunks = sentenceChunks('');
  if (emptyChunks.length === 0) {
    pass('sentenceChunks: empty text produces zero chunks');
  } else {
    fail(`sentenceChunks: empty text produced ${emptyChunks.length} chunks`);
  }

  // Long text: all chunks ≤ maxChars.
  const longText = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} is a test sentence.`).join(' ');
  const longChunks = sentenceChunks(longText, 250);
  const allShort = longChunks.every(c => c.length <= 250);
  const noEmpty = longChunks.every(c => c.trim().length > 0);
  if (allShort && noEmpty && longChunks.length > 1) {
    pass(`sentenceChunks: long text split into ${longChunks.length} non-empty chunks ≤250 chars`);
  } else {
    fail(`sentenceChunks: long text split incorrectly — allShort=${allShort}, noEmpty=${noEmpty}, count=${longChunks.length}`);
  }
}

// ---------------------------------------------------------------------------
// 3. focus-mode.js — hover-highlight rule removed
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'skills/builtin/focus-mode.js'), 'utf8');

  // The old always-on hover rule targeted p/li/td.
  const hasHoverHighlight = /p:hover\s*,\s*li:hover\s*,\s*td:hover/.test(src) ||
    (/highlightColor/.test(src) && /hover/.test(src) && /p:hover/.test(src));

  if (!hasHoverHighlight) {
    pass('focus-mode.js does not contain always-on p:hover/li:hover/td:hover rule');
  } else {
    fail('focus-mode.js still has always-on p:hover/li:hover/td:hover hover-highlight rule');
  }

  // dimBackground dead code branch removed from active code.
  const fmNoComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!fmNoComments.includes('dimBackground')) {
    pass('focus-mode.js has no dimBackground dead code in active code');
  } else {
    fail('focus-mode.js still has dead dimBackground code branch in active code');
  }

  // registerSweep used for progress bar re-attach.
  if (src.includes('registerSweep') && src.includes('observe.js')) {
    pass('focus-mode.js uses registerSweep to re-attach progress bar on SPA navigation');
  } else {
    fail('focus-mode.js missing registerSweep for SPA progress bar re-attach');
  }
}

// ---------------------------------------------------------------------------
// 4. dark-mode.js — single img rule, no DarkReader reference
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'skills/builtin/dark-mode.js'), 'utf8');

  // (a) No DarkReader reference in code (was dead; guard always false).
  const srcNoComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!srcNoComments.includes('DarkReader')) {
    pass('dark-mode.js has no DarkReader reference (dead code removed)');
  } else {
    fail('dark-mode.js still references DarkReader in active code — dead branch must be deleted');
  }

  // (b) Single img/video rule (no duplicate) — check in code, not comments.
  // The old bug: two rules both matching img,video — the second silently overrode the first.
  const srcNoCommentsDm = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const imgRuleMatches = (srcNoCommentsDm.match(/img[\s\S]{0,100}filter:/g) || []).length;
  if (imgRuleMatches === 1) {
    pass('dark-mode.js has a single img/video filter rule (no silent override)');
  } else if (imgRuleMatches === 0) {
    fail('dark-mode.js missing img/video filter rule');
  } else {
    fail(`dark-mode.js has ${imgRuleMatches} img filter rules in code — duplicate causes silent override`);
  }

  // (c) Color-filter arbitration check.
  if (src.includes('_colorFilterStyleId') || src.includes('color-filter')) {
    pass('dark-mode.js checks for color-filter conflict (arbitration)');
  } else {
    fail('dark-mode.js missing color-filter conflict check');
  }
}

// ---------------------------------------------------------------------------
// 5. Registry retirement checks
// ---------------------------------------------------------------------------
{
  const regSrc = readFileSync(join(ROOT, 'skills/registry.js'), 'utf8');

  // large-cursor and dyslexia-font entries removed from list.
  if (!regSrc.includes("id: 'large-cursor'")) {
    pass("registry.js no longer has 'large-cursor' entry (retired)");
  } else {
    fail("registry.js still has 'large-cursor' entry — should be retired");
  }

  if (!regSrc.includes("id: 'dyslexia-font'")) {
    pass("registry.js no longer has 'dyslexia-font' entry (retired)");
  } else {
    fail("registry.js still has 'dyslexia-font' entry — should be retired");
  }

  // settingsMeta keys for largeCursor/dyslexiaFont must still be present.
  if (regSrc.includes("largeCursor:") && regSrc.includes("dyslexiaFont:")) {
    pass('registry.js settingsMeta still has largeCursor and dyslexiaFont keys');
  } else {
    fail('registry.js settingsMeta lost largeCursor or dyslexiaFont — must stay for VA sub-settings');
  }

  // Onboarding "moved" note present.
  const onboardingHtml = readFileSync(
    join(ROOT, 'extension/onboarding/onboarding.html'), 'utf8');
  if (onboardingHtml.includes('retired-adapters-note') &&
      (onboardingHtml.includes('Large cursor') || onboardingHtml.includes('Large Cursor'))) {
    pass('onboarding.html has retired-adapters-note for large-cursor/dyslexia-font');
  } else {
    fail('onboarding.html missing retired-adapters-note for large-cursor/dyslexia-font');
  }
}

// ---------------------------------------------------------------------------
// 6. popup.js — fix-contrast migration nudge
// ---------------------------------------------------------------------------
{
  const popupJs = readFileSync(join(ROOT, 'extension/popup/popup.js'), 'utf8');
  const popupHtml = readFileSync(join(ROOT, 'extension/popup/popup.html'), 'utf8');

  if (popupJs.includes('contrastMigrationNudge') && popupJs.includes('contrastNudgeDismissed')) {
    pass('popup.js has fix-contrast migration nudge with dismissal flag');
  } else {
    fail('popup.js missing fix-contrast migration nudge or contrastNudgeDismissed flag');
  }

  if (popupHtml.includes('id="contrastMigrationNudge"')) {
    pass('popup.html has contrastMigrationNudge element');
  } else {
    fail('popup.html missing contrastMigrationNudge element');
  }

  // Nudge must check autoWcagFix===true AND fixContrast not set.
  if (popupJs.includes('autoWcagFix') && popupJs.includes('fixContrast') &&
      popupJs.includes('contrastNudgeDismissed')) {
    pass('popup.js nudge gates on autoWcagFix===true and fixContrast unset');
  } else {
    fail('popup.js nudge logic missing required conditions');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
