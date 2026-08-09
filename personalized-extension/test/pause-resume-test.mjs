/**
 * Pausing the agent, and letting it go again.
 *
 * This drives the SHIPPED loop — run.js, with the harness and the model call
 * stubbed — rather than testing the flag in isolation, because the whole
 * argument for putting the check at the top of an iteration is about where in
 * the iteration it sits. A test of the flag alone would pass with the check in
 * the wrong place.
 *
 * What it covers:
 *   - a pause stops the loop before the next step begins, so no model call and
 *     no action happen while it is held
 *   - waiting costs no steps: a long pause does not eat the run's budget
 *   - resume lets it go again, and by default the next turn is told the page
 *     was read again, so a decision made against the old page is not carried
 *     over. A staged retry from before the pause is dropped.
 *   - resume({rePerceive: false}) says nothing, for the caller who means it
 *   - stopping while paused ends the run rather than deadlocking it
 *
 * Run: node test/pause-resume-test.mjs
 */
let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a chrome and a browser, just real enough to run a loop ───────────────────
const local = new Map();
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const want = keys == null ? [...local.keys()] : (Array.isArray(keys) ? keys : [keys]);
        const out = {};
        for (const k of want) if (local.has(k)) out[k] = local.get(k);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) local.set(k, v); },
      async remove(k) { local.delete(k); },
    },
  },
  tabs: { async get(id) { return { id, url: 'https://example.com/', title: 'x' }; } },
  runtime: { async sendMessage() {} },
};

// Everything the loop asks the browser for. Each call is counted, because what
// is being asked is whether the loop touches the page at all while held.
const seen = { enumerate: 0, screenshot: 0, actions: [] };
globalThis.BrowserHarness = {
  async attach() {}, async detach() {},
  async waitForLoad() { return true; },
  async enumerateInteractive() { seen.enumerate += 1; return { items: [], structurals: [] }; },
  async captureScreenshot() { seen.screenshot += 1; return { data: 'AAA', scale: 1, width: 10, height: 10 }; },
  async wait(ms) { return sleep(Math.min(ms, 1)); },
  setAgentBusy() {},
  healthSnapshot() { return {}; },
};

const {
  bhAgentRun, bhAgentPause, bhAgentResume, bhAgentStop, bhAgentIsPaused,
} = await import('../extension/browser-harness/src/agent/run.js');
const S = await import('../extension/browser-harness/src/agent/state.js');

// The model. Each turn returns whatever the script says next; every prompt is
// kept so the test can ask what the agent was told.
let script = [];
const prompts = [];
S.setGeminiCaller(async (prompt) => {
  prompts.push(prompt);
  const next = script.length > 1 ? script.shift() : script[0];
  return typeof next === 'function' ? next() : next;
});

const WAIT = JSON.stringify({ next_goal: 'look around', action: 'wait', seconds: 0 });
const DONE = JSON.stringify({ next_goal: 'finish', action: 'done', summary: 'all done' });
const state = async () => (await chrome.storage.local.get('bhAgent')).bhAgent || {};

// ── held before the step begins ─────────────────────────────────────────────
{
  seen.enumerate = 0; seen.screenshot = 0; prompts.length = 0;
  // Pause from inside the first turn: the model call for step 1 is in flight,
  // so what must not happen is a second one.
  let turns = 0;
  script = [() => { turns += 1; bhAgentPause({ reason: 'let me read this' }); return WAIT; }];

  const run = bhAgentRun('look at a page', { tabId: 7, maxSteps: 40 });
  await sleep(250);

  ok(bhAgentIsPaused() === true, 'the agent is held');
  ok(turns === 1, 'no further model call happens while it is held');
  const enumAtPause = seen.enumerate;
  const stepAtPause = S.getStep();
  ok((await state()).status === 'paused', 'the run says it is paused, not that it is running');

  // Long enough to have burned several steps had it been looping.
  await sleep(400);
  ok(turns === 1, 'still nothing, however long it waits');
  ok(seen.enumerate === enumAtPause, 'and the page is not being touched either');
  ok(S.getStep() === stepAtPause,
    'waiting costs no steps - it stands at the step it has not started');

  script = [DONE];
  const r = bhAgentResume();
  ok(r.resumed === true && r.rePerceive === true, 'resume lets it go, re-perceiving by default');
  const out = await run;
  ok(out.summary === 'all done', 'and the run finishes normally afterwards');
  ok(turns === 1, 'the scripted turn count is what it should be');
  ok(seen.enumerate > enumAtPause && seen.screenshot > 0,
    'the step after the pause enumerates and screenshots afresh');
  const after = prompts[prompts.length - 1];
  ok(/read again after a pause/i.test(after),
    'and the model is told the page was read again, in its own turn');
  ok(/not from what you saw before the pause/i.test(after),
    'told plainly not to act on what it saw before');
}

