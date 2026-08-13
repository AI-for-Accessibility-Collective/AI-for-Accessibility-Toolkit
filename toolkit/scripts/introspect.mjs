#!/usr/bin/env node
// toolkit/scripts/introspect.mjs — the single source of truth for everything
// documentation-shaped about the toolkit's public surface.
//
// Combines two techniques, on purpose:
//   1. RUNTIME introspection — boots a real `createToolkit(...)` against an
//      in-memory kv and reads the actual constructed librarian/datastore
//      objects (Object.keys, typeof, Function#toString). This is what
//      guarantees the model can never describe a method that isn't really
//      callable, and that async-ness/params reflect the real function, not
//      a hand-copied signature that can drift from the code.
//   2. STATIC source parsing — ONLY to (a) pull the doc-comment sentence
//      that already exists directly above a method definition (never to
//      invent one — a method with no adjacent comment gets a
//      '(no doc comment)' marker, verbatim, nothing more), and (b) read
//      structured JSDoc @typedef/@property blocks (ports), export
//      statements (surfaces, barrel), and JSON Schema files (protocol).
//
// Run directly to print the JSON model:
//   node toolkit/scripts/introspect.mjs
// Or import { buildModel } for a generator to consume.
//
// Deterministic: no timestamps, no Math.random, no Set/Map iteration order
// dependency — every list is built in source order.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createToolkit } from '../index.js';
import { memoryKV } from '../adapters/node/kv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..'); // toolkit/

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => readFileSync(p, 'utf8');

// ============================================================================
// small text/source helpers
// ============================================================================

// Abbreviations whose internal/trailing period must not read as a sentence
// boundary (source prose here uses "e.g." / "i.e." freely). Matched against
// the run of letters/periods immediately preceding a candidate boundary.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'approx']);

/** Mechanical first-sentence extraction: scan for a `.`/`!`/`?` immediately
 *  followed by whitespace or end-of-string, skipping past known abbreviations
 *  (so "a reader app (e.g. ArtInsight) that..." doesn't end at "e.g."). No
 *  invention — if no sentence boundary is found, the whole text is returned
 *  as-is. */
function firstSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const after = t[i + 1];
    if (after !== undefined && after !== ' ') continue; // mid-word (e.g. "librarian.importInsightOutbox")
    if (ch === '.') {
      const wordMatch = t.slice(0, i).match(/([A-Za-z]+(?:\.[A-Za-z]+)*)$/);
      const word = wordMatch ? wordMatch[1].toLowerCase() : '';
      if (ABBREVIATIONS.has(word)) continue; // "e.g." / "i.e." / "etc." / "vs." / "approx." — not a real boundary
    }
    return t.slice(0, i + 1);
  }
  return t;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index of the char in `str` matching the opening bracket at `openIdx`
 *  (any of `([{`), skipping nested pairs. Returns -1 if unbalanced. */
function matchingClose(str, openIdx) {
  const open = str[openIdx];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `str` on top-level occurrences of `sep` (not inside ([{ }]) ). */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function topLevelIndexOf(str, ch) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ch && depth === 0) return i;
  }
  return -1;
}

// ============================================================================
// runtime function introspection
// ============================================================================

function isAsyncFn(fn) {
  return !!(fn && fn.constructor && fn.constructor.name === 'AsyncFunction');
}

function paramNames(fn) {
  const src = Function.prototype.toString.call(fn);
  const open = src.indexOf('(');
  if (open === -1) return [];
  const close = matchingClose(src, open);
  if (close === -1) return [];
  const paramsSrc = src.slice(open + 1, close);
  if (!paramsSrc.trim()) return [];
  return splitTopLevel(paramsSrc, ',').map((p) => {
    p = p.trim();
    const eq = topLevelIndexOf(p, '=');
    const name = (eq === -1 ? p : p.slice(0, eq)).trim();
    return name;
  }).filter(Boolean);
}

