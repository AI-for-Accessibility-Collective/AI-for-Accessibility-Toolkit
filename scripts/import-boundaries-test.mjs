// Import-boundary test: every relative import that crosses a package root is
// checked against the four rules in CONTRIBUTING.md ("Package boundaries").
//
//   1. No relative import reaches past another package's public exports.
//   2. A cross-package import is a dependency the importing package declares.
//   3. The dependency graph stays acyclic.
//   4. A new edge gets called out in review.
//
// Run from the repository root:  node scripts/import-boundaries-test.mjs
// It is also part of `npm test`.
//
// How it works. The test walks the six package directories, skips tests,
// bundles and node_modules, and parses five import forms from every .js,
// .mjs and .cjs file: `import ... from '...'`, `export ... from '...'`,
// `import('...')` with a string specifier, the bare side-effect
// `import '...'`, and `require('...')`. Only relative specifiers that
// resolve outside the importing file's package root count as edges. Each edge
// then has to pass:
//
//   - direction:  the importer's package lists the target in ALLOWED (rule 2,
//                 and half of rule 1: there is no such thing as an edge that
//                 is fine as long as it lands on a public file);
//   - acyclic:    both the ALLOWED table and the observed graph have no cycle
//                 (rule 3);
//   - public:     the resolved file is one the target package's exports map
//                 exposes (rule 1). Packages without an exports map get the
//                 declared fallback in publicSurfaceOf() below;
//   - snapshot:   the edge is in KNOWN_EDGES with a one-line reason (rule 4).
//                 A new edge fails until someone adds it here, which is what
//                 a reviewer checks against. A stale entry fails too, so the
//                 list cannot drift from the code.
//
// Rule 2 without npm workspaces. None of these packages installs another one
// through package.json today (server/package.json has an empty dependencies
// block; controller/ and cli/ have no manifest at all), so "declares" cannot
// mean a dependencies entry yet. Until workspaces land, the declaration is
// the ALLOWED table below plus the KNOWN_EDGES entry. See CONTRIBUTING.md.
//
// This is a static check on relative specifiers. It does not see imports
// that go through a URL path a server mounts (onboarding/chat.js loads the
// controller from /controller/lib/ that way) or through a bundler alias.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Rules ──────────────────────────────────────────────────────────────────

// Who may import whom. Keys are importing packages, values are the targets
// they may reach. toolkit/ and tools/ import from no sibling: the core knows
// nothing about the parts around it, and the catalog stands alone.
// onboarding -> controller is listed because onboarding/server.js serves the
// controller's modules at /controller/lib and onboarding/chat.js imports them
// by URL (see the comment above TOOLKIT_DIR in onboarding/server.js); the
// static scan cannot see that edge, but the direction is real.
const ALLOWED = {
  toolkit: [],
  tools: [],
  server: ['toolkit', 'tools'],
  controller: ['toolkit', 'tools'],
  onboarding: ['toolkit', 'tools', 'server', 'controller'],
  cli: ['toolkit', 'tools'],
};
const PACKAGES = Object.keys(ALLOWED);

