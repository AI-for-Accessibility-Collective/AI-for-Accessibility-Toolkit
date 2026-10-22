// Color Blind Mode — checks the color matrices the page gets, then the rest
// of the page wiring, in jsdom. The filters used to simulate color blindness
// (red turned green for everyone); these check that they now correct it:
// greys stay grey, reds stay red, and a red and a green the person confuses
// come further apart as that person sees them. jsdom does not run SVG
// filters, so the matrices are read from the injected filter and applied here.
//
// Run: node tools/test/color-blind-test.js
import { JSDOM } from 'jsdom';
import { ColorBlindMode } from '../adapters/color-blind.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// How each type sees colors (Machado et al. 2009, full strength), kept here
// on its own so the test does not just repeat the adapter's numbers back.
const SEES = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const apply = (m, c) => m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
const lin = (hex) => [1, 3, 5].map(i => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
// How different two linear-RGB colors look: distance in CIELAB.
const lab = ([r, g, b]) => {
  const f = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const dist = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// Colors a color-blind shopper has to tell apart: the store's "only 2 left"
// red against its "in stock" green, and a plain UI red and green.
const RED_GREEN = [['#b1040e', '#1e7b3b'], ['#d93025', '#188038'], ['#c62828', '#2e7d32']];
// Tritanopia mixes up blue with green, and yellow with pink and violet.
const BLUE_YELLOW = [['#1565c0', '#2e7d32'], ['#1e88e5', '#43a047'], ['#fdd835', '#ce93d8']];

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><p>Only 2 left</p></body></html>', { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom.window.document;
}

// The 3x3 color part of the filter the page gets for one type.
function matrixOf(doc, type) {
  const f = doc.querySelector(`#ai4a11y-${type}-filter feColorMatrix`);
  const v = f ? f.getAttribute('values').trim().split(/[\s,]+/).map(Number) : [];
  return v.length === 20 ? [v.slice(0, 3), v.slice(5, 8), v.slice(10, 13)] : null;
}

function run() {
  const mats = {};
  {
    const doc = mount();
    ColorBlindMode.enable('deuteranopia');
    for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) mats[type] = matrixOf(doc, type);
    ColorBlindMode.disable();
  }
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) {
    const m = mats[type];
    check(`${type}: a 3x3 matrix`, m && m.length === 3 && m.every(r => r.length === 3 && r.every(Number.isFinite)));
    check(`${type}: every row adds up to 1, so white, grey and black stay as they are`,
      m.every(r => Math.abs(r[0] + r[1] + r[2] - 1) < 1e-4));
    const pairs = type === 'tritanopia' ? BLUE_YELLOW : RED_GREEN;
    for (const [a, b] of pairs) {
      const before = dist(apply(SEES[type], lin(a)), apply(SEES[type], lin(b)));
      const after = dist(apply(SEES[type], apply(m, lin(a))), apply(SEES[type], apply(m, lin(b))));
      check(`${type}: ${a} and ${b} look further apart to the person (${before.toFixed(1)} -> ${after.toFixed(1)})`, after > before * 1.2);
    }
  }
  // Reds stay red for everyone else on the screen: red stays the strongest
  // channel by far, and green does not grow (the old simulation turned the
  // store's red into olive green).
  for (const type of ['protanopia', 'deuteranopia']) {
    const m = mats[type];
    for (const [red] of RED_GREEN) {
      const [r, g, b] = apply(m, lin(red));
      const [, g0] = lin(red);
      check(`${type}: ${red} stays red (r ${r.toFixed(2)}, g ${g.toFixed(2)}, b ${b.toFixed(2)})`, r > 2 * b && r > 4 * g && g <= g0 + 1e-9);
    }
  }
  // The page: one SVG with the three filters, and the variable the shared
  // <html> filter rule reads. disable() takes both away.
  const doc = mount();
  const before = doc.documentElement.outerHTML;
  ColorBlindMode.enable('deuteranopia');
  const svg = doc.getElementById('ai4a11y-svg-filters');
  check('page: injects the SVG filters', !!svg);
  const values = [...doc.querySelectorAll('feColorMatrix')].map(f => f.getAttribute('values').trim().split(/\s+/).map(Number));
  check('page: one 4x5 matrix for each of the three types', values.length === 3 && values.every(v => v.length === 20 && v.every(Number.isFinite)));
  const style = doc.getElementById('ai4a11y-color-blind-styles');
  check('page: sets the color variable to the deuteranopia filter',
    !!style && style.textContent.includes('--ai4a11y-filter-color: url(#ai4a11y-deuteranopia-filter)'));
  check('page: uses the shared <html> filter rule, so dark mode and dimming still combine',
    style.textContent.includes('var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,)'));
  ColorBlindMode.disable();
  check('page: disable() puts the page back exactly', doc.documentElement.outerHTML === before);
}

run();
console.log(`\ncolor-blind: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
