// Registry parity — the adapter barrel and the tools registry agree, as a test.
//
// Adding an adapter touches three places: the adapter file, one export line in
// the barrel (tools/adapters/index.js), and one entry in the registry
// (toolkit/registry/tools.js). Nothing checked the seam between the last two.
// A barrel module with no registry entry is a working adapter that no
// profile, skill, or chat command can reach, because those only ever name
// registry ids. A registry entry that reaches no barrel module lets the
// Engineer author a skill naming an adapter that does not exist. Either one
// goes unnoticed until someone tries it on a page.
//
// How an entry "names" an adapter is not a field. A registry entry carries
// `settings` keys (`{ darkMode: true }`), a skill resolves to those keys
// (toolkit/core/skill.js resolveSkill), and a host maps a key to an adapter.
// The catalog's own statement of that mapping is getEnabledAdapters() in
// tools/profiles/settings.js, which turns setting keys into barrel module
// names, and docs/FOLLOW-UPS.md already treats it as the reachability rule.
// So this test follows the same path: registry entry -> its settings keys ->
// getEnabledAdapters -> module names -> the barrel. It does not re-derive the
// mapping by id spelling, because `auto-alt-text` reaches `generate-alt` and
// `color-filter` reaches `color-blind` only through that rule.
//
// Both directions are compared as sets, in the style of
// adapter-conformance-test.js, and the barrel is read the same way it is
// there. A module or entry that appears on one side only fails here by name.
//
// Run: node tools/test/registry-parity-test.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { skillRegistry } from '../../toolkit/registry/tools.js';
import { profiles, getEnabledAdapters } from '../profiles/settings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS = path.join(HERE, '..', 'adapters');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// ── what the barrel exports ────────────────────────────────────────────────
// Same rule as adapter-conformance-test.js: only `export ... from './x.js'`
// lines count. The barrel also plain-imports modules for their axe handlers,
// and those are not exports.
const barrelSrc = readFileSync(path.join(ADAPTERS, 'index.js'), 'utf8');
const MODULES = [...new Set(
  [...barrelSrc.matchAll(/^export\s[^;]*?from\s+'\.\/([^']+)\.js'/gm)].map((m) => m[1]),
)];
check(`the barrel exports from at least one module (found ${MODULES.length})`, MODULES.length > 0);

// ── what the registry lists ────────────────────────────────────────────────
const IDS = skillRegistry.map((e) => e.id);
check(`the registry has at least one entry (found ${IDS.length})`, IDS.length > 0);
check('every registry id is unique', new Set(IDS).size === IDS.length);

// ── the rule: settings keys -> module names ────────────────────────────────
// getEnabledAdapters() reads a profile by id from the profiles table, so the
// entry's settings are lent to it as a throwaway profile and removed again.
// This reuses the real rule rather than copying it here, where it would drift.
function modulesReachedBy(entry) {
  const key = '__registry-parity-probe__';
  profiles[key] = { tools: entry.settings || {} };
  try { return getEnabledAdapters(key); } finally { delete profiles[key]; }
}

// Barrel modules that no registry entry reaches, for a reason written down.
// FLAG(review): prefer this list empty. Each name here is a real adapter a
// person cannot switch on through a profile or a skill today.
const KNOWN_UNREACHABLE = [
  // Both hosts (the extension's content script and cli/cli-tools.js) enable
  // AutoTranscriber on `autoCaptions`, but the catalog rule maps that key to
  // `generate-captions`, so under the rule nothing reaches this module.
  // docs/FOLLOW-UPS.md leaves the decision open: wire it to `autoCaptions`
  // or drop it from the catalog. Listed here so the test does not decide.
  'auto-transcriber',
];

const reached = new Set();
for (const entry of skillRegistry) {
  const mods = modulesReachedBy(entry);
  const inBarrel = mods.filter((m) => MODULES.includes(m));
  const notInBarrel = mods.filter((m) => !MODULES.includes(m));
  check(`registry entry ${entry.id} reaches at least one barrel module (settings: ${Object.keys(entry.settings || {}).join(', ') || 'none'})`, inBarrel.length > 0);
  check(`registry entry ${entry.id}: the rule names only modules the barrel exports${notInBarrel.length ? ` (not exported: ${notInBarrel.join(', ')})` : ''}`, notInBarrel.length === 0);
  for (const m of inBarrel) reached.add(m);
}

// ── the other direction: every barrel module is reachable ──────────────────
const unreachable = MODULES.filter((m) => !reached.has(m));
const unexplained = unreachable.filter((m) => !KNOWN_UNREACHABLE.includes(m));
check(`every barrel module is reached by a registry entry or listed as known${unexplained.length ? ` (unreachable: ${unexplained.join(', ')})` : ''}`, unexplained.length === 0);

// The known list is a ratchet: it may shrink, and it must not name modules
// that are no longer in the barrel or that a registry entry now reaches.
const staleKnown = KNOWN_UNREACHABLE.filter((m) => !MODULES.includes(m));
check(`the known-unreachable list names only barrel modules${staleKnown.length ? ` (stale: ${staleKnown.join(', ')})` : ''}`, staleKnown.length === 0);
const nowReached = KNOWN_UNREACHABLE.filter((m) => reached.has(m));
check(`the known-unreachable list names only modules still unreached${nowReached.length ? ` (now reached, remove: ${nowReached.join(', ')})` : ''}`, nowReached.length === 0);

console.log(`\nRegistry parity: ${pass} passed, ${fail} failed (${MODULES.length} barrel modules, ${IDS.length} registry entries, ${reached.size} modules reached, ${unreachable.length} unreached)`);
if (fail) process.exit(1);