// Rule 4: the current edge list, importer file -> resolved targets, with one
// line on why the edge exists. Adding an import that crosses a package root
// means adding it here, in the same change, so review sees it.
const KNOWN_EDGES = {
  'server/src/toolkit-host.js': {
    to: ['toolkit/index.js', 'toolkit/platforms/node/ports.js', 'toolkit/registry/tools.js'],
    why: 'the hosted service embeds the core over the node reference ports and hands it the registry',
  },
  'server/src/meta.js': {
    to: ['toolkit/index.js', 'toolkit/platforms/node/kv.js'],
    why: 'the /v1/meta payload and server/API.md are introspected from a real librarian built on an in-memory KV',
  },
  'controller/grammar.js': {
    to: ['toolkit/registry/tools.js'],
    why: 'the grammar is built from the registry settings vocabulary',
  },
  'controller/llm-lane.js': {
    to: ['toolkit/registry/tools.js'],
    why: 'the LLM lane grounds its prompt in the same settings vocabulary',
  },
  'controller/router.js': {
    to: ['toolkit/registry/tools.js'],
    why: 'the router clamps values to the registry ranges',
  },
  'onboarding/server.js': {
    to: ['server/src/auth.js', 'server/src/gemini.js', 'server/src/store.js', 'server/src/toolkit-host.js'],
    why: 'onboarding reuses the service auth, LLM caller, store and toolkit host instead of copying them',
  },
  'cli/cli-tools.js': {
    to: [
      'tools/adapters/abbreviation-expand.js',
      'tools/adapters/auto-transcriber.js',
      'tools/adapters/big-targets.js',
      'tools/adapters/bionic-reading.js',
      'tools/adapters/color-blind.js',
      'tools/adapters/confirm-actions.js',
      'tools/adapters/dark-mode.js',
      'tools/adapters/define-words.js',
      'tools/adapters/describe-on-demand.js',
      'tools/adapters/dismiss-overlays.js',
      'tools/adapters/explore-a-chart.js',
      'tools/adapters/fix-landmarks.js',
      'tools/adapters/flash-guard.js',
      'tools/adapters/focus-locator.js',
      'tools/adapters/focus-mode.js',
      'tools/adapters/index.js',
      'tools/adapters/keyboard-nav.js',
      'tools/adapters/language-tag.js',
      'tools/adapters/link-highlighter.js',
      'tools/adapters/live-region-announcer.js',
      'tools/adapters/magnifier.js',
      'tools/adapters/math-a11y.js',
      'tools/adapters/motion-reducer.js',
      'tools/adapters/mute-sounds.js',
      'tools/adapters/page-outline.js',
      'tools/adapters/persistent-hover.js',
      'tools/adapters/read-aloud.js',
      'tools/adapters/reader-mode.js',
      'tools/adapters/reading-ruler.js',
      'tools/adapters/reading-spot.js',
      'tools/adapters/reduce-brightness.js',
      'tools/adapters/reflow-column.js',
      'tools/adapters/show-captions.js',
      'tools/adapters/simplify-text.js',
      'tools/adapters/skip-links.js',
      'tools/adapters/sound-visualizer.js',
      'tools/adapters/spa-focus.js',
      'tools/adapters/stop-auto-advance.js',
      'tools/adapters/translate-page.js',
      'tools/adapters/unpin-sticky.js',
      'tools/adapters/visual-assist.js',
      'tools/adapters/voice-commands.js',
      'tools/adapters/wcag-fixes.js',
      'tools/auditors/missing-alt.js',
      'tools/auditors/missing-captions.js',
      'tools/auditors/missing-labels.js',
      'tools/auditors/missing-landmarks.js',
      'tools/auditors/poor-contrast.js',
      'tools/auditors/wcag-issues.js',
      'tools/profiles/settings.js',
      'tools/utils/ai.js',
    ],
    why: 'the CLI bundles the catalog into the page it drives; esbuild resolves these at build time',
  },
};

// Known breaks of rule 1: edges that land on a file the target's exports map
// does not expose. Kept apart from KNOWN_EDGES on purpose: an entry here is a
// debt with a reason, not a declaration. Each entry names the importer, the
// target path, and why it is tolerated for now. Empty means every edge lands
// on a public file.
const KNOWN_BREAKS = [];

// ── Public surface per package ─────────────────────────────────────────────

