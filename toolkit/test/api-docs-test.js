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
//   node toolkit/test/api-docs-test.js

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { createToolkit } from '../index.js';
import { memoryKV } from '../adapters/node/kv.js';
import { buildModel } from '../scripts/introspect.mjs';
import { renderApiMd } from '../scripts/generate-api-docs.mjs';
import { renderSkillMd } from '../scripts/generate-skill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(TOOLKIT_ROOT, '..');
const API_MD_PATH = path.join(TOOLKIT_ROOT, 'API.md');
const SKILL_MD_PATH = path.join(REPO_ROOT, '.claude', 'skills', 'ai4a11y-toolkit', 'SKILL.md');
const BACKGROUND_JS_PATH = path.join(REPO_ROOT, 'personalized-extension', 'extension', 'background.js');

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
    // imports ('./index.js', './adapters/node/kv.js', ...) resolve exactly
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