/** The static parameter list of an object-literal method's OWN definition
 *  line (`name(...) {` / `async name(...) {`), single-line only (true for
 *  every method in these two files). Used as a fallback when the runtime
 *  function is a generic `(...args) =>` wrapper (see the slow-lane-gate loop
 *  at the bottom of librarian.js) — the wrapper's real signature IS
 *  `(...args)`, but the original named params are far more useful in docs,
 *  so a wrapped method's static params win when the runtime ones are just
 *  a rest param. */
function paramsFromObjectMethodSource(sourceLines, methodName) {
  const defRe = new RegExp(`^(async\\s+)?${escapeRe(methodName)}\\s*\\(`);
  for (const line of sourceLines) {
    const t = line.trim();
    if (!defRe.test(t)) continue;
    const open = t.indexOf('(');
    const close = matchingClose(t, open);
    if (close === -1) return null;
    const paramsSrc = t.slice(open + 1, close);
    if (!paramsSrc.trim()) return [];
    return splitTopLevel(paramsSrc, ',').map((p) => {
      p = p.trim();
      const eq = topLevelIndexOf(p, '=');
      return (eq === -1 ? p : p.slice(0, eq)).trim();
    }).filter(Boolean);
  }
  return null;
}

// A "====== SECTION TITLE ======" or "---- section title ----" banner line
// (this codebase uses both) — decoration, not prose. Directly adjacent to
// several methods with no blank-line separator, so it must be filtered out
// of a collected doc-comment rather than treated as the start of its
// description.
function isBannerLine(line) {
  return /^={4,}.*={4,}$/.test(line) || /^-{4,}.*-{4,}$/.test(line);
}

/** Find the doc-comment (contiguous `//` lines, no blank gap) directly above
 *  an object-literal method definition `name(...) {` or `async name(...) {`
 *  in `sourceLines`. Returns the first-sentence string, or null if there is
 *  no adjacent comment (caller emits the '(no doc comment)' marker). */
function docAboveObjectMethod(sourceLines, methodName) {
  const defRe = new RegExp(`^(async\\s+)?${escapeRe(methodName)}\\s*\\(`);
  let defIdx = -1;
  for (let i = 0; i < sourceLines.length; i++) {
    if (defRe.test(sourceLines[i].trim())) { defIdx = i; break; }
  }
  if (defIdx === -1) return null;
  const commentLines = [];
  let i = defIdx - 1;
  while (i >= 0) {
    const line = sourceLines[i].trim();
    if (line.startsWith('//')) {
      const stripped = line.replace(/^\/\/\s?/, '');
      if (!isBannerLine(stripped)) commentLines.unshift(stripped);
      i--;
    } else break;
  }
  if (!commentLines.length) return null;
  return firstSentence(commentLines.join(' '));
}

/** Same idea, for a top-level `export function name(` / `export default
 *  function name(` declaration (used for surfaces/*.js). Handles BOTH a
 *  contiguous `//` line-comment block and a directly-adjacent `/** *\/`
 *  JSDoc block. A JSDoc block here typically carries only `@param`/`@returns`
 *  (no free-text lead sentence) — in that case the `@returns` text is used
 *  as the description (still mechanically extracted, never invented). */