// FLAG(review): what "public" means for a package without an exports map is a
// choice this test makes, not something Node decides for us:
//   - a package.json with an exports map (toolkit, tools): the map, exactly;
//   - a package.json without one (server, onboarding): Node treats every file
//     as reachable, so this test does too;
//   - no package.json (controller, cli): the .js files at the directory root.
// No relative import reaches controller or cli today, so the third rule only
// matters for a future edge; note that onboarding/chat.js already reaches
// controller/web/*.js and controller/transport/*.js by URL path, which this
// rule would not admit, so the choice is open. The second rule means rule 1
// checks nothing for the server until it gains an exports map.
function publicSurfaceOf(pkg) {
  const manifest = path.join(ROOT, pkg, 'package.json');
  if (!existsSync(manifest)) {
    return { kind: 'root-files', ok: (rel) => /^[^/]+\.js$/.test(rel) };
  }
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!json.exports) return { kind: 'no-exports-map', ok: () => true };
  // The map is read the way Node reads it. A file is public when some
  // subpath resolves to it. For one subpath Node takes an exact key first,
  // else the pattern key with the longest prefix before '*' (the longest
  // whole key on a tie), and a null target on the key it picked blocks the
  // subpath even when another key would have matched. Every string under a
  // key counts as a target here: a plain string, a conditional object
  // ({ import: ..., default: ... }) or a fallback array. That is a superset
  // of what one Node condition set would hand out, which errs toward
  // calling a file public.
  const map = typeof json.exports === 'string' ? { '.': json.exports } : json.exports;
  const strip = (p) => p.replace(/^\.\//, '');
  const strings = (v) => typeof v === 'string' ? [v]
    : Array.isArray(v) ? v.flatMap(strings)
    : v && typeof v === 'object' ? Object.values(v).flatMap(strings)
    : [];
  // Node's key selection for one subpath, or null when no key matches.
  const keyFor = (subpath) => {
    if (Object.hasOwn(map, subpath) && !subpath.includes('*')) return subpath;
    let best = null;
    for (const key of Object.keys(map)) {
      const star = key.indexOf('*');
      if (star === -1 || key.lastIndexOf('*') !== star) continue;
      if (!subpath.startsWith(key.slice(0, star)) || subpath.length < key.length || !subpath.endsWith(key.slice(star + 1))) continue;
      if (best === null || star > best.indexOf('*') || (star === best.indexOf('*') && key.length > best.length)) best = key;
    }
    return best;
  };
  // The files one subpath hands out; empty when the key it lands on is null.
  const filesFor = (subpath) => {
    const key = keyFor(subpath);
    if (key === null || map[key] === null) return [];
    const star = key.indexOf('*');
    const captured = star === -1 ? '' : subpath.slice(star, subpath.length - (key.length - star - 1));
    return strings(map[key]).map((t) => strip(t.replaceAll('*', captured)));
  };
  // The subpaths whose own key names a file: the candidates to resolve.
  const subpathsFor = (rel) => {
    const out = [];
    for (const [key, value] of Object.entries(map)) {
      for (const t of strings(value).map(strip)) {
        const star = t.indexOf('*');
        if (star === -1) { if (t === rel) out.push(key); continue; }
        const prefix = t.slice(0, star), suffix = t.slice(star + 1);
        if (key.includes('*') && rel.startsWith(prefix) && rel.endsWith(suffix) && rel.length > prefix.length + suffix.length) {
          out.push(key.replace('*', rel.slice(prefix.length, rel.length - suffix.length)));
        }
      }
    }
    return out;
  };
  return {
    kind: 'exports-map',
    ok: (rel) => subpathsFor(rel).some((subpath) => filesFor(subpath).includes(rel)),
  };
}

// ── Scan ───────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__']);
const SOURCE_EXT = /\.(m?js|cjs)$/;
const SKIP_FILE = /\.(bundle|min)\.js$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (SOURCE_EXT.test(name) && !SKIP_FILE.test(name)) {
      yield full;
    }
  }
}

// FLAG(review): this is a regular expression pass, not a parser, so a
// specifier inside a string or a comment reads as an import
// (toolkit/scripts/generate-api-docs.mjs carries the README quick start as
// text and is the live example; its specifiers stay inside toolkit/, so no
// edge comes of it). Only comments that open at the start of a line are
// removed, so a block comment that opens after code on the same line is kept
// and its text can produce a phantom edge too. A phantom edge shows up as an
// unknown edge and someone looks at it.
//
// Stripping is not enough on its own. A "/*" that opens at the start of a line
// inside a string and is not closed there (toolkit/core/librarian.js has "/*"
// inside prompt strings) makes the stripper run to the next "*/" further down
// the file, and any import in between would disappear from the scan, which is
// the failure this test must not have. So specifiers are collected twice, once
// from the file as written and once from the stripped text, and the two sets
// are merged. A comment can still add a phantom edge, which fails loud, but
// comment stripping can no longer hide a real one. What the regexes themselves
// cannot see (a computed specifier, one built from a variable) is still
// invisible, the same as before.
function stripComments(src) {
  return src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
}

