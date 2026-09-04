// Registry parity: the adapter barrel and the tools registry agree, as a test.
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
// The catalog's own statement of that mapping is adaptersForTools() in
// tools/profiles/settings.js, which turns setting keys into barrel module
// names, and docs/FOLLOW-UPS.md already treats it as the reachability rule.
// So this test follows that statement: registry entry -> its settings keys ->
// adaptersForTools -> module names -> the barrel. It does not re-derive the
// mapping by id spelling, because `auto-alt-text` reaches `generate-alt` and
// `color-filter` reaches `color-blind` only through that rule.
//
// Each key is also probed on its own. An entry with several keys must not
// pass on the strength of one while another names an adapter the rule does
// not know; that is the shape a contributor copies from `focus-mode` or
// `visual-assist`, and it is the one case a whole-entry check lets through.
//
// What this proves, and what it does not. Each host keeps its own copy of the
// key-to-adapter mapping (applyProfileByName in cli/cli-tools.js, and the
// extension's content script) and neither calls adaptersForTools when it
// applies a profile. So a green run here means the barrel, the registry, and
// the catalog's declared mapping agree. It does not check that a host acts on
// every key the registry names; the FLAG(review) notes in adaptersForTools
// record where the hosts and the catalog still differ.
//
// Both directions are compared as sets, in the style of
// adapter-conformance-test.js, and the barrel is read through the same helper.
// A module or entry that appears on one side only fails here by name.
//
// Run: node tools/test/registry-parity-test.js
import { skillRegistry } from '../../toolkit/registry/tools.js';
import { adaptersForTools } from '../profiles/settings.js';
import { readBarrelModules } from './barrel-modules.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// Same shape as sameSet in adapter-conformance-test.js: a set difference
// reported as two readable failures that name the module to look at.
function sameSet(label, discovered, expected) {
  const extra = discovered.filter((m) => !expected.includes(m));
  const missing = expected.filter((m) => !discovered.includes(m));
  check(`${label}: nothing new and unacknowledged${extra.length ? ` (found ${extra.join(', ')})` : ''}`, extra.length === 0);
  check(`${label}: nothing listed that is no longer there${missing.length ? ` (stale or now reached, remove: ${missing.join(', ')})` : ''}`, missing.length === 0);
}

// ── what the barrel exports ────────────────────────────────────────────────
const MODULES = readBarrelModules();
check(`the barrel exports from at least one module (found ${MODULES.length})`, MODULES.length > 0);

// ── what the registry lists ────────────────────────────────────────────────
const IDS = skillRegistry.map((e) => e.id);
check('every registry id is unique', new Set(IDS).size === IDS.length);

// ── registry -> barrel ─────────────────────────────────────────────────────
// Keys that only shape a parent key's adapter and reach nothing on their own.
// The extension hands these two to FocusMode.enable() under focusMode, and
// the CLI ignores them, so neither host switches anything on for them alone.
const SUB_SETTINGS = ['hideDistractions', 'showProgress'];

const reached = new Set();
const entriesReachingNothing = [];
const keysReachingNothing = [];
const notExported = new Set();
for (const entry of skillRegistry) {
  const settings = entry.settings || {};
  const mods = adaptersForTools(settings);
  if (!mods.some((m) => MODULES.includes(m))) entriesReachingNothing.push(entry.id);
  for (const m of mods) (MODULES.includes(m) ? reached : notExported).add(m);
  for (const [key, value] of Object.entries(settings)) {
    if (SUB_SETTINGS.includes(key)) continue;
    if (adaptersForTools({ [key]: value }).length === 0) keysReachingNothing.push(`${entry.id}.${key}`);
  }
}
check(`every registry entry reaches a barrel module${entriesReachingNothing.length ? ` (reaches none: ${entriesReachingNothing.join(', ')})` : ''}`, entriesReachingNothing.length === 0);
check(`every registry settings key reaches a module on its own${keysReachingNothing.length ? ` (unmapped: ${keysReachingNothing.join(', ')})` : ''}`, keysReachingNothing.length === 0);
check(`the rule names only modules the barrel exports${notExported.size ? ` (not exported: ${[...notExported].join(', ')})` : ''}`, notExported.size === 0);

// ── barrel -> registry ─────────────────────────────────────────────────────
// Barrel modules that no registry entry reaches, for a reason written down.
// The list may only shrink: a name here that leaves the barrel or that a
// registry entry now reaches fails below.
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

const unreachable = MODULES.filter((m) => !reached.has(m)).sort();
sameSet('unreached barrel modules', unreachable, KNOWN_UNREACHABLE.slice().sort());

console.log(`\nRegistry parity: ${pass} passed, ${fail} failed (${MODULES.length} barrel modules, ${IDS.length} registry entries, ${reached.size} modules reached, ${unreachable.length} unreached)`);
if (fail) process.exit(1);