function docAboveExportFunction(sourceLines, methodName) {
  const defRe = new RegExp(`^export\\s+(default\\s+)?(async\\s+)?function\\s+${escapeRe(methodName)}\\s*\\(`);
  let defIdx = -1;
  for (let i = 0; i < sourceLines.length; i++) {
    if (defRe.test(sourceLines[i].trim())) { defIdx = i; break; }
  }
  if (defIdx === -1) return null;

  // Case 1: a /** ... */ block ends on the line directly above.
  if (defIdx - 1 >= 0 && sourceLines[defIdx - 1].trim() === '*/') {
    let j = defIdx - 2;
    while (j >= 0 && sourceLines[j].trim() !== '/**') j--;
    if (j >= 0) {
      const blockText = sourceLines.slice(j + 1, defIdx - 1)
        .map((l) => l.replace(/^[ \t]*\*[ \t]?/, ''))
        .join('\n');
      const firstTagAt = blockText.search(/@\w+/);
      const pretext = firstTagAt === -1 ? blockText : blockText.slice(0, firstTagAt);
      const pretextSentence = firstSentence(pretext);
      if (pretextSentence) return pretextSentence;
      const returnsMatch = blockText.match(/@returns?\s*(?:\{[^}]*\})?\s*([\s\S]*?)(?=\n\s*@\w+|$)/);
      if (returnsMatch) return firstSentence(returnsMatch[1]);
      return null;
    }
  }

  // Case 2: contiguous `//` lines directly above.
  const commentLines = [];
  let i = defIdx - 1;
  while (i >= 0) {
    const line = sourceLines[i].trim();
    if (line.startsWith('//')) { commentLines.unshift(line.replace(/^\/\/\s?/, '')); i--; }
    else break;
  }
  if (!commentLines.length) return null;
  return firstSentence(commentLines.join(' '));
}

// ============================================================================
// 1. METHODS — librarian + datastore, grouped by concern
// ============================================================================

// Deliberate curatorial map (not extracted from source — concern grouping is
// an editorial decision, unlike descriptions, which are never invented here).
// Keyed `${owner}:${dotted-name}`. Anything constructed at runtime that is
// NOT in this map still appears in the model, under 'uncategorized', so a
// method added later without updating this map is visible (not silently
// dropped) — see the generator's console warning.
const CONCERN_MAP = {
  // ---- profile / ability ----
  'librarian:getProfile': 'profile/ability',
  'librarian:setProfileField': 'profile/ability',
  'librarian:getAbilityModel': 'profile/ability',
  'librarian:interpretNeedsPrompt': 'profile/ability',
  'librarian:getSiteCategory': 'profile/ability',
  'librarian:setSiteCategoryOverride': 'profile/ability',
  'librarian:getEffectivePreferences': 'profile/ability',
  'librarian:recordExplicitSetting': 'profile/ability',
  'librarian:recordScopedSettings': 'profile/ability',
  'librarian:hasScopedSetting': 'profile/ability',
  'librarian:getScopedSetting': 'profile/ability',
  'librarian:removeScopedSetting': 'profile/ability',

  // ---- memory ----
  'librarian:recall': 'memory',
  'librarian:listMemories': 'memory',
  'librarian:deleteMemory': 'memory',
  'librarian:logObservation': 'memory',
  'librarian:extract': 'memory',
  'librarian:reflect': 'memory',
  'librarian:listProcedural': 'memory',

  // ---- proposals / consent ----
  'librarian:listProposals': 'proposals/consent',
  'librarian:respondToProposal': 'proposals/consent',

  // ---- skills ----
  'librarian:listSkills': 'skills',
  'librarian:retrieveSkill': 'skills',
  'librarian:findSkillForNeed': 'skills',
  'librarian:resolveSkill': 'skills',
  'librarian:buildSkill': 'skills',
  'librarian:saveSkill': 'skills',
  'librarian:deleteSkill': 'skills',

  // ---- grants / sharing ----
  'librarian:requestGrant': 'grants/sharing',
  'librarian:listGrants': 'grants/sharing',
  'librarian:revokeGrant': 'grants/sharing',
  'librarian:exportAbilityModel': 'grants/sharing',
  'librarian:importInsight': 'grants/sharing',
  'librarian:importInsightOutbox': 'grants/sharing',
  'librarian:setSharingPaused': 'grants/sharing',

  // ---- blob / transport ----
  'librarian:exportProfileBlob': 'blob/transport',
  'librarian:importProfileBlob': 'blob/transport',

  // ---- acting-user / pauses ----
  'librarian:setActingUser': 'acting-user/pauses',
  'librarian:getActingUser': 'acting-user/pauses',
  'librarian:setMemoryPaused': 'acting-user/pauses',
  'librarian:setOriginPaused': 'acting-user/pauses',
  'datastore:setActingUser': 'acting-user/pauses',
  'datastore:getActingUser': 'acting-user/pauses',

  // ---- core / wiring (infra that doesn't fit the 7 named concerns) ----
  'librarian:setGeminiCaller': 'core',
  'datastore:catalog': 'core',
  'datastore:get': 'core',
  'datastore:set': 'core',
  'datastore:patch': 'core',
  'datastore:memoryShardKey': 'core',
  'datastore:getMemoryShard': 'core',
  'datastore:setMemoryShard': 'core',
  'datastore:allMemoryShards': 'core',
  'datastore:runMigrations': 'core',
  'datastore:global.tools': 'core',
  'datastore:global.taxonomy': 'core',
  'datastore:global.skills': 'core',
};

