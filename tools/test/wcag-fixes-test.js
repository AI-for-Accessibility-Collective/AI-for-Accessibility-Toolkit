// WCAG auto-fix safety tiers: jsdom tests for the wcagRiskyFixes gate.
//
// The registry declares `wcagRiskyFixes` as "off by default", so the dispatch
// map must honor it: a risky fix (one that re-tags headings, strips author
// ARIA, unwraps nested controls, or pads a control's box) runs only when the
// settings passed to the handler carry `wcagRiskyFixes: true`. Safe fixes run
// whenever the adapter is on. The tier metadata is exported so a host can say
// which fixes are risky before a person opts in.
//
// Run: node tools/test/wcag-fixes-test.js
import { JSDOM } from 'jsdom';
import {
  axeHandlers,
  fixTiers,
  isRiskyFix,
  fixHeadingOrder,
  TARGET_SIZE_PX,
} from '../adapters/wcag-fixes.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// jsdom gives every element a 0x0 rect, which reads as "too small" to the
// target-size fix. That is what these tests want: the fix has something to do.
function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

const PAGE = `
  <h1>Title</h1>
  <h4 id="skip">Jumped from h1 to h4</h4>
  <button id="aria" aria-bogus="1" aria-label="ok">a</button>
  <div id="role" role="not-a-role">r</div>
  <a id="tiny" href="/x">x</a>
  <div id="tab" tabindex="3">t</div>
  <div id="dup">one</div><div id="dup">two</div>
  <div id="dep" role="directory">d</div>
  <meta id="vp" name="viewport" content="width=device-width, user-scalable=no">
  <blink id="blink">b</blink>
  <p id="lang" lang="en_US">l</p>`;

// Run every handler under test against a fresh page with the given settings
// (undefined means "call with the element only", as today's dispatchers do).
function runAll(settings) {
  const doc = mount(PAGE);
  const call = (rule, el) => (settings === undefined ? axeHandlers[rule](el) : axeHandlers[rule](el, settings));
  const results = {};
  results.heading = call('heading-order', doc.getElementById('skip'));
  results.ariaAttr = call('aria-valid-attr', doc.getElementById('aria'));
  results.ariaRole = call('aria-roles', doc.getElementById('role'));
  results.target = call('target-size', doc.getElementById('tiny'));
  call('tabindex', doc.getElementById('tab'));
  call('duplicate-id', doc.querySelectorAll('#dup')[1]);
  call('aria-deprecated-role', doc.getElementById('dep'));
  call('meta-viewport', doc.getElementById('vp'));
  call('blink', doc.getElementById('blink'));
  call('html-lang-valid', doc.getElementById('lang'));
  return { doc, results };
}

function riskyUntouched(label, { doc, results }) {
  check(`${label}: heading order is left alone`, doc.getElementById('skip')?.tagName === 'H4');
  check(`${label}: invalid ARIA attribute is kept`, doc.getElementById('aria').hasAttribute('aria-bogus'));
  check(`${label}: invalid role is kept`, doc.getElementById('role').getAttribute('role') === 'not-a-role');
  check(`${label}: target size is untouched`, doc.getElementById('tiny').style.minWidth === '' && doc.getElementById('tiny').style.padding === '');
  check(`${label}: a skipped handler reports false`,
    results.heading === false && results.ariaAttr === false && results.ariaRole === false && results.target === false);
}

function safeApplied(label, { doc }) {
  check(`${label}: positive tabindex is reset to 0`, doc.getElementById('tab').getAttribute('tabindex') === '0');
  check(`${label}: second duplicate id is renamed`, doc.querySelectorAll('#dup').length === 1);
  check(`${label}: deprecated role is replaced`, doc.getElementById('dep').getAttribute('role') === 'list');
  check(`${label}: viewport zoom lock is lifted`, /user-scalable=yes/.test(doc.getElementById('vp').getAttribute('content')));
  check(`${label}: <blink> is replaced`, doc.getElementById('blink') === null && doc.querySelector('blink') === null);
  check(`${label}: en_US is normalised to en-US`, doc.getElementById('lang').getAttribute('lang') === 'en-US');
}

async function run() {
  // ── Default: no settings at all (how every dispatcher called handlers) ──
  {
    const page = runAll(undefined);
    riskyUntouched('no settings', page);
    safeApplied('no settings', page);
  }

  // ── Explicit false ──────────────────────────────────────────────────────
  {
    const page = runAll({ wcagRiskyFixes: false });
    riskyUntouched('wcagRiskyFixes=false', page);
    safeApplied('wcagRiskyFixes=false', page);
  }

  // ── Truthy but not true (a string from a form, say) still counts as off ──
  {
    const page = runAll({ wcagRiskyFixes: 'yes' });
    riskyUntouched('wcagRiskyFixes="yes"', page);
  }

  // ── Opted in ────────────────────────────────────────────────────────────
  {
    const page = runAll({ wcagRiskyFixes: true });
    const { doc } = page;
    check('opted in: h4 after h1 becomes h2', doc.querySelector('h2')?.textContent === 'Jumped from h1 to h4' && doc.querySelector('h4') === null);
    check('opted in: invalid ARIA attribute is removed', !doc.getElementById('aria').hasAttribute('aria-bogus'));
    check('opted in: valid ARIA attribute on the same element is kept', doc.getElementById('aria').getAttribute('aria-label') === 'ok');
    check('opted in: invalid role is removed', !doc.getElementById('role').hasAttribute('role'));
    check(`opted in: target is padded to ${TARGET_SIZE_PX}px`, doc.getElementById('tiny').style.minWidth === `${TARGET_SIZE_PX}px`);
    safeApplied('opted in', page);
  }

  // ── The named exports are the raw fixes; the gate lives in the dispatch ──
  {
    const doc = mount(PAGE);
    fixHeadingOrder(doc.getElementById('skip'));
    check('named export runs without settings (the gate is in axeHandlers)', doc.querySelector('h4') === null);
  }

  // ── Tier metadata ───────────────────────────────────────────────────────
  {
    const handlerRules = Object.keys(axeHandlers).sort();
    const tierRules = Object.keys(fixTiers).sort();
    check('every axeHandlers key has a tier', handlerRules.every((r) => fixTiers[r] === 'safe' || fixTiers[r] === 'risky'));
    check('every tier names a real handler', tierRules.every((r) => typeof axeHandlers[r] === 'function'));
    check('tiers and handlers cover the same rules', JSON.stringify(handlerRules) === JSON.stringify(tierRules));

    const RISKY = ['aria-allowed-role', 'aria-roles', 'aria-valid-attr', 'heading-order', 'nested-interactive', 'target-size'];
    const risky = tierRules.filter((r) => fixTiers[r] === 'risky');
    check(`exactly the risky rules are tagged risky (found ${risky.join(', ')})`, JSON.stringify(risky) === JSON.stringify(RISKY));
    check('isRiskyFix answers from the same table', RISKY.every(isRiskyFix) && !isRiskyFix('tabindex') && !isRiskyFix('no-such-rule'));
  }

  // ── The threshold is the size big-targets.js aims for ───────────────────
  check('TARGET_SIZE_PX is 44 (WCAG 2.5.5 enhanced size)', TARGET_SIZE_PX === 44);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
