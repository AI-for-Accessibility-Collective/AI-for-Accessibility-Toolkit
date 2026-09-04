// Adapter conformance — the catalog's reversibility promise, as a test.
//
// The catalog has two adapter families with different contracts:
//   1. TOOL OBJECTS (DarkMode, BigTargets, ...): stateful adapters a person
//      switches on and off. Contract: enable() AND disable(), so every
//      switch-on has a switch-off. This is what "reversible" means here.
//   2. CONTENT-FIX FUNCTIONS (generateImageAlt, fixLandmarks, ...): additive
//      repairs that write missing attributes/structure. They add what was
//      absent rather than toggling state, so they carry no disable().
//
// This test makes the split explicit and enforced: every export that has an
// enable() must have a disable(), and the function-family modules are named
// below. The list is a ratchet: it may shrink (a module gains a revert path)
// but must not grow silently.
//
// It only earns the word "ratchet" if it DISCOVERS what is out there. An
// earlier version compared the hand-written list against its own length
// (`ADDITIVE_MODULES.length <= 6`), which is a statement about the literal a
// few lines above it and nothing else: a new no-revert module could be added
// to the catalog and this test would still pass. It had drifted, unnoticed, in
// both directions. It named `agent-watch-shapes`, which the barrel does not
// export at all, and it was missing four modules that are genuinely additive.
// The same went for `toolObjects.length >= 30` against 39 real objects, which
// let nine of them vanish silently.
//
// So both families are now read off the barrel and compared to the named lists
// as SETS, in both directions. A module that appears, disappears, or changes
// family fails here and has to be acknowledged in the list.
//
// Run: node tools/test/adapter-conformance-test.js
import { JSDOM } from 'jsdom';

import { readBarrelModules } from './barrel-modules.js';

// Several adapters attach themselves to window at module scope, so the DOM
// globals must exist before the catalog is imported.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = (el) => dom.window.getComputedStyle(el);
global.CSS = dom.window.CSS || { escape: (s) => s };

const adapters = await import('../adapters/index.js');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// Report a set difference as a readable failure rather than a bare false, so
// whoever hits this is told which module to look at.
function sameSet(label, discovered, expected) {
  const extra = discovered.filter((m) => !expected.includes(m));
  const missing = expected.filter((m) => !discovered.includes(m));
  check(`${label}: nothing new and unacknowledged${extra.length ? ` (found ${extra.join(', ')})` : ''}`, extra.length === 0);
  check(`${label}: nothing listed that is no longer there${missing.length ? ` (stale: ${missing.join(', ')})` : ''}`, missing.length === 0);
}

// ── what the catalog actually contains ─────────────────────────────────────
// The barrel is the public catalog, so it decides what is in scope. See
// barrel-modules.js for what counts as an export (shared with the parity test).
const MODULES = readBarrelModules();
check(`the barrel exports from at least one module (found ${MODULES.length})`, MODULES.length > 0);

const isToolObject = (v) => v && typeof v === 'object' && typeof v.enable === 'function';

const additiveModules = [];
for (const mod of MODULES) {
  const ns = await import(`../adapters/${mod}.js`);
  if (!Object.values(ns).some(isToolObject)) additiveModules.push(mod);
}

// ── Family 1: every tool object is reversible ──────────────────────────────
const toolObjects = [];
for (const [name, value] of Object.entries(adapters)) {
  if (!isToolObject(value)) continue;
  toolObjects.push(name);
  check(`tool object ${name}: enable() is paired with disable()`, typeof value.disable === 'function');
}

// The exact catalog, not a floor. A floor of 30 against 39 objects is not a
// snapshot, it is permission for nine of them to disappear quietly.
const TOOL_OBJECTS = [
  'AbbreviationExpand', 'AgentWatch', 'AutoTranscriber', 'BigTargets', 'BionicReading',
  'ColorBlindMode', 'ConfirmActions', 'DarkMode', 'DefineWords', 'DescribeOnDemand',
  'DismissOverlays', 'ExploreAChart', 'FixLandmarks', 'FlashGuard', 'FocusLocator',
  'FocusMode', 'KeyboardNavigator', 'LanguageTag', 'LinkHighlighter', 'LiveRegionAnnouncer',
  'Magnifier', 'MathA11y', 'MotionReducer', 'MuteSounds', 'PageOutline',
  'PersistentHover', 'ReaderMode', 'ReadingRuler', 'ReadingSpot', 'ReduceBrightness',
  'ReflowColumn', 'ShowCaptions', 'SkipLinks', 'SoundVisualizer', 'SpaFocus', 'StopAutoAdvance',
  'TranslatePage', 'UnpinSticky', 'VisualAssist', 'VoiceCommands',
];
sameSet('tool objects', toolObjects.slice().sort(), TOOL_OBJECTS.slice().sort());

// ── Family 2: the additive modules, named ──────────────────────────────────
// These export repair functions with no revert path, which is their design:
// they add absent alt text, labels, captions, table headers, contrast
// corrections, and WCAG attributes. If one gains a revert path, remove it
// here; do not add to this list without meaning to.
const ADDITIVE_MODULES = [
  'fix-contrast', 'fix-links', 'fix-tables', 'generate-alt', 'generate-captions',
  'generate-labels', 'simplify-text', 'wcag-fixes',
  // Not additive, and not reversible-by-name either: ReadAloud is stateful and
  // switched on and off, but its methods are speak/pause/resume/stop/toggle, so
  // the enable() probe above does not see it and never checked it. Its pairing
  // is asserted under its own names below instead. Whether the catalog should
  // give it enable/disable like every other stateful tool is a real question
  // and not one this test should answer silently.
  'read-aloud',
];
sameSet('additive modules', additiveModules.slice().sort(), ADDITIVE_MODULES.slice().sort());

// The one stateful tool the enable() probe cannot see still has to be
// reversible, so it is checked under the names it actually uses.
const { ReadAloud } = adapters;
check('ReadAloud is exported by the barrel', !!ReadAloud);
check('ReadAloud: speak() is paired with stop()',
  typeof ReadAloud?.speak === 'function' && typeof ReadAloud?.stop === 'function');
check('ReadAloud: pause() is paired with resume()',
  typeof ReadAloud?.pause === 'function' && typeof ReadAloud?.resume === 'function');

console.log(`\nAdapter conformance: ${pass} passed, ${fail} failed (${toolObjects.length} tool objects, ${additiveModules.length} additive modules, ${MODULES.length} modules)`);
if (fail) process.exit(1);