// ── a staged retry from before the pause is dropped ─────────────────────────
{
  prompts.length = 0;
  // Turn 1 comes back as something that cannot be parsed. That normally
  // stages the raw text and the error into the NEXT prompt so the model can
  // correct itself - which, across a pause, means correcting an action chosen
  // against a page that may no longer be there.
  let turn = 0;
  script = [() => {
    turn += 1;
    // Turn 2 fails the same way AND pauses, so the retry is still staged when
    // the person takes hold of it.
    if (turn === 2) bhAgentPause({ reason: 'wait' });
    return turn <= 2 ? 'not json at all {{{' : DONE;
  }];

  const run = bhAgentRun('look again', { tabId: 8, maxSteps: 40 });
  await sleep(400);
  ok(/Previous attempt failed/.test(prompts[1] || ''),
    'without a pause the failed attempt is echoed back for correction');
  ok(bhAgentIsPaused() === true, 'and the run is held with that retry still staged');

  bhAgentResume({ rePerceive: true });
  await run;
  const after = prompts[prompts.length - 1];
  ok(!/Previous attempt failed/.test(after),
    'across a pause it is not - a retry decided against the old page is dropped');
}

// ── the caller who does not want to be told ─────────────────────────────────
{
  prompts.length = 0;
  script = [() => { bhAgentPause({}); return WAIT; }];
  const run = bhAgentRun('third', { tabId: 9, maxSteps: 40 });
  await sleep(250);
  script = [DONE];
  const r = bhAgentResume({ rePerceive: false });
  ok(r.rePerceive === false, 'resume can be told not to re-perceive');
  await run;
  ok(!/read again after a pause/i.test(prompts[prompts.length - 1]),
    'and then nothing is said about the pause');
}

// ── stop while held ─────────────────────────────────────────────────────────
{
  script = [() => { bhAgentPause({ reason: 'thinking' }); return WAIT; }];
  const run = bhAgentRun('fourth', { tabId: 10, maxSteps: 40 });
  await sleep(250);
  ok(bhAgentIsPaused() === true, 'held again');
  bhAgentStop('Waiting on you.');
  const out = await run;
  ok(out.stopped === true, 'stopping while held ends the run rather than deadlocking it');
  ok(out.reason === 'Waiting on you.', 'and the reason given is the reason recorded');
  ok((await state()).summary === 'Waiting on you.', 'which is what the run itself says');
  ok(bhAgentIsPaused() === false, 'the pause does not outlive the run');
}

// ── pausing nothing ─────────────────────────────────────────────────────────
{
  const r = bhAgentPause({ reason: 'nobody is running' });
  ok(r.paused === false && /no run/.test(r.why),
    'pausing when nothing is running says so instead of arming a flag');
}

// ── resuming nothing ────────────────────────────────────────────────────────
{
  const r = bhAgentResume({ rePerceive: true });
  ok(r.resumed === false && /no run/.test(r.why),
    'resuming when nothing is running says so rather than arming a flag');
  prompts.length = 0;
  script = [DONE];
  await bhAgentRun('fifth', { tabId: 11, maxSteps: 40 });
  ok(!/read again after a pause/i.test(prompts[0] || ''),
    'so the next run does not open by announcing somebody else\'s pause');
}

console.log(`\n${pass}/${pass + fail} - a pause holds the loop where nothing is in flight and resume re-reads the page.`);
if (fail) process.exit(1);
