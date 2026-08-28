// Controller M3 test — the optional LLM lane. Uses a FAKE complete() (no real
// model) so it's deterministic and offline. Proves: the grammar wins first (LLM
// not called), free-form phrasing routes through the lane, and the lane cannot
// invent settings, exceed capabilities, or survive a bad/absent response.
//
//   node toolkit/test/controller-llm.test.mjs

import { createLlmLane } from '../llm-lane.js';
import { createController } from '../createController.js';
import { createMockReceiver } from '../mock-receiver.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// A fake model: routes on the utterance embedded in the prompt, returns canned
// JSON (sometimes wrapped in prose, to test extraction). Counts its calls.
function fakeModel(map) {
  const state = { calls: 0, lastPrompt: '' };
  const complete = async (prompt) => {
    state.calls++;
    state.lastPrompt = prompt;
    for (const [needle, out] of map) {
      if (prompt.includes(needle)) return out;
    }
    return '{"type":"none"}';
  };
  return { complete, state };
}

async function run() {
  // ── 1. Grammar wins first — the LLM lane is not consulted ─────────────────
  {
    const model = fakeModel([]);
    const c = createController({ control: createMockReceiver(), llm: createLlmLane({ complete: model.complete }) });
    const r = await c.handle('dark mode'); // grammar hit
    check('short-circuit: grammar hit applies', r.ok);
    check('short-circuit: LLM not called on a grammar hit', model.state.calls === 0);
  }

  // ── 2. Free-form phrasing routes through the lane ─────────────────────────
  {
    const model = fakeModel([
      ['too small to read', 'Sure — {"type":"adapt","deltas":{"fontScale":20},"say":"Making text bigger"} done'],
    ]);
    const recv = createMockReceiver();
    const c = createController({ control: recv, llm: createLlmLane({ complete: model.complete }) });
    const r = await c.handle('everything is way too small to read'); // grammar miss
    check('lane: JSON-in-prose is extracted and applied', r.ok && recv.settings.fontScale === 120);
    check('lane: LLM was consulted on the miss', model.state.calls === 1);
    check('lane: prompt offers only supported keys', /fontScale/.test(model.state.lastPrompt));
  }

  // ── 3. Safety — cannot invent a setting key ───────────────────────────────
  {
    const model = fakeModel([
      ['telepathy', '{"type":"adapt","changes":{"telepathy":true},"say":"ok"}'],
    ]);
    const recv = createMockReceiver();
    const c = createController({ control: recv, llm: createLlmLane({ complete: model.complete }) });
    const r = await c.handle('please enable telepathy'); // grammar miss → lane → invalid
    check('safety: unknown setting is filtered → unrecognized', r.ok === false && !('telepathy' in recv.settings));
  }

  // ── 4. Safety — command gated by receiver capabilities ────────────────────
  {
    const model = fakeModel([['launch', '{"type":"command","action":"scroll","target":"down"}']]);
    const recvNo = createMockReceiver({ actions: [] });
    const cNo = createController({ control: recvNo, llm: createLlmLane({ complete: model.complete }) });
    check('safety: command refused when receiver lacks the action', (await cNo.handle('launch it')).ok === false);

    const recvYes = createMockReceiver({ actions: ['scroll'] });
    const cYes = createController({ control: recvYes, llm: createLlmLane({ complete: model.complete }) });
    check('lane: command performs when supported', (await cYes.handle('launch it')).ok);
  }

  // ── 5. Query via the lane ─────────────────────────────────────────────────
  {
    const model = fakeModel([['read the article', '{"type":"query","ask":"content","mode":"text"}']]);
    const c = createController({ control: createMockReceiver(), llm: createLlmLane({ complete: model.complete }) });
    const r = await c.handle('could you read the article for me');
    check('lane: query content reads text', r.ok && /demo document/i.test(r.say));
  }

  // ── 6. Robustness — "none", junk, and thrown errors fall through ──────────
  {
    const none = fakeModel([]); // default returns {"type":"none"}
    const c1 = createController({ control: createMockReceiver(), llm: createLlmLane({ complete: none.complete }) });
    check('robust: "none" → unrecognized', (await c1.handle('tell me a joke')).ok === false);

    const junk = { complete: async () => 'no json here at all' };
    const c2 = createController({ control: createMockReceiver(), llm: createLlmLane({ complete: junk.complete }) });
    check('robust: non-JSON response → unrecognized', (await c2.handle('mystery input')).ok === false);

    const boom = { complete: async () => { throw new Error('model down'); } };
    const c3 = createController({ control: createMockReceiver(), llm: createLlmLane({ complete: boom.complete }) });
    const r = await c3.handle('another mystery');
    check('robust: lane error is swallowed → unrecognized, not a crash', r.ok === false);
  }

  console.log(`\nController M3 (LLM lane): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