// Stable display order for concern groups (independent of map iteration).
const CONCERN_ORDER = [
  'profile/ability', 'memory', 'proposals/consent', 'skills',
  'grants/sharing', 'blob/transport', 'acting-user/pauses', 'core', 'uncategorized',
];

function collectMethods(obj, sourceLines, ownerLabel, { maxDepth = 1 } = {}) {
  const out = [];
  (function walk(node, prefix, depth) {
    for (const key of Object.keys(node)) {
      if (key.startsWith('_')) continue; // underscore-prefixed = private by convention
      const val = node[key];
      const dotted = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'function') {
        const doc = docAboveObjectMethod(sourceLines, key);
        let params = paramNames(val);
        if (params.length === 1 && params[0].startsWith('...')) {
          // Generic rest-arg wrapper (the slow-lane drain gate) — prefer the
          // original definition's named params when we can find them.
          const staticParams = paramsFromObjectMethodSource(sourceLines, key);
          if (staticParams) params = staticParams;
        }
        out.push({
          owner: ownerLabel,
          name: dotted,
          params,
          async: isAsyncFn(val),
          description: doc, // null => renderer prints '(no doc comment)'
          concern: CONCERN_MAP[`${ownerLabel}:${dotted}`] || 'uncategorized',
        });
      } else if (val && typeof val === 'object' && !Array.isArray(val) && depth < maxDepth) {
        walk(val, dotted, depth + 1);
      }
    }
  })(obj, '', 0);
  return out;
}

function buildMethodModel() {
  const { datastore, librarian } = createToolkit({ kv: memoryKV() });
  const librarianSrc = read(path.join(ROOT, 'core', 'librarian.js')).split('\n');
  const datastoreSrc = read(path.join(ROOT, 'core', 'datastore.js')).split('\n');

  const methods = [
    ...collectMethods(librarian, librarianSrc, 'librarian'),
    ...collectMethods(datastore, datastoreSrc, 'datastore'),
  ];

  const uncategorized = methods.filter((m) => m.concern === 'uncategorized');
  if (uncategorized.length) {
    // Visible, not silent: a method the CONCERN_MAP hasn't caught up with yet.
    console.warn(
      `[introspect] ${uncategorized.length} method(s) not in CONCERN_MAP (shown under "uncategorized"): `
      + uncategorized.map((m) => `${m.owner}:${m.name}`).join(', '),
    );
  }

  const groups = CONCERN_ORDER
    .map((concern) => ({ concern, methods: methods.filter((m) => m.concern === concern) }))
    .filter((g) => g.methods.length);

  return { methods, groups };
}

// ============================================================================
// 2. PORTS — JSDoc @typedef blocks in ports/index.js + ports/actuation.js
// ============================================================================

// Which typedefs are "a host implements this" ports, vs. supporting data
// shapes referenced by one (e.g. ActuationPort's result types). A fixed,
// small classification — the files only ever define these two kinds.
const PORT_TYPEDEFS = new Set(['KVStore', 'Clock', 'Scheduler', 'Consent', 'DemoHook', 'Sensors', 'ActuationPort']);

