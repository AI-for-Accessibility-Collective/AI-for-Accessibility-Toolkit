// The routing ladder behind every chat turn — the precedence between a reset
// phrase, a controller command, a self-description, and everything else.
//
// This is the decision that defines the surface, and it lived inside a
// DOM-bound function in chat.js where nothing could reach it. The real matchers
// are used here (chat-routing.js and the controller grammar), not stubs, so a
// change to either that breaks the precedence shows up as a failure here.
//
//   node onboarding/test/chat-turn.test.mjs

import { routeTurn, classifyControllerResult, fallbackHelp, generalAnswerPrompt } from '../chat-turn.js';
import { detectOnboarding, isResetToProfile } from '../chat-routing.js';
import { parse } from '../../controller/grammar.js';

// routeTurn does not consult the grammar; `parse` is imported to prove the
// keyword collision that makes the precedence matter is genuinely there.
const REAL = { isResetToProfile, detectOnboarding };

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
const kindOf = (text, deps = REAL) => routeTurn(text, deps).kind;

// ── a command beats a self-description ───────────────────────────────────────
// The onboarding vocabulary and the settings vocabulary overlap ("distractions"
// appears in both), so precedence is what keeps "hide distractions" from being
// read as a disclosure about attention.
{
  check('“bigger text” routes to the controller', kindOf('bigger text') === 'controller');
  check('“hide distractions” is a command, not a disclosure', kindOf('hide distractions') === 'controller');
  check('“read this” routes to the controller', kindOf('read this') === 'controller');
  check('“undo” routes to the controller', kindOf('undo') === 'controller');
}

// ── a self-description onboards ──────────────────────────────────────────────
{
  check('“I’m blind” onboards', kindOf("I'm blind") === 'onboard');
  check('“I have low vision” onboards', kindOf('I have low vision') === 'onboard');
  check('“I have ADHD” onboards', kindOf('I have ADHD') === 'onboard');
  check('“I am hard of hearing” onboards', kindOf('I am hard of hearing') === 'onboard');
  const r = routeTurn("I'm blind", REAL);
  check('an onboarding route carries what was detected', !!r.onboarding && Array.isArray(r.onboarding.supportAreas));
  check('…and names the vision support area', r.onboarding.supportAreas.includes('vision'));
}

// ── a disclosure reaches the profile even when it parses as a command ────────
// "dyslexia" is also a settings keyword. While the grammar was consulted first,
// these turned into a font change for the session and never reached the
// profile, unlike every disclosure with no keyword collision.
{
  check('“I have dyslexia” onboards, it is not just a font command', kindOf('I have dyslexia') === 'onboard');
  check('“I’m dyslexic” onboards', kindOf("I'm dyslexic") === 'onboard');
  check('a bare “dyslexia” onboards', kindOf('dyslexia') === 'onboard');

  // The worst case of the old order: the hearing half was lost outright.
  const compound = routeTurn('I am deaf and I have dyslexia', REAL);
  check('a compound disclosure onboards', compound.kind === 'onboard');
  check('…and keeps BOTH areas', ['hearing', 'reading'].every((a) => compound.onboarding.supportAreas.includes(a)));

  check('the reading area is what gets recorded', routeTurn('I have dyslexia', REAL).onboarding.supportAreas.includes('reading'));
}

// ── …without swallowing commands ─────────────────────────────────────────────
// Onboarding going first is only safe because detectOnboarding is conservative:
// its keywords exclude command words, and it needs first-person phrasing or a
// bare condition. These are the cases that would break if that ever loosened.
{
  for (const cmd of [
    'bigger text', 'dark mode', 'hide distractions', 'read this', 'undo',
    'high contrast', 'show captions', 'stop live captions', 'reduce motion',
  ]) {
    check(`“${cmd}” is still a command`, kindOf(cmd) === 'controller');
  }

  // First-person phrasing that is a REQUEST, not a disclosure. These carry a
  // settings word rather than a condition word, so detectOnboarding ignores them.
  for (const req of [
    'I need bigger text', 'make the text bigger for me', 'I want dark mode',
    'can you read this to me', 'my text is too small',
  ]) {
    check(`“${req}” is a request, not a disclosure`, kindOf(req) === 'controller');
  }
}

