// wcag-test.mjs — unit tests for wcag-fixes.js (BCP-47 validator, tiers,
// inverse-descriptor generation).
// Run: node test/wcag-test.mjs

import { isValidBcp47, SAFE_FIXERS, RISKY_FIXERS } from '../skills/builtin/wcag-fixes.js';
import { VALID_ARIA_ROLES, VALID_ARIA_ATTRS } from '../utils/constants.js';

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS:', name);
  } else {
    fail++;
    console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : '');
  }
}

// ---------------------------------------------------------------------------
// 1. BCP-47 structural validator
// ---------------------------------------------------------------------------

// Valid tags — must return true (never rewritten)
check('bcp47 valid: en',        isValidBcp47('en'));
check('bcp47 valid: pt-BR',     isValidBcp47('pt-BR'));
check('bcp47 valid: zh-Hant',   isValidBcp47('zh-Hant'));
check('bcp47 valid: sr-Cyrl-RS',isValidBcp47('sr-Cyrl-RS'));
check('bcp47 valid: fa',        isValidBcp47('fa'));
check('bcp47 valid: zh',        isValidBcp47('zh'));
check('bcp47 valid: en-US',     isValidBcp47('en-US'));
check('bcp47 valid: he',        isValidBcp47('he'));

// Invalid tags — must return false
check('bcp47 invalid: empty string',  !isValidBcp47(''));
check('bcp47 invalid: null',          !isValidBcp47(null));
check('bcp47 invalid: undefined',     !isValidBcp47(undefined));
check('bcp47 invalid: "english"',     !isValidBcp47('english'));   // >3 alpha primary
check('bcp47 invalid: en_US',         !isValidBcp47('en_US'));     // underscore separator
check('bcp47 invalid: 123',           !isValidBcp47('123'));       // numeric primary
check('bcp47 invalid: "-en"',         !isValidBcp47('-en'));       // leading hyphen
check('bcp47 invalid: "en-"',         !isValidBcp47('en-'));       // trailing hyphen (empty subtag)

// ---------------------------------------------------------------------------
// 2. Tiering table — safe vs risky lists
// ---------------------------------------------------------------------------

const EXPECTED_SAFE = [
  'fixDuplicateId', 'fixTargetBlank', 'replaceObsoleteElement', 'fixViewportMeta',
  'fixPositiveTabindex', 'fixMissingLang', 'fixInvalidLang', 'fixDeprecatedRole',
];
const EXPECTED_RISKY = [
  'fixHeadingOrder', 'fixInvalidAriaAttr', 'fixInvalidAriaRole',
  'fixNestedInteractive', 'fixTargetSize',
];

check('safe tier has 8 fixers', SAFE_FIXERS.length === 8, SAFE_FIXERS);
check('risky tier has 5 fixers', RISKY_FIXERS.length === 5, RISKY_FIXERS);

for (const name of EXPECTED_SAFE) {
  check(`safe tier includes ${name}`, SAFE_FIXERS.includes(name));
}
for (const name of EXPECTED_RISKY) {
  check(`risky tier includes ${name}`, RISKY_FIXERS.includes(name));
}

// Deleted fixers must not appear in either tier
check('fixMissingAriaAttrs not in safe tier',  !SAFE_FIXERS.includes('fixMissingAriaAttrs'));
check('fixMissingAriaAttrs not in risky tier', !RISKY_FIXERS.includes('fixMissingAriaAttrs'));
check('removeMetaRefresh not in safe tier',    !SAFE_FIXERS.includes('removeMetaRefresh'));
check('removeMetaRefresh not in risky tier',   !RISKY_FIXERS.includes('removeMetaRefresh'));

// ---------------------------------------------------------------------------
// 3. aria-tables.gen.js: abstract roles purged from VALID_ARIA_ROLES
// ---------------------------------------------------------------------------
const ABSTRACT_ROLES = ['command', 'composite', 'input', 'landmark', 'range',
  'roletype', 'section', 'sectionhead', 'select', 'structure', 'widget', 'window'];

for (const role of ABSTRACT_ROLES) {
  check(`abstract role "${role}" not in VALID_ARIA_ROLES`, !VALID_ARIA_ROLES.has(role));
}

// Concrete roles that should still be present
const EXPECTED_CONCRETE = ['button', 'checkbox', 'combobox', 'dialog', 'grid',
  'heading', 'img', 'link', 'listbox', 'menu', 'menuitem', 'navigation',
  'option', 'radio', 'region', 'row', 'search', 'slider', 'spinbutton',
  'tab', 'tablist', 'tabpanel', 'textbox', 'toolbar', 'tooltip', 'tree',
  'treegrid', 'treeitem'];

for (const role of EXPECTED_CONCRETE) {
  check(`concrete role "${role}" in VALID_ARIA_ROLES`, VALID_ARIA_ROLES.has(role));
}

