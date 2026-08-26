// Controller M4 test — command intents (performAction), target addressing, and
// presentation-driven confirmation. Pure core + a tiny DOM stub; no browser.
//
//   node toolkit/test/controller-cmd.test.mjs

import { parse } from '../controller/grammar.js';
import { createController } from '../controller/createController.js';
import { createMockReceiver } from '../controller/mock-receiver.js';
import { createDomReceiver } from '../controller/web/dom-receiver.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ── 1. Grammar parses commands (and doesn't shadow adaptation) ─────────────
{
  check('cmd grammar: "click documentation" → activate target', (() => { const i = parse('click documentation'); return i.type === 'command' && i.action === 'activate' && i.target === 'documentation'; })());
  check('cmd grammar: "press the submit button" → activate "submit" (noun stripped)', parse('press the submit button').target === 'submit');
  check('cmd grammar: "scroll to bottom" → scroll bottom', (() => { const i = parse('scroll to bottom'); return i.action === 'scroll' && i.target === 'bottom'; })());
  check('cmd grammar: "go back" → back', parse('go back').action === 'back');
  check('cmd grammar: adaptation still wins ("dark mode" is not a command)', parse('dark mode').type === 'adapt');
}

async function run() {
  // ── 2. Dispatch a command through the port ────────────────────────────────
  {
    const recv = createMockReceiver({ actions: ['activate', 'scroll'] });
    const c = createController({ control: recv }); // default profile → no confirmation
    const r = await c.handle('click documentation');
    check('cmd dispatch: activate performs (default profile, no confirm)', r.ok && recv.focus === 'activate:documentation');
    check('cmd dispatch: not awaiting confirmation', c.awaitingConfirmation === false);
  }

  // ── 3. Confirmation flow (operator profile that confirms) ─────────────────
  {
    const recv = createMockReceiver({ actions: ['activate', 'scroll'] });
    const c = createController({ control: recv, operator: { abilityModel: { supportAreas: ['cognitive'] } } });

    const r1 = await c.handle('click documentation');
    check('confirm: command is held, not performed', r1.pending === true && recv.focus === 'document' && /confirm/i.test(r1.say));
    check('confirm: awaitingConfirmation is true', c.awaitingConfirmation === true);

    const r2 = await c.handle('yes');
    check('confirm: "yes" performs the held command', r2.ok && recv.focus === 'activate:documentation');
    check('confirm: no longer awaiting', c.awaitingConfirmation === false);
  }

  // ── 4. Confirmation can be declined ───────────────────────────────────────
  {
    const recv = createMockReceiver({ actions: ['activate', 'scroll'] });
    const c = createController({ control: recv, operator: { abilityModel: { supportAreas: ['motor'] } } });
    await c.handle('click documentation');
    const r = await c.handle('no');
    check('confirm: "no" cancels, nothing performed', r.ok && /cancel/i.test(r.say) && recv.focus === 'document' && c.awaitingConfirmation === false);
  }

  // ── 5. Benign navigation is never gated, even when confirmActions is on ───
  {
    const recv = createMockReceiver({ actions: ['activate', 'scroll'] });
    const c = createController({ control: recv, operator: { abilityModel: { supportAreas: ['cognitive'] } } });
    const r = await c.handle('scroll down');
    check('confirm: scroll performs immediately (benign, no confirm)', r.ok && !c.awaitingConfirmation && recv.focus === 'scroll:down');
  }

  // ── 6. DOM receiver: activate-by-label + target listing ───────────────────
  {
    const links = [
      { textContent: 'Documentation', getAttribute: () => null, clicked: false, click() { this.clicked = true; } },
      { textContent: 'Buy now', getAttribute: () => null, clicked: false, click() { this.clicked = true; } },
    ];
    const root = {
      style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} },
      classList: { contains() { return false; }, toggle() { return false; } },
      dataset: {}, textContent: '', getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => links,
    };
    const recv = createDomReceiver(root, {});
    const caps = await recv.describeCapabilities();
    check('web cmd: capabilities list actions + targets', caps.actions.includes('activate') && caps.targets.includes('Documentation'));

    const c = createController({ control: recv });
    const r1 = await c.handle('click the documentation'); // fuzzy: target "documentation" ⊆ "Documentation"
    check('web cmd: activate clicks the matching element', r1.ok && links[0].clicked && !links[1].clicked);

    const r2 = await c.handle('open buy'); // "buy" ⊆ "Buy now"
    check('web cmd: partial label matches', r2.ok && links[1].clicked);

    const r3 = await c.handle('click checkout'); // no such target
    check('web cmd: no match is refused honestly', r3.ok === false);
  }

  console.log(`\nController M4 (commands): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
