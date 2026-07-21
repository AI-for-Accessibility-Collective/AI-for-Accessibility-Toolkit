// Confirm Actions — realistic jsdom tests. Asserts the user-facing contract
// (a destructive click is blocked until confirmed by a second click, harmless
// and programmatic clicks are untouched) AND the reversibility contract:
// enable() is idempotent, and disable() removes the capture listener, the
// prompt, and every armed data flag.
//
// jsdom cannot forge trusted events (isTrusted is locked to false), so the
// interception logic is driven by calling onClick directly with an explicit
// isTrusted flag. End-to-end propagation — stopImmediatePropagation actually
// blocking the page's own handler on a genuine user click — is covered by the
// real-browser test (Playwright page.click, which is trusted).
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
  const doc = mount(
    `<button id="del">Delete account</button>` +
    `<button id="ok">Read more</button>` +
    `<a id="card" href="/x">Go read the latest update from our newsroom about how to delete old workflows</a>`
  );
  const del = doc.querySelector('#del');
  const ok = doc.querySelector('#ok');
  const card = doc.querySelector('#card');
  const prompt = () => doc.querySelector('#ai4a11y-confirm-prompt');
  const armed = (el) => el.hasAttribute('data-ai4a11y-armed');

  // Drive the guard directly with a controllable event (a real user click is
  // trusted). Records whether the adapter prevented/stopped it.
  const fire = (el, isTrusted = true) => {
    const e = {
      target: el, isTrusted, _pd: false, _sip: false,
      preventDefault() { this._pd = true; },
      stopImmediatePropagation() { this._sip = true; },
    };
    ConfirmActions.onClick(e);
    return e;
  };

  ConfirmActions.enable();
  check('confirm: enable alone changes nothing visible', prompt() === null && !armed(del) && !armed(ok));

  // First click on a destructive button is blocked and arms it.
  const e1 = fire(del);
  check('confirm: first click on "Delete account" is blocked (prevented + stopped)', e1._pd && e1._sip);
  check('confirm: the blocked button gets the armed data flag', armed(del));
  check('confirm: a "Click again to confirm" prompt appears', prompt()?.textContent === 'Click again to confirm');

  // Second click on the same button is the confirmation — it passes through.
  const e2 = fire(del);
  check('confirm: second click is let through (not prevented)', !e2._pd);
  check('confirm: confirmation clears the flag and removes the prompt', !armed(del) && prompt() === null);

  // A harmless button is never intercepted.
  const e3 = fire(ok);
  check('confirm: a non-destructive button ("Read more") is never blocked or armed', !e3._pd && !armed(ok));

  // A whole card wrapped in one <a>, with a keyword buried in long text, is NOT
  // treated as an action — the accessible name is too long to be a button label.
  const e4 = fire(card);
  check('confirm: a long card-link with a buried keyword is not intercepted', !e4._pd && !armed(card));

  // A programmatic (untrusted) click — e.g. a site forwarding to a hidden submit
  // — passes straight through, never armed.
  const e5 = fire(del, false);
  check('confirm: a programmatic (untrusted) click is not intercepted', !e5._pd && !armed(del));

  // Idempotency: a second enable() must not stack behavior — still one block,
  // one pass-through.
  ConfirmActions.enable();
  const e6 = fire(del); // blocked + armed
  const e7 = fire(del); // confirmed
  check('confirm: second enable is a no-op (block then pass)', e6._pd && !e7._pd);

  // disable() removes the prompt, clears the armed flags, and stops guarding.
  fire(del); // arm again, leaving a prompt + flag behind
  ConfirmActions.disable();
  check('confirm: disable removes the prompt and clears the armed flag', prompt() === null && !armed(del));
  const e8 = fire(del); // onClick short-circuits on !enabled
  check('confirm: after disable, a destructive click is not blocked', !e8._pd);

  ConfirmActions.disable(); // disabling twice is safe
  check('confirm: double disable is safe', ConfirmActions.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
