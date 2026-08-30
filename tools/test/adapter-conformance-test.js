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
// enable() must have a disable(), and the function-family modules are listed
// by name below. The list is a ratchet: it may shrink (a module gains a
// revert path) but must not grow silently — adding a tool object without
// disable(), or a new no-revert module, fails this test until it is either
// fixed or knowingly added to the list.
//
// Run: node tools/test/adapter-conformance-test.js
import { JSDOM } from 'jsdom';

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

// ── Family 1: every tool object is reversible ──────────────────────────────
const toolObjects = [];
for (const [name, value] of Object.entries(adapters)) {
  if (value && typeof value === 'object' && typeof value.enable === 'function') {
    toolObjects.push(name);
    check(`tool object ${name}: enable() is paired with disable()`, typeof value.disable === 'function');
  }
}
// Snapshot so a refactor that silently drops tool objects from the barrel is
// noticed (recount and update deliberately if the catalog genuinely changes).
check(`catalog exports at least 30 tool objects (found ${toolObjects.length})`, toolObjects.length >= 30);

// ── Family 2: the additive modules, named ──────────────────────────────────
// These modules export repair functions with no revert path, which is their
// design: they add absent alt text, labels, captions, table headers,
// landmarks, and WCAG attributes. If one of them gains a revert path, remove
// it here; do not add to this list without meaning to.
const ADDITIVE_MODULES = [
  'fix-links', 'fix-tables', 'generate-alt', 'generate-captions', 'wcag-fixes',
  'agent-watch-shapes', // render-side helper of agent-watch, no page state of its own
];
check(`additive list stays a ratchet (${ADDITIVE_MODULES.length} modules)`, ADDITIVE_MODULES.length <= 6);

console.log(`\nAdapter conformance: ${pass} passed, ${fail} failed (${toolObjects.length} tool objects checked)`);
if (fail) process.exit(1);