function extractBalancedBraces(text, openIdx) {
  const close = matchingClose(text, openIdx);
  if (close === -1) return { content: text.slice(openIdx + 1), end: text.length };
  return { content: text.slice(openIdx + 1, close), end: close };
}

function parseJsDocTypedefs(source) {
  const blocks = [...source.matchAll(/\/\*\*([\s\S]*?)\*\//g)].map((m) => m[1]);
  const typedefs = [];
  for (const raw of blocks) {
    const deStarred = raw.split('\n').map((l) => l.replace(/^[ \t]*\*[ \t]?/, '')).join('\n');
    const typedefMatch = deStarred.match(/@typedef\s*\{[^}]*\}\s*(\S+)/);
    if (!typedefMatch) continue;
    const name = typedefMatch[1];
    const afterTypedef = deStarred.slice(typedefMatch.index + typedefMatch[0].length);
    const firstPropIdx = afterTypedef.indexOf('@property');
    const descText = firstPropIdx === -1 ? afterTypedef : afterTypedef.slice(0, firstPropIdx);
    const description = firstSentence(descText);

    const properties = [];
    let cursor = 0;
    while (true) {
      const pIdx = afterTypedef.indexOf('@property', cursor);
      if (pIdx === -1) break;
      const braceIdx = afterTypedef.indexOf('{', pIdx);
      const { content: type, end } = extractBalancedBraces(afterTypedef, braceIdx);
      const nextPropIdx = afterTypedef.indexOf('@property', end + 1);
      const rest = afterTypedef.slice(end + 1, nextPropIdx === -1 ? undefined : nextPropIdx);
      const nameMatch = rest.match(/^\s*(\[?[\w.]+\]?)/);
      const rawName = nameMatch ? nameMatch[1] : '(unnamed)';
      const optional = rawName.startsWith('[');
      const propName = rawName.replace(/^\[|\]$/g, '');
      const propDescText = nameMatch ? rest.slice(nameMatch[0].length) : rest;
      properties.push({ name: propName, optional, type: type.trim(), description: firstSentence(propDescText) });
      cursor = nextPropIdx === -1 ? afterTypedef.length : nextPropIdx;
      if (nextPropIdx === -1) break;
    }
    typedefs.push({ name, kind: PORT_TYPEDEFS.has(name) ? 'port' : 'type', description, properties });
  }
  return typedefs;
}

function buildPortsModel() {
  const files = [
    { file: 'ports/index.js', source: read(path.join(ROOT, 'ports', 'index.js')) },
    { file: 'ports/actuation.js', source: read(path.join(ROOT, 'ports', 'actuation.js')) },
  ];
  const typedefs = [];
  const defaults = [];
  for (const { file, source } of files) {
    for (const t of parseJsDocTypedefs(source)) typedefs.push({ ...t, file });
    for (const m of source.matchAll(/^export const (\w+) =/gm)) defaults.push({ name: m[1], file });
  }
  return { typedefs, defaults };
}

// ============================================================================
// 3. SURFACES — surfaces/*.js exports (input is always the needs AbilityModel)
// ============================================================================

async function buildSurfacesModel() {
  const dir = path.join(ROOT, 'surfaces');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const surfaces = [];
  for (const f of files) {
    const abs = path.join(dir, f);
    const source = read(abs);
    const lines = source.split('\n');
    const mod = await import(pathToFileURL(abs).href);
    // Module namespace object keys enumerate in lexicographic order (spec),
    // so 'default' can appear BEFORE a named export it merely re-points to —
    // decide named-vs-default up front by identity, not by processing order.
    const namedKeys = Object.keys(mod).filter((k) => k !== 'default' && typeof mod[k] === 'function');
    for (const key of namedKeys) {
      const val = mod[key];
      surfaces.push({
        module: `surfaces/${f}`,
        name: key,
        kind: 'named',
        params: paramNames(val),
        async: isAsyncFn(val),
        description: docAboveExportFunction(lines, key),
        input: 'needs AbilityModel (librarian.getAbilityModel() shape — see core/ability.js)',
      });
    }
    if (typeof mod.default === 'function' && !namedKeys.some((k) => mod[k] === mod.default)) {
      const val = mod.default;
      const exportedName = val.name || '(default)';
      surfaces.push({
        module: `surfaces/${f}`,
        name: exportedName,
        kind: 'default',
        params: paramNames(val),
        async: isAsyncFn(val),
        description: docAboveExportFunction(lines, exportedName),
        input: 'needs AbilityModel (librarian.getAbilityModel() shape — see core/ability.js)',
      });
    }
  }
  return surfaces;
}

// ============================================================================
// 4. PROTOCOL — toolkit/protocol/*.schema.json
// ============================================================================

function buildProtocolModel() {
  const dir = path.join(ROOT, 'protocol');
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  return files.map((f) => {
    const schema = JSON.parse(read(path.join(dir, f)));
    const kindConst = schema.properties && schema.properties.kind && schema.properties.kind.const;
    const versionConst = schema.properties && schema.properties.v && schema.properties.v.const;
    return {
      file: `protocol/${f}`,
      title: schema.title || null,
      description: firstSentence(schema.description),
      required: schema.required || [],
      kind: kindConst ?? null,
      version: versionConst ?? null,
    };
  });
}

// ============================================================================
// 5. BARREL EXPORTS — toolkit/index.js export statements
// ============================================================================

function buildBarrelModel() {
  const source = read(path.join(ROOT, 'index.js'));
  const exportsList = [];

  // export function NAME(
  for (const m of source.matchAll(/^export\s+(async\s+)?function\s+(\w+)/gm)) {
    exportsList.push({ name: m[2], kind: 'function', from: 'index.js' });
  }
  // export default NAME;
  const defaultMatch = source.match(/^export default (\w+);/m);
  if (defaultMatch) exportsList.push({ name: defaultMatch[1], kind: 'default', from: 'index.js' });

  // export { a, b as c, ... } from './path.js';  (possibly multi-line)
  for (const m of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/g)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const asMatch = n.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) exportsList.push({ name: asMatch[2], kind: 're-export', from: m[2], originalName: asMatch[1] });
      else exportsList.push({ name: n, kind: 're-export', from: m[2] });
    }
  }
  // export * from './path.js';  -- expand ports/index.js's own `export const`
  // names so the barrel table is concrete, not just "everything from ports".
  for (const m of source.matchAll(/export\s*\*\s*from\s*'([^']+)';/g)) {
    const target = path.join(ROOT, m[1]);
    let expanded = [];
    try {
      const targetSrc = read(target);
      expanded = [...targetSrc.matchAll(/^export const (\w+) =/gm)].map((mm) => mm[1]);
    } catch { /* leave expanded empty if unreadable */ }
    if (expanded.length) {
      for (const n of expanded) exportsList.push({ name: n, kind: 'star-re-export', from: m[1] });
    } else {
      exportsList.push({ name: '*', kind: 'star-re-export', from: m[1] });
    }
  }
  return exportsList;
}

// ============================================================================
// assemble + CLI
// ============================================================================

export async function buildModel() {
  const { methods, groups } = buildMethodModel();
  const ports = buildPortsModel();
  const surfaces = await buildSurfacesModel();
  const protocol = buildProtocolModel();
  const barrelExports = buildBarrelModel();
  return {
    generatedBy: 'toolkit/scripts/introspect.mjs',
    methods,
    methodGroups: groups,
    ports,
    surfaces,
    protocol,
    barrelExports,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const model = await buildModel();
  process.stdout.write(JSON.stringify(model, null, 2) + '\n');
}
