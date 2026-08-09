/**
 * A hold that nobody answers.
 *
 * Until this existed, a hold lasted forever: the agent kept looping against
 * maxSteps and the run was recorded as "reached max steps (50)". The cause —
 * a question nobody answered — appeared nowhere. So what is tested here is not
 * that the layer waits, but what it does with the waiting:
 *
 *   - the clock measures the wait, and restarts when the thing being waited on
 *     changes, because being asked a second question is not silence
 *   - the finding is said again exactly once
 *   - after the longer interval the run ends with the real reason, which the
 *     agent records instead of "Stopped by user"
 *   - and at no point does any of that let the agent through. The timeout is
 *     not an answer.
 *
 * Run: node test/hold-timeout-test.mjs
 */
import assert from 'node:assert';

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a chrome just real enough ────────────────────────────────────────────────
const local = new Map();
const sync = new Map();
const spoken = [];
const area = (m) => ({
  async get(keys) {
    const want = keys == null ? [...m.keys()]
      : (Array.isArray(keys) ? keys : [keys]);
    const out = {};
    for (const k of want) if (m.has(k)) out[k] = m.get(k);
    return out;
  },
  async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, v); },
  async remove(k) { m.delete(k); },
});
global.chrome = {
  storage: { local: area(local), sync: area(sync) },
  runtime: { sendMessage: async (msg) => { spoken.push(msg); } },
};

// What the layer stops when nobody answers.
const stops = [];
globalThis.BrowserAgent = { stop: (reason) => stops.push(reason) };

const { default: Validation, holdClock, WAITING_ON_YOU } =
  await import('../extension/validation/session.js');
const state = async () => (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};

// ── the clock itself, with no clock ──────────────────────────────────────────

const NOW = 1_000_000;
const T = { remindMs: 45_000, stopMs: 240_000 };

ok(holdClock(null, NOW, T).next === 'nothing', 'nothing waiting means nothing to do');
ok(holdClock({ on: 'Q', since: NOW - 1_000 }, NOW, T).next === 'nothing',
  'a hold a second old is just a hold');
ok(holdClock({ on: 'Q', since: NOW - 60_000 }, NOW, T).next === 'remind',
  'past the first interval the finding is said again');
ok(holdClock({ on: 'Q', since: NOW - 60_000, reminded: NOW - 5_000 }, NOW, T).next === 'nothing',
  'said again once, not on every step after that');
ok(holdClock({ on: 'Q', since: NOW - 300_000, reminded: NOW - 200_000 }, NOW, T).next === 'stop',
  'past the second interval the run ends');
ok(holdClock({ on: 'Q', since: NOW - 300_000, stopped: NOW - 10_000 }, NOW, T).next === 'nothing',
  'a run already ended is not ended twice');
ok(holdClock({ on: 'Q', since: NOW - 60_000 }, NOW, T).waitedMs === 60_000,
  'the wait it reports is the wait');

// ── the same clock, wired to a real session ─────────────────────────────────

Validation.setHoldTimeouts({ remindMs: 40, stopMs: 200 });

await Validation.start('girls flat sandals size 5 under $40');
// One unread finding is all it takes: publish() derives the hold from what the
// person has not seen, which is the path a real run takes.
await Validation.annotate({
  append: [{ widget: 'Which size went in?', level: 'stop', phase: 'Check item',
             say: 'Which size went in? Size 5 Toddler.', from: 'Size: 5 Toddler',
             confirming: false }],
});

const held = await state();
ok(held.gate?.allowed === false, 'an unread finding holds the agent');
ok(typeof held.hold?.since === 'number', 'the hold records when it started');
ok(held.hold?.on === 'Which size went in?', 'and what it is waiting on');

{
  const g = await Validation.allow('click add to cart');
  ok(g.allowed === false, 'a fresh hold stops the agent');
  ok(spoken.filter((m) => /Still waiting/.test(m.lines?.[0]?.say || '')).length === 0,
    'nothing is re-said before the first interval is up');
}

await sleep(60);
{
  await Validation.allow('scroll down');
  const again = spoken.filter((m) => /Still waiting/.test(m.lines?.[0]?.say || ''));
  ok(again.length === 1, 'past the first interval the finding is said again');
  ok(/Which size went in/.test(again[0].lines[0].say),
    'and what it says again is the finding, not a generic nag');
  ok(again[0].lines[0].live === 'assertive', 'said assertively, like the first time');
  await Validation.allow('scroll down');
  ok(spoken.filter((m) => /Still waiting/.test(m.lines?.[0]?.say || '')).length === 1,
    'every step after that is silent - once means once');
  ok((await state()).hold?.stopped == null, 're-saying it does not end the run');
  const g = await Validation.allow('click add to cart');
  ok(g.allowed === false, 'and it does not let the agent through either');
}

await sleep(220);
{
  const g = await Validation.allow('click add to cart');
  ok(stops.length === 1, 'past the second interval the run is stopped');
  ok(stops[0] === WAITING_ON_YOU, 'stopped with the real reason, not "max steps"');
  ok(/waiting on you/i.test(stops[0]), 'which says in the person\'s terms what happened');
  ok(g.allowed === false,
    'the timeout is not an answer - the gate is exactly as shut as it was');
  const s = await state();
  ok(s.endedBecause?.reason === WAITING_ON_YOU, 'the record says why the run ended');
  ok(s.endedBecause?.waitingOn === 'Which size went in?', 'and which question was never answered');
  await Validation.allow('click add to cart');
  ok(stops.length === 1, 'the run is not stopped again on every later step');
}

// ── the clock restarts when the question changes ─────────────────────────────
{
  const before = (await state()).hold.since;
  await Validation.acknowledge('Which size went in?|Check item|Which size went in? Size 5 Toddler.');
  await Validation.annotate({
    append: [{ widget: 'What is the total?', level: 'stop', phase: 'Review order',
               say: 'What is the total? $41.10.', from: 'Order total: $41.10',
               confirming: false }],
  });
  const now = await state();
  ok(now.hold?.on === 'What is the total?', 'a new question is a new hold');
  ok(now.hold.since >= before && now.hold.stopped == null,
    'and its clock starts over rather than inheriting a spent one');
}

// ── the agent records the reason it was given ───────────────────────────────
{
  const S = await import('../extension/browser-harness/src/agent/state.js');
  S.setStop(true, WAITING_ON_YOU);
  ok(S.shouldStop() === true, 'the agent is stopped');
  ok(S.stopReason() === WAITING_ON_YOU, 'and carries the reason into its own record');
  S.setStop(false);
  ok(S.stopReason() === null, 'clearing the stop clears the reason with it');
}

console.log(`\n${pass}/${pass + fail} - an unanswered hold ends the run saying so, and never opens the gate.`);
if (fail) process.exit(1);
