// toolkit/test/api-docs-test.js — conformance tests for the generated docs
// (toolkit/API.md, .claude/skills/ai4a11y-toolkit/SKILL.md):
//
//   (a) every method in the introspected model actually exists and is
//       callable on a LIVE createToolkit(...) instance (independent of the
//       one buildModel() itself constructs).
//   (b) API.md and SKILL.md on disk are byte-identical to a fresh
//       regeneration from the SAME model — catches drift where the files
//       were hand-edited or a generator changed without re-running `npm run
//       docs`.
//   (c) the Quick Start code block extracted from API.md (between the
//       QUICKSTART:START/END markers) actually runs: written to a temp .mjs
//       under toolkit/ (so its relative imports resolve) and executed with
//       node, expecting exit 0.
//   (d) every `librarian*` case string in
//       personalized-extension/extension/background.js's message switch
//       maps — after the general camelCase rule + the named exceptions
//       server/CONTRACT.md's route map must apply — to a method actually
//       present in the model, proving the docs cover the whole extension
//       surface.
//
//   (e) every scoped package specifier printed in API.md, SKILL.md and
//       toolkit/index.js's header equals toolkit/package.json's `name`.
//       Check (b) cannot see this: it compares a file against a fresh render
//       from the SAME generator, so a wrong literal in the generator matches
//       itself and passes. That is how `@a11y-toolkit/core` survived.
//   (f) the README's own Quick Start block runs from the repo root and
//       produces the output its comments advertise. (c) covers API.md and
//       SKILL.md only, which is why the README's version could promise a
//       fontScale it never computed.
//
//   node toolkit/test/api-docs-test.js

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { createToolkit } from '../index.js';
import { memoryKV } from '../platforms/node/kv.js';
import { buildModel } from '../scripts/introspect.mjs';
import { renderApiMd } from '../scripts/generate-api-docs.mjs';
import { renderSkillMd } from '../scripts/generate-skill.mjs';
import { PACKAGE_NAME } from '../scripts/generate-api-docs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(TOOLKIT_ROOT, '..');
const API_MD_PATH = path.join(TOOLKIT_ROOT, 'API.md');
const SKILL_MD_PATH = path.join(REPO_ROOT, '.claude', 'skills', 'ai4a11y-toolkit', 'SKILL.md');
const BACKGROUND_JS_PATH = path.join(REPO_ROOT, 'personalized-extension', 'extension', 'background.js');
const INDEX_JS_PATH = path.join(TOOLKIT_ROOT, 'index.js');
const README_PATH = path.join(REPO_ROOT, 'README.md');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

const model = await buildModel();

// ============================================================================
// (a) every method in the model exists + is callable on a live instance
// ============================================================================
{
  const { datastore, librarian } = createToolkit({ kv: memoryKV() });
  const owners = { librarian, datastore };
  const notCallable = [];
  for (const m of model.methods) {
    let obj = owners[m.owner];
    for (const part of m.name.split('.')) obj = obj == null ? obj : obj[part];
    if (typeof obj !== 'function') notCallable.push(`${m.owner}.${m.name}`);
  }
  if (notCallable.length) console.log('  not callable:', notCallable.join(', '));
  check(
    `every method in the model (${model.methods.length}) exists and is callable on a fresh createToolkit instance`,
    model.methods.length > 0 && notCallable.length === 0,
  );
}

// ============================================================================
// (b) API.md / SKILL.md on disk are byte-identical to a fresh regeneration
// ============================================================================
{
  const freshApiMd = renderApiMd(model);
  const onDiskApiMd = existsSync(API_MD_PATH) ? readFileSync(API_MD_PATH, 'utf8') : null;
  check('toolkit/API.md on disk is byte-identical to a freshly regenerated model', onDiskApiMd === freshApiMd);

  const freshSkillMd = renderSkillMd(model);
  const onDiskSkillMd = existsSync(SKILL_MD_PATH) ? readFileSync(SKILL_MD_PATH, 'utf8') : null;
  check('.claude/skills/ai4a11y-toolkit/SKILL.md on disk is byte-identical to a freshly regenerated model', onDiskSkillMd === freshSkillMd);
}