// Specifiers from the import forms these packages can use: `import ... from`,
// `export ... from`, `import('...')`, the bare side-effect `import '...'`, and
// `require('...')`, which a .cjs file would use and the walk picks .cjs files
// up. `from` is matched on its own so multi-line `import { a, b } from '...'`
// blocks are found too. The specifier itself may not span a line: a stray
// `from "` in prose would otherwise match up to the next quote in the file and
// could eat a real import.
const FROM_RE = /\bfrom\s*['"]([^'"\n]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const BARE_RE = /^\s*import\s*['"]([^'"\n]+)['"]/gm;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function specifiersIn(src) {
  const out = new Set();
  for (const text of [src, stripComments(src)]) {
    for (const re of [FROM_RE, DYNAMIC_RE, BARE_RE, REQUIRE_RE]) {
      for (const m of text.matchAll(re)) out.add(m[1]);
    }
  }
  return [...out];
}

// Paths are kept with '/' so they compare with KNOWN_EDGES on any OS.
const posix = (p) => p.split(path.sep).join('/');

const edges = []; // { from, fromPkg, to, toPkg, rel }
let filesScanned = 0;
for (const pkg of PACKAGES) {
  const pkgDir = path.join(ROOT, pkg);
  for (const file of walk(pkgDir)) {
    filesScanned++;
    const from = posix(path.relative(ROOT, file));
    for (const spec of specifiersIn(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const to = posix(path.relative(ROOT, path.resolve(path.dirname(file), spec)));
      const toPkg = to.split('/')[0];
      if (toPkg === pkg) continue;
      edges.push({ from, fromPkg: pkg, to, toPkg, rel: to.split('/').slice(1).join('/') });
    }
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, offenders) {
  if (offenders.length === 0) { pass++; console.log('PASS:', name); return; }
  fail++;
  console.log('FAIL:', name);
  for (const o of offenders) console.log('  -', o);
}

console.log(`scanned ${filesScanned} files, found ${edges.length} cross-package imports in ${new Set(edges.map((e) => e.from)).size} files`);

// direction
check('every edge points in a direction ALLOWED lists',
  edges.filter((e) => !PACKAGES.includes(e.toPkg) || !ALLOWED[e.fromPkg].includes(e.toPkg))
    .map((e) => `${e.from} -> ${e.to} (${e.fromPkg} may not import from ${e.toPkg})`));

// acyclic, on the rule table and on the observed graph
function findCycle(graph) {
  const state = new Map();
  const stack = [];
  function visit(n) {
    if (state.get(n) === 'done') return null;
    if (state.get(n) === 'active') return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 'active'); stack.push(n);
    for (const m of graph[n] || []) { const c = visit(m); if (c) return c; }
    stack.pop(); state.set(n, 'done');
    return null;
  }
  for (const n of Object.keys(graph)) { const c = visit(n); if (c) return c; }
  return null;
}
const observed = {};
for (const e of edges) (observed[e.fromPkg] ||= new Set()).add(e.toPkg);
const observedGraph = Object.fromEntries(Object.entries(observed).map(([k, v]) => [k, [...v]]));
const tableCycle = findCycle(ALLOWED);
check('the ALLOWED table is acyclic', tableCycle ? [tableCycle.join(' -> ')] : []);
const graphCycle = findCycle(observedGraph);
check('the observed import graph is acyclic', graphCycle ? [graphCycle.join(' -> ')] : []);

// public surface
const surfaces = Object.fromEntries(PACKAGES.map((p) => [p, publicSurfaceOf(p)]));
const isKnownBreak = (e) => KNOWN_BREAKS.some((b) => b.from === e.from && b.to === e.to);
check('every edge lands on a file the target package exposes (or is a listed break)',
  edges.filter((e) => surfaces[e.toPkg] && !surfaces[e.toPkg].ok(e.rel) && !isKnownBreak(e))
    .map((e) => `${e.from} -> ${e.to} (not in ${e.toPkg}'s ${surfaces[e.toPkg].kind})`));
check('every listed break is still a break (else remove it from KNOWN_BREAKS)',
  KNOWN_BREAKS.filter((b) => {
    const e = edges.find((x) => x.from === b.from && x.to === b.to);
    return !e || !surfaces[e.toPkg] || surfaces[e.toPkg].ok(e.rel);
  }).map((b) => `${b.from} -> ${b.to}`));

// snapshot
const known = new Set();
for (const [from, { to }] of Object.entries(KNOWN_EDGES)) for (const t of to) known.add(`${from} -> ${t}`);
const seen = new Set(edges.map((e) => `${e.from} -> ${e.to}`));
check('every edge is in KNOWN_EDGES (a new edge needs a reason there, and a mention in review)',
  [...seen].filter((k) => !known.has(k)).sort());
check('every KNOWN_EDGES entry still exists (else remove it)',
  [...known].filter((k) => !seen.has(k)).sort());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
