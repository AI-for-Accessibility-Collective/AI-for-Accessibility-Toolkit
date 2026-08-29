// Controller M4 test — command intents (performAction), target addressing, and
// presentation-driven confirmation. Pure core + a tiny DOM stub; no browser.
//
//   node toolkit/test/controller-cmd.test.mjs

import { parse } from '../grammar.js';
import { createController } from '../createController.js';
import { createMockReceiver } from '../mock-receiver.js';
import { createDomReceiver } from '../web/dom-receiver.js';

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

  // navigation & search (#2)
  check('nav grammar: "open wikipedia.org" → navigate', (() => { const i = parse('open wikipedia.org'); return i.action === 'navigate' && i.target === 'wikipedia.org'; })());
  check('nav grammar: "go to https://example.com/x" → navigate', (() => { const i = parse('go to https://example.com/x'); return i.action === 'navigate' && /example\.com/.test(i.target); })());
  check('nav grammar: "open the menu" → activate (not navigate)', parse('open the menu').action === 'activate');
  check('nav grammar: "search for braille music books" → search', (() => { const i = parse('search for braille music books'); return i.action === 'search' && i.target === 'braille music books'; })());
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

  // ── 7. Router 'task' fallback (#1): unparsed utterances go to the app ──────
  {
    const recv = createMockReceiver({ actions: ['task'] });
    const c = createController({ control: recv });
    const r = await c.handle('find a good recipe for lasagna and add it to my shopping list');
    check('task fallback: unparsed utterance → performed as a task', r.ok && recv.focus === 'task');
    check('task fallback: acknowledgement reads the utterance back (#3)', /Ok, running: find a good recipe for lasagna/.test(r.say));
    check('task fallback: a very long utterance is trimmed in the ack', (await c.handle('x'.repeat(200))).say.length < 120);

    const noTask = createMockReceiver({ actions: ['scroll'] }); // no 'task'
    const c2 = createController({ control: noTask });
    const r2 = await c2.handle('do a somersault');
    check('task fallback: no task action → still unrecognized (not faked)', r2.ok === false);
  }

  // ── 8. navigate/search dispatch gated on receiver capability (#2) ──────────
  {
    const recv = createMockReceiver({ actions: ['navigate', 'search'] });
    const c = createController({ control: recv });
    check('navigate performs when supported', (await c.handle('open wikipedia.org')).ok && recv.focus === 'navigate:wikipedia.org');
    check('search performs when supported', (await c.handle('search for tactile maps')).ok && recv.focus === 'search:tactile maps');

    const noNav = createController({ control: createMockReceiver({ actions: [] }) });
    check('navigate refused when receiver lacks it', (await noNav.handle('open wikipedia.org')).ok === false);
  }

  // ── 9. rawToTask (driving a URL): free-form → task; the settings vocabulary
  //       keeps a deterministic fast path when it maps cleanly ────────────────
  {
    const recv = createMockReceiver({ actions: ['task', 'scroll'] }); // default settingKeys incl. fontScale, darkMode
    const c = createController({ control: recv, rawToTask: true });

    // A whole-utterance settings phrase the receiver declares → deterministic,
    // NOT an 8-second agent task. It really applies (persists in activeSettings).
    const r = await c.handle('bigger text');
    check('rawToTask: a clean settings phrase stays deterministic (adapt, not task)', r.ok && r.intent.type === 'adapt' && recv.settings.fontScale === 110);
    check('rawToTask: "dark mode" adapts deterministically', (await c.handle('dark mode')).intent.type === 'adapt' && recv.settings.darkMode === true);
    check('rawToTask: an imperative lead-in ("make the text bigger") still counts as whole', (await c.handle('make the text bigger')).intent.type === 'adapt' && recv.settings.fontScale === 120);
    check('rawToTask: "undo" undoes deterministically', (await c.handle('undo')).intent.type === 'undo' && recv.settings.fontScale === 110);
    check('rawToTask: "read this to me" reads deterministically (query)', (await c.handle('read this to me')).intent.type === 'query');

    // The reported case: a compound instruction must go through as ONE task, not
    // be dismembered by the grammar into a "search" it then refuses. The second
    // clause ("… and search …") is what keeps it out of the fast path.
    const rc = await c.handle('open google and search for apples');
    check('rawToTask: "open google and search for apples" → one task', rc.intent.action === 'task');
    check('rawToTask: a settings phrase with a trailing clause → task', (await c.handle('bigger text and dark mode')).intent.action === 'task');

    // A `command` (scroll/navigate/search) is deliberately NOT fast-pathed — the
    // agent does it at least as well, and routing it keeps compound phrasing working.
    check('rawToTask: "scroll down" (a command) → task', (await c.handle('scroll down')).intent.action === 'task');
    check('rawToTask: "search for apples" → task', (await c.handle('search for apples')).intent.action === 'task');

    // Honesty: a settings phrase the receiver does NOT declare falls through to
    // a task (let the agent try) rather than being refused locally.
    const noFont = createController({ control: createMockReceiver({ actions: ['task'], settingKeys: ['darkMode'] }), rawToTask: true });
    check('rawToTask: a setting the receiver lacks → task (agent fallback, not refusal)', (await noFont.handle('bigger text')).intent.action === 'task');

    // Sanity: the SAME receiver without rawToTask still runs the full grammar.
    const c2 = createController({ control: createMockReceiver({ actions: ['task'] }) });
    check('no rawToTask: a grammar phrase still adapts locally', (await c2.handle('bigger text')).intent.type === 'adapt');

    // rawToTask still routes an unrecognized/free-form utterance as a task even
    // when the receiver doesn't advertise one — no silent "can't search" refusal.
    const c3 = createController({ control: createMockReceiver({ actions: [] }), rawToTask: true });
    const r3 = await c3.handle('book me a flight to boston');
    check('rawToTask: unadvertised free-form still routed as a task (no grammar fallback)', r3.intent.type === 'command' && r3.intent.action === 'task');
  }

  // ── 10. returnToController flag reaches the app via performAction meta ─────
  {
    let lastMeta;
    const recv = Object.assign({}, createMockReceiver({ actions: ['task'] }), {
      async performAction(action, target, text, meta) { lastMeta = meta; return { ok: true }; },
    });
    const c = createController({ control: recv, rawToTask: true });
    await c.handle('do a thing', { returnToController: true });
    check('meta.returnToController=true is passed to performAction', lastMeta && lastMeta.returnToController === true);
    await c.handle('do a thing', { returnToController: false });
    check('meta.returnToController=false is respected', lastMeta && lastMeta.returnToController === false);
    await c.handle('do a thing'); // no opts → default on
    check('meta.returnToController defaults to true', lastMeta && lastMeta.returnToController === true);
  }

  console.log(`\nController M4 (commands): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