// ── a reset phrase beats BOTH ────────────────────────────────────────────────
// It runs before the grammar on purpose: "reset my settings" contains a settings
// word, and would otherwise be handled as a settings command.
{
  check('“back to my profile” is a reset', kindOf('back to my profile') === 'reset');
  check('“reset to defaults” is a reset', kindOf('reset to defaults') === 'reset');
  check('“forget what I changed” is a reset', kindOf('forget what I changed') === 'reset');
  check('“start again” is a reset', kindOf('start again') === 'reset');
}

// ── everything else falls through ────────────────────────────────────────────
{
  check('an open question goes to the controller', kindOf('what is a screen reader') === 'controller');
  check('an unrelated request goes to the controller', kindOf('play a podcast from spotify') === 'controller');
  check('empty input is inert', kindOf('') === 'controller');
  check('whitespace is inert', kindOf('   ') === 'controller');
  check('null is inert', kindOf(null) === 'controller');
}

// ── the collision the precedence exists to resolve is real ───────────────────
// If the grammar ever stopped claiming these, the ordering above would be
// untested by accident rather than by design.
{
  check('the grammar really does claim “I have dyslexia”', !!parse('I have dyslexia'));
  check('…and a bare “dyslexia”', !!parse('dyslexia'));
  check('…while it claims neither “I’m blind”', !parse("I'm blind"));
  check('…nor “I have ADHD”', !parse('I have ADHD'));
}

// ── precedence is the ladder, proven with stubs ──────────────────────────────
// With every matcher claiming the utterance at once, the order must hold.
{
  const both = { isResetToProfile: () => true, detectOnboarding: () => ({ supportAreas: ['vision'] }) };
  check('reset wins over a self-description', kindOf('anything', both) === 'reset');

  const onb = { isResetToProfile: () => false, detectOnboarding: () => ({ supportAreas: ['vision'] }) };
  check('a self-description is onboarding', kindOf('anything', onb) === 'onboard');

  const none = { isResetToProfile: () => false, detectOnboarding: () => null };
  check('anything else goes to the controller', kindOf('anything', none) === 'controller');

  // A reset must settle the turn without the onboarding heuristic ever running:
  // "forget what I changed" would otherwise risk being read as a disclosure.
  let asked = false;
  routeTurn('back to my profile', { isResetToProfile: () => true, detectOnboarding: () => { asked = true; return null; } });
  check('a reset short-circuits the onboarding check', asked === false);
}

// ── what the controller's answer means ───────────────────────────────────────
{
  check('an accepted task is a task', classifyControllerResult({ ok: true, intent: { action: 'task' } }) === 'task');
  check('a REJECTED task is not a task', classifyControllerResult({ ok: false, intent: { action: 'task' } }) === 'say');
  check('an unrecognized intent falls through', classifyControllerResult({ intent: { type: 'unrecognized' } }) === 'unrecognized');
  check('a plain reply is said', classifyControllerResult({ ok: true, intent: { action: 'set' }, say: 'done' }) === 'say');
  check('a result with no intent is said', classifyControllerResult({ say: 'done' }) === 'say');
  check('a missing result is said, not thrown', classifyControllerResult(undefined) === 'say');
}

// ── the fallback explains why, and never over-promises ───────────────────────
{
  const off = fallbackHelp({ connected: false });
  check('with nothing connected, it says so', /nothing is connected/i.test(off));
  check('…and points at how to connect one', /browser-harness/.test(off));
  check('…and still lists what it CAN do', /bigger text/.test(off));

  const on = fallbackHelp({ connected: true });
  check('with an app connected, it does not claim nothing is connected', !/nothing is connected/i.test(on));
  check('…and still lists what it can do', /bigger text/.test(on));
}

// ── the general-answer prompt ────────────────────────────────────────────────
{
  const p = generalAnswerPrompt('how do I make this bigger?');
  check('the prompt carries the question', p.includes('how do I make this bigger?'));
  check('the prompt asks for a short plain answer', /2-3 sentences/.test(p) && /no markdown/.test(p));

  // Double quotes are flattened so a quoted question cannot break out of the
  // surrounding prompt structure.
  const quoted = generalAnswerPrompt('what does "read this" do?');
  check('double quotes in the question are neutralized', !quoted.split('User:')[1].includes('"'));
}

console.log(`\nChat turn routing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