// ---------------------------------------------------------------------------
// 4. VALID_ARIA_ATTRS from aria-query (no hand-rolled list)
// ---------------------------------------------------------------------------
const EXPECTED_ATTRS = [
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
  'aria-checked', 'aria-expanded', 'aria-selected', 'aria-level',
  'aria-required', 'aria-invalid', 'aria-live', 'aria-atomic',
];
for (const attr of EXPECTED_ATTRS) {
  check(`VALID_ARIA_ATTRS includes ${attr}`, VALID_ARIA_ATTRS.has(attr));
}
// aria-rowindextext was added in a later aria-query version; check a different
// attribute that definitely exists in aria-query 5.3.2.
check('VALID_ARIA_ATTRS includes aria-rowspan', VALID_ARIA_ATTRS.has('aria-rowspan'));

// ---------------------------------------------------------------------------
// 5. Inverse-descriptor generation — simulate a fix and verify the descriptor
// ---------------------------------------------------------------------------
// We test the descriptor *structure* by exercising the fixer against a mock DOM.
// jsdom is not available here; instead we test the cssPath helper indirectly
// by constructing a minimal mock that records what logFix is called with.

{
  // Capture logFix calls.
  const captured = [];
  globalThis.ai4a11yLogFix = (...args) => captured.push(args);
  globalThis.ai4a11yIncrementStat = () => {};

  // Minimal mock element with attributes.
  function makeEl(tag, attrs = {}) {
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      _attrs: { ...attrs },
      getAttribute(n) { return this._attrs[n] ?? null; },
      setAttribute(n, v) { this._attrs[n] = v; },
      removeAttribute(n) { delete this._attrs[n]; },
      get id() { return this._attrs.id || ''; },
      set id(v) { this._attrs.id = v; },
      parentElement: null,
      attributes: [],
    };
    el.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    return el;
  }

  // Mock document + CSS (cssPath falls back gracefully when CSS.escape is absent).
  globalThis.document = {
    documentElement: makeEl('html'),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.CSS = { escape: (s) => s };

  // Import fixDuplicateId after mocks are set up.
  const { fixDuplicateId, fixTargetBlank, fixViewportMeta, fixPositiveTabindex } =
    await import('../skills/builtin/wcag-fixes.js');

  // 5a. fixDuplicateId: descriptor has attr:'id', prior is original id.
  {
    captured.length = 0;
    const el = makeEl('input', { id: 'foo' });
    // markProcessed is a no-op in this env (dom.js uses document methods)
    try { fixDuplicateId(el); } catch (_) {}
    const call = captured.find(c => c[0] === 'duplicate-id');
    if (call) {
      const desc = call[4];
      check('fixDuplicateId descriptor has attr:id', desc?.attr === 'id');
      check('fixDuplicateId descriptor has prior:"foo"', desc?.prior === 'foo');
      check('fixDuplicateId descriptor has selector', typeof desc?.selector === 'string');
    } else {
      check('fixDuplicateId descriptor captured', false, 'no logFix call found');
    }
  }

  // 5b. fixTargetBlank: descriptor has attr:'rel', prior is original rel value.
  {
    captured.length = 0;
    const el = makeEl('a', { rel: 'nofollow', target: '_blank' });
    el.parentElement = null;
    try { fixTargetBlank(el); } catch (_) {}
    const call = captured.find(c => c[0] === 'target-blank');
    if (call) {
      const desc = call[4];
      check('fixTargetBlank descriptor has attr:rel', desc?.attr === 'rel');
      check('fixTargetBlank descriptor has prior:"nofollow"', desc?.prior === 'nofollow');
    } else {
      check('fixTargetBlank descriptor captured', false, 'no logFix call found');
    }
  }

  // 5c. fixViewportMeta: descriptor has attr:'content'.
  {
    captured.length = 0;
    const el = makeEl('meta', { content: 'width=device-width, user-scalable=0' });
    try { fixViewportMeta(el); } catch (_) {}
    const call = captured.find(c => c[0] === 'viewport');
    if (call) {
      const desc = call[4];
      check('fixViewportMeta descriptor has attr:content', desc?.attr === 'content');
      check('fixViewportMeta descriptor prior contains user-scalable=0',
        desc?.prior?.includes('user-scalable=0'));
      // Also verify the fix actually changed the value
      check('fixViewportMeta replaced user-scalable=0 with yes',
        el.getAttribute('content')?.includes('user-scalable=yes'));
    } else {
      check('fixViewportMeta descriptor captured', false, 'no logFix call found');
    }
  }

  // 5d. fixPositiveTabindex: descriptor has attr:'tabindex', prior is old value.
  {
    captured.length = 0;
    const el = makeEl('button', { tabindex: '3' });
    try { fixPositiveTabindex(el); } catch (_) {}
    const call = captured.find(c => c[0] === 'tabindex');
    if (call) {
      const desc = call[4];
      check('fixPositiveTabindex descriptor has attr:tabindex', desc?.attr === 'tabindex');
      check('fixPositiveTabindex descriptor prior is "3"', desc?.prior === '3');
    } else {
      check('fixPositiveTabindex descriptor captured', false, 'no logFix call found');
    }
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log(`\n=== wcag-test.mjs: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