// ============================================================================
// (c) the Quick Start code block extracted from API.md actually runs
// ============================================================================
{
  let extracted = null;
  if (existsSync(API_MD_PATH)) {
    const apiMd = readFileSync(API_MD_PATH, 'utf8');
    const startMarker = '<!-- QUICKSTART:START -->';
    const endMarker = '<!-- QUICKSTART:END -->';
    const startIdx = apiMd.indexOf(startMarker);
    const endIdx = apiMd.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const block = apiMd.slice(startIdx + startMarker.length, endIdx);
      const fenceMatch = block.match(/```javascript\n([\s\S]*?)```/);
      extracted = fenceMatch ? fenceMatch[1] : null;
    }
  }
  check('Quick Start code block was found between QUICKSTART markers in API.md', !!extracted);

  if (extracted) {
    // Written INSIDE toolkit/ (not os.tmpdir()) so the snippet's relative
    // imports ('./index.js', './platforms/node/kv.js', ...) resolve exactly
    // as documented.
    const tmpPath = path.join(TOOLKIT_ROOT, '.quickstart-check.tmp.mjs');
    writeFileSync(tmpPath, extracted, 'utf8');
    let ok = false;
    let detail = '';
    try {
      const out = execFileSync(process.execPath, [tmpPath], { cwd: TOOLKIT_ROOT, encoding: 'utf8' });
      ok = out.includes('Quick Start OK');
      detail = ok ? '' : `ran but did not print "Quick Start OK": ${out}`;
    } catch (e) {
      detail = (e.stderr || e.message || String(e)).toString().split('\n')[0];
    } finally {
      try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    }
    check(`the extracted Quick Start snippet runs to exit 0${detail ? ` (${detail})` : ''}`, ok);
  }
}

// ============================================================================
// (d) every librarian* case in background.js maps to a method in the model
// ============================================================================
// Skipped when no Chrome extension is present in the repo (core-only checkout):
// this cross-checks a web HOST's message switch against the model, which only
// applies where a host ships alongside the toolkit.
if (!existsSync(BACKGROUND_JS_PATH)) {
  console.log('(d) skipped — no extension host in this repo (core-only)');
} else {
  const bg = readFileSync(BACKGROUND_JS_PATH, 'utf8');
  const caseNames = [...new Set([...bg.matchAll(/case '(librarian[A-Za-z0-9]+)'/g)].map((m) => m[1]))];

  // General rule (server/CONTRACT.md, "## /v1/librarian/{method}"): strip the
  // `librarian` prefix, lower-case the new first letter.
  function generalRuleTarget(caseName) {
    const stripped = caseName.slice('librarian'.length);
    return stripped.charAt(0).toLowerCase() + stripped.slice(1);
  }

  // Named exceptions to the general rule. CONTRACT.md documents exactly ONE
  // by example (librarianEffectivePreferences -> getEffectivePreferences,
  // "alias table in the server route map"); the rest are read directly off
  // what background.js's switch actually invokes on `L` (the Librarian
  // instance) — ground truth for what that alias table must contain to be
  // correct. `librarianSetPause` branches on `msg.origin` between two real
  // Librarian methods, so both are listed as acceptable targets.
  const ALIASES = {
    librarianEffectivePreferences: ['getEffectivePreferences'],
    librarianSetSiteCategory: ['setSiteCategoryOverride'],
    librarianSetPause: ['setOriginPaused', 'setMemoryPaused'],
    librarianExtractNow: ['extract'],
    librarianReflectNow: ['reflect'],
    librarianFindSkill: ['findSkillForNeed'],
  };

  // Exempt from this check: routed to something OTHER than a Librarian
  // method call, so it cannot "map to a method present in the [librarian]
  // model" by construction. librarianShareAudit calls
  // Grants.getShareAudit(dsGetter) directly (see background.js) — it never
  // calls L.<anything>.
  const EXEMPT = new Set(['librarianShareAudit']);

  const librarianMethodNames = new Set(model.methods.filter((m) => m.owner === 'librarian').map((m) => m.name));

  const gaps = [];
  for (const caseName of caseNames) {
    if (EXEMPT.has(caseName)) continue;
    const candidates = ALIASES[caseName] || [generalRuleTarget(caseName)];
    if (!candidates.some((c) => librarianMethodNames.has(c))) {
      gaps.push(`${caseName} -> tried [${candidates.join(', ')}]`);
    }
  }
  if (gaps.length) console.log('  uncovered case strings:', gaps.join('; '));
  check(
    `every librarian* case in background.js (${caseNames.length} found, ${EXEMPT.size} exempt) maps to a method present in the model`,
    caseNames.length > 0 && gaps.length === 0,
  );
}

