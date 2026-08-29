// Controller M0 test — the headless core: deterministic grammar, the router's
// dispatch through a neutral ControlPort, and honest capability handling.
// Runs the PURE core against a NON-web mock receiver (no DOM), which is the
// point: it proves the ControlPort contract is platform-neutral.
//
//   node toolkit/test/controller.test.mjs

import { parse, vocabularyKeys, consumesWholeUtterance } from '../grammar.js';
import { createController } from '../createController.js';
import { createMockReceiver } from '../mock-receiver.js';
import { noopControl } from '../control-port.js';
import { deriveControllerPresentation, describePresentation } from '../presentation.js';
import { settingsMeta } from '../../toolkit/registry/tools.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ── 1. Grammar: phrases resolve to the right Intent shape ──────────────────
{
  check('grammar: "bigger text" → adapt delta fontScale +', (() => {
    const i = parse('bigger text');
    return i.type === 'adapt' && i.deltas.fontScale > 0;
  })());
  check('grammar: "smaller text" → adapt delta fontScale -', parse('make the font smaller').deltas.fontScale < 0);
  check('grammar: "text size 150" → adapt absolute fontScale 150', parse('text size 150').changes.fontScale === 150);
  check('grammar: "dark mode" → darkMode true', parse('dark mode please').changes.darkMode === true);
  check('grammar: "light mode" negation → darkMode false', parse('switch to light mode').changes.darkMode === false);
  check('grammar: "high contrast" → contrastMode enum', parse('high contrast').changes.contrastMode === 'yellow-black');
  check('grammar: "reduce motion" → motionReducer true', parse('please reduce motion').changes.motionReducer === true);
  check('grammar: "read this" → query content text', (() => { const i = parse('read this to me'); return i.type === 'query' && i.ask === 'content' && i.mode === 'text'; })());
  check('grammar: "what\'s on screen" → query content outline', (() => { const i = parse("what's on screen"); return i.type === 'query' && i.ask === 'content'; })());
  check('grammar: "my settings" → query context', (() => { const i = parse('what are my current settings'); return i.type === 'query' && i.ask === 'context'; })());
  check('grammar: "undo" → undo', parse('undo that').type === 'undo');
  check('grammar: "scroll down" → command scroll', (() => { const i = parse('scroll down'); return i.type === 'command' && i.action === 'scroll' && i.target === 'down'; })());
  check('grammar: gibberish → null', parse('xyzzy plugh') === null);
  check('grammar: every vocabulary key is a real settingsMeta key', vocabularyKeys().every((k) => settingsMeta[k]));
}

