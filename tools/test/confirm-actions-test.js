// Confirm Actions — realistic jsdom tests. Asserts the user-facing contract
// (a destructive click is blocked until confirmed by a second click, harmless
// clicks are untouched) AND the reversibility contract: enable() is
// idempotent, and disable() removes the capture listener, the prompt, and
// every armed data flag.
//
// Run: node tools/test/confirm-actions-test.js
import { JSDOM } from 'jsdom';
import { ConfirmActions } from '../adapters/confirm-actions.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/settings' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

async function run() {
  const doc = mount(`<button id="del">Delete account</button><button id="ok">Read more</button>`);
  const del = doc.querySelector('#del');
  const ok = doc.querySelector('#ok');
  // Bubble-phase handlers standing in for the page's own actions. The
  // adapter's capture-phase listener runs first and, on an unconfirmed
  // destructive click, stopImmediatePropagation keeps these from firing.
  let fired = 0, okFired = 0;
  del.addEventListener('click', () => fired++);
  ok.addEventListener('click', () => okFired++);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const prompt = () => doc.querySelector('#ai4a11y-confirm-prompt');
  const armed = (el) => el.hasAttribute('data-ai4a11y-armed');

  ConfirmActions.enable();
  check('confirm: enable alone changes nothing visible', prompt() === null && !armed(del) && !armed(ok));

  // First click on a destructive button is blocked and arms it.
  click(del);
  check('confirm: first click on "Delete account" is blocked (page handler never fires)', fired === 0);
  check('confirm: the blocked button gets the armed data flag', armed(del));
  check('confirm: a "Click again to confirm" prompt appears next to it', prompt()?.textContent === 'Click again to confirm');

  // Second click on the same button is the confirmation — it goes through.
  click(del);
  check('confirm: second click goes through to the page handler', fired === 1);
  check('confirm: confirmation clears the flag and removes the prompt', !armed(del) && prompt() === null);

  // A harmless button is never intercepted.
  click(ok);
  check('confirm: a non-destructive button ("Read more") fires immediately, never armed', okFired === 1 && !armed(ok));

  // Idempotency: a second enable() must not stack a second listener — the
  // block-then-confirm cycle still lets exactly one click through.
  ConfirmActions.enable();
  click(del); // blocked + armed
  click(del); // confirmed
  check('confirm: second enable is a no-op (one block, one pass-through)', fired === 2);

  // disable() removes the listener, the prompt, and the armed flags.
  click(del); // blocked again — leaves a prompt and an armed flag behind
  ConfirmActions.disable();
  check('confirm: disable removes the prompt and clears the armed flag', prompt() === null && !armed(del));
  click(del);
  check('confirm: after disable, a destructive click proceeds normally', fired === 3);

  ConfirmActions.disable(); // disabling twice is safe
  check('confirm: double disable is safe', ConfirmActions.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