// ============================================================================
// (e) every scoped package specifier we print equals package.json's name
// ============================================================================
// The one class of error check (b) is blind to. It compares a generated file
// against a fresh render from the same generator, so a hardcoded name that is
// wrong is wrong identically on both sides and the comparison passes. The
// generators now derive PACKAGE_NAME from toolkit/package.json; this keeps
// anyone from writing a literal back in, and covers toolkit/index.js's header
// comment too, which no generator produces.
{
  const SPECIFIER = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/g;
  const wrong = [];
  let scanned = 0;
  for (const [label, file] of [
    ['toolkit/API.md', API_MD_PATH],
    ['.claude/skills/ai4a11y-toolkit/SKILL.md', SKILL_MD_PATH],
    ['toolkit/index.js', INDEX_JS_PATH],
  ]) {
    if (!existsSync(file)) { wrong.push(`${label} is missing`); continue; }
    const found = [...new Set(readFileSync(file, 'utf8').match(SPECIFIER) || [])];
    scanned += found.length;
    for (const name of found) if (name !== PACKAGE_NAME) wrong.push(`${label} says ${name}`);
  }
  if (wrong.length) console.log('  wrong package name:', wrong.join('; '));
  // scanned > 0 keeps this from passing vacuously if the mentions ever move.
  check(
    `every package specifier in the docs and the barrel header is ${PACKAGE_NAME} (${scanned} found)`,
    scanned > 0 && wrong.length === 0,
  );
}

// ============================================================================
// (f) the README's Quick Start runs and produces what its comments claim
// ============================================================================
// (c) does this for API.md and SKILL.md, which is why their Quick Start was
// right. Nothing did it for the README, which is why the README's version
// annotated renderWebSettings(model) with `{ fontScale: 140, ... }` while
// writing no textSize need, so it actually returned {}. The assertions live
// here rather than in the README so the front page stays readable: this
// appends them to whatever the README currently shows.
//
// What this does NOT catch: a surface renderer tolerant of the wrong argument.
// renderXRSettings(null, ...) still returns a well-shaped object, so swapping
// `model` for `null` in the README passes here. It catches the failure that
// actually happened (an advertised output the block does not produce) and a
// render call that goes missing.
{
  let extracted = null;
  if (existsSync(README_PATH)) {
    const readme = readFileSync(README_PATH, 'utf8');
    const startMarker = '<!-- QUICKSTART:START -->';
    const endMarker = '<!-- QUICKSTART:END -->';
    const startIdx = readme.indexOf(startMarker);
    const endIdx = readme.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const fence = readme.slice(startIdx + startMarker.length, endIdx).match(/```javascript\n([\s\S]*?)```/);
      extracted = fence ? fence[1] : null;
    }
  }
  check('Quick Start code block was found between QUICKSTART markers in README.md', !!extracted);

  if (extracted) {
    // Bind the README's OWN render calls rather than making fresh ones, so
    // the assertions below are about the arguments the README actually shows.
    // If either rewrite fails to match, the check fails instead of quietly
    // testing nothing.
    let bound = extracted.replace(
      /^(\s*)renderWebSettings\(/m, '$1const __web = renderWebSettings(',
    );
    const boundWeb = bound !== extracted;
    const beforeXr = bound;
    bound = bound.replace(/^(\s*)renderXRSettings\(/m, '$1const __xr = renderXRSettings(');
    const boundXr = bound !== beforeXr;
    check('the README Quick Start calls both surface renderers, so they can be checked', boundWeb && boundXr);

    // The README's imports are written from the repository root
    // ('./toolkit/index.js'), so the snippet has to run from there.
    const probe = [
      bound,
      "if (__web.fontScale !== 140) {",
      "  throw new Error('README Quick Start: renderWebSettings returned ' + JSON.stringify(__web)",
      "    + ', but the block advertises { fontScale: 140, ... }');",
      "}",
      "if (typeof __xr?.text?.angularSizeDeg !== 'number') {",
      "  throw new Error('README Quick Start: renderXRSettings returned ' + JSON.stringify(__xr)",
      "    + ', but the block advertises { text: { angularSizeDeg, ... }, ... }');",
      "}",
      "console.log('README Quick Start OK');",
      '',
    ].join('\n');
    const tmpPath = path.join(REPO_ROOT, '.readme-quickstart-check.tmp.mjs');
    writeFileSync(tmpPath, probe, 'utf8');
    let ok = false;
    let detail = '';
    try {
      const out = execFileSync(process.execPath, [tmpPath], { cwd: REPO_ROOT, encoding: 'utf8' });
      ok = out.includes('README Quick Start OK');
      detail = ok ? '' : `ran but did not print "README Quick Start OK": ${out}`;
    } catch (e) {
      // Report the thrown message, not the last line of the stack (which is
      // the node version banner).
      const text = (e.stderr || e.message || String(e)).toString();
      const line = text.split('\n').find((l) => /^\s*(Error|[A-Za-z]*Error):/.test(l));
      detail = (line || text.split('\n').find(Boolean) || 'failed').trim();
    } finally {
      try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    }
    check(`the README Quick Start runs and renders what it advertises${detail ? ` (${detail})` : ''}`, ok);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