// ── 2. Dispatch through the mock receiver (non-web) ────────────────────────
async function run() {
  {
    const recv = createMockReceiver();
    const c = createController({ control: recv });

    // absolute
    let r = await c.handle('text size 150');
    check('dispatch: absolute font size applies', r.ok && recv.settings.fontScale === 150);

    // relative delta resolves against current (150) and clamps to range [50,200]
    r = await c.handle('bigger text');
    check('dispatch: relative delta moves from current value', recv.settings.fontScale === 160);

    // clamp: push way past the max
    for (let i = 0; i < 10; i++) await c.handle('bigger text');
    check('dispatch: numeric clamps to settingsMeta max (200)', recv.settings.fontScale === 200);

    // boolean + enum
    r = await c.handle('dark mode');
    check('dispatch: boolean applies', r.ok && recv.settings.darkMode === true);
    r = await c.handle('high contrast');
    check('dispatch: enum applies', r.ok && recv.settings.contrastMode === 'yellow-black');

    // say feedback is present
    check('dispatch: result carries a spoken feedback string', typeof r.say === 'string' && r.say.length > 0);
  }

  // ── 3. Undo is LIFO and restores prior value ──────────────────────────────
  {
    const recv = createMockReceiver({ initial: { fontScale: 100 } });
    const c = createController({ control: recv });
    await c.handle('text size 150');
    check('undo setup: fontScale is 150', recv.settings.fontScale === 150);
    const r = await c.handle('undo');
    check('undo: restores prior value', r.ok && recv.settings.fontScale === 100);
    const r2 = await c.handle('undo');
    check('undo: reports nothing to undo when journal empty', r2.ok === false);
  }

  // ── 4. Honesty: a receiver that can't do a key says so, doesn't fake it ───
  {
    const recv = createMockReceiver({ settingKeys: ['fontScale'] }); // no darkMode
    const c = createController({ control: recv });
    const r = await c.handle('dark mode');
    check('honesty: unsupported key is NOT applied', !('darkMode' in recv.settings));
    check('honesty: result is not-ok and names the limitation', r.ok === false && r.data.unsupported.includes('darkMode'));
  }

  // ── 5. Query + content ────────────────────────────────────────────────────
  {
    const recv = createMockReceiver();
    const c = createController({ control: recv });
    await c.handle('dark mode');
    const q = await c.handle('what are my settings');
    check('query context: summarizes active settings', q.ok && /darkMode/.test(q.say));
    const rd = await c.handle('read this');
    check('query content: returns readable text', rd.ok && /demo document/i.test(rd.say));
  }

  // ── 6. Command seam through the neutral port ──────────────────────────────
  {
    const recv = createMockReceiver({ actions: ['scroll'] });
    const c = createController({ control: recv });
    const r = await c.handle('scroll down');
    check('command: supported action performs and is observable', r.ok && recv.focus === 'scroll:down');
    const recv2 = createMockReceiver({ actions: [] });
    const c2 = createController({ control: recv2 });
    const r2 = await c2.handle('scroll down');
    check('command: unsupported action is refused honestly', r2.ok === false);
  }

  // ── 7. Unrecognized + noop default ────────────────────────────────────────
  {
    const c = createController({ control: createMockReceiver() });
    const r = await c.handle('please make me a sandwich');
    check('unrecognized: not-ok with suggestions in the feedback', r.ok === false && /try:/i.test(r.say));

    const cn = createController(); // defaults to noopControl
    const rn = await cn.handle('dark mode');
    check('noop control: honestly reports it cannot act', rn.ok === false);
    check('noop control: describeCapabilities is empty', (await noopControl.describeCapabilities()).settingKeys.length === 0);
  }

  // ── 8. M1: presentation — the Controller renders itself per operator ──────
  {
    const vision = deriveControllerPresentation({ supportAreas: ['vision'] });
    check('presentation: vision → speech output, primary speech', vision.output.speech && vision.output.primary === 'speech');
    check('presentation: vision → voice-primary input', vision.input.primary === 'voice');
    check('presentation: vision → detailed verbosity', vision.verbosity === 'detailed');

    // A screen-reader operator (profile carries screen-reader needs): feedback
    // goes to the live region in their own voice — never a second TTS voice (#7).
    const sr = deriveControllerPresentation({ supportAreas: ['vision'], needs: [{ dimension: 'repairLandmarks', value: true }] });
    check('presentation: screen-reader → assistiveTech, no speech, text primary', sr.output.assistiveTech === true && sr.output.speech === false && sr.output.primary === 'text');

    const hearing = deriveControllerPresentation({ supportAreas: ['hearing'] });
    check('presentation: hearing → captions on, text-primary output', hearing.output.captions && hearing.output.primary === 'text');

    const both = deriveControllerPresentation({ supportAreas: ['vision', 'hearing'] });
    check('presentation: vision+hearing → speak AND caption (most accommodating)', both.output.speech && both.output.captions);

    const cog = deriveControllerPresentation({ supportAreas: ['cognitive'] });
    check('presentation: cognitive → concise + plain + 1 step + confirm + text-primary',
      cog.verbosity === 'concise' && cog.language === 'plain' && cog.stepsAtATime === 1 && cog.confirmActions && cog.input.primary === 'text');

    const motor = deriveControllerPresentation({ supportAreas: ['motor'] });
    check('presentation: motor → scan input, large targets, confirm, voice-primary',
      motor.input.scan && motor.targetSize === 'large' && motor.confirmActions && motor.input.primary === 'voice');

    const dflt = deriveControllerPresentation({});
    check('presentation: default → voice+text in, text-primary out, normal/standard',
      dflt.input.voice && dflt.input.text && dflt.output.primary === 'text' && dflt.verbosity === 'normal' && dflt.language === 'standard');

    check('presentation: describePresentation returns a sentence', /Input:.*Output:/.test(describePresentation(cog)));
  }

  // ── 9. M1: presentation wired into createController + loadPresentation ─────
  {
    const c = createController({ control: createMockReceiver(), operator: { abilityModel: { supportAreas: ['motor'] } } });
    check('createController: presentation reflects operator model', c.presentation.targetSize === 'large');

    const fakeLibrarian = { async getAbilityModel() { return { supportAreas: ['vision'] }; } };
    const c2 = createController({ control: createMockReceiver(), operator: { librarian: fakeLibrarian } });
    check('createController: default presentation before load', c2.presentation.output.primary === 'text');
    await c2.loadPresentation();
    check('createController: loadPresentation pulls from the librarian', c2.presentation.output.primary === 'speech');

    c2.refreshPresentation({ supportAreas: ['cognitive'] });
    check('createController: refreshPresentation recomputes', c2.presentation.language === 'plain');
  }

  // ── 10. M1: richer intents — help + speech rate ───────────────────────────
  {
    check('grammar: "what can I say" → query help', (() => { const i = parse('what can i say'); return i.type === 'query' && i.ask === 'help'; })());
    check('grammar: "speak slower" → speechRate delta -', parse('please speak slower').deltas.speechRate < 0);
    check('grammar: "read faster" → speechRate delta +', parse('read faster').deltas.speechRate > 0);

    const recv = createMockReceiver();
    const c = createController({ control: recv });
    const h = await c.handle('help');
    check('dispatch: help lists example commands', h.ok && /dark mode/.test(h.say));
    const s = await c.handle('speak slower');
    check('dispatch: speech rate moves from baseline 1.0 and clamps to range', recv.settings.speechRate === 0.8);
  }

  // ── consumesWholeUtterance: the rawToTask fast-path guard ──────────────────
  // A whole-utterance settings phrase is deterministic; a second clause or
  // extra trailing content sends it to the app whole.
  {
    const whole = ['bigger text', 'dark mode', 'undo', 'read this to me',
      'make the text bigger', 'please turn on dark mode', 'high contrast'];
    for (const u of whole) check(`whole: "${u}" consumes the utterance`, consumesWholeUtterance(u) === true);

    const notWhole = ['open google and search for apples', 'bigger text and dark mode',
      'dark mode, then scroll down', 'tell me about dark mode in physics',
      'what is dark mode used for'];
    for (const u of notWhole) check(`not whole: "${u}" is left for the app`, consumesWholeUtterance(u) === false);
  }

  console.log(`\nController M0+M1: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
