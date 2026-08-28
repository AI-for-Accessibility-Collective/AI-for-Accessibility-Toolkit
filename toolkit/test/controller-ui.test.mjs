// Controller web UI — jsdom tests for the two live regions (issue #6) and the
// Speak-results toggle (issue #5). Globals must be set BEFORE importing ui.js
// (it feature-detects window/TTS at module load), so ui.js is imported
// dynamically after the DOM is in place.
//
//   node toolkit/test/controller-ui.test.mjs

import { JSDOM } from 'jsdom';
import { createController } from '../controller/createController.js';
import { createMockReceiver } from '../controller/mock-receiver.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
const spoken = [];
global.window.speechSynthesis = { speak: (u) => spoken.push(u && u.text), cancel() {} };
global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
// No SpeechRecognition on purpose — text-only path.

const { renderControllerUI } = await import('../controller/web/ui.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  // Speak-results defaults ON regardless of profile — use a default profile,
  // whose presentation.output.speech is false, to prove the default isn't the
  // inference.
  const c = createController({ control: createMockReceiver(), operator: { abilityModel: { supportAreas: [] } } });
  const ui = renderControllerUI(c, { doc: document });
  document.body.appendChild(ui.root);

  const alertEl = ui.root.querySelector('.aa-feedback[role="alert"]');
  const statusEl = ui.root.querySelector('.aa-feedback[role="status"]');
  const cb = ui.root.querySelector('.aa-toggle input');
  const input = ui.root.querySelector('.aa-input');
  const go = ui.root.querySelector('.aa-go');

  check('#6: two live regions — assertive alert + polite status', alertEl.getAttribute('aria-live') === 'assertive' && statusEl.getAttribute('aria-live') === 'polite');
  check('#5: Speak-results toggle is present', !!cb);
  check('#5: Speak-results defaults ON (even for a default profile)', cb.checked === true);

  // Adaptation acknowledgement → assertive region, and spoken (toggle on).
  input.value = 'bigger text'; go.click(); await tick(); await tick();
  check('#6: an acknowledgement routes to the ASSERTIVE region', /bigger/i.test(alertEl.textContent) && statusEl.textContent === '');
  check('#5: acknowledgement spoken while toggle is on', spoken.some((t) => /bigger/i.test(t)));

  // Content read → polite region, other region cleared.
  input.value = 'read this'; go.click(); await tick(); await tick();
  check('#6: a content read routes to the POLITE region', /demo document/i.test(statusEl.textContent) && alertEl.textContent === '');

  // Toggle off → silent + persisted.
  spoken.length = 0;
  cb.checked = false; cb.dispatchEvent(new dom.window.Event('change'));
  input.value = 'dark mode'; go.click(); await tick(); await tick();
  check('#5: toggle off → NOT spoken', spoken.length === 0);
  check('#5: toggle persists to localStorage', localStorage.getItem('aa-controller-speak-results') === '0');

  // A remote note (onNote) → polite region.
  let fire = null;
  const noteControl = Object.assign({}, createMockReceiver(), { onNote(fn) { fire = fn; return () => { fire = null; }; } });
  const c2 = createController({ control: noteControl });
  const ui2 = renderControllerUI(c2, { doc: document });
  document.body.appendChild(ui2.root);
  fire('The top story is X');
  check('#6: an out-of-band note routes to the POLITE region', ui2.root.querySelector('.aa-feedback[role="status"]').textContent === 'The top story is X'
    && ui2.root.querySelector('.aa-feedback[role="alert"]').textContent === '');

  console.log(`\nController UI: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
