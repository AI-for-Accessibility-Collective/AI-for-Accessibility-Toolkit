/**
 * The widget press path, driven through the real overlay in a real DOM.
 *
 * Reading the code was not enough here. Twice while writing this the code was
 * right and my idea of it was wrong: a finding held at the gate is deliberately
 * kept out of the queue and rendered as the gate prompt instead, and the whole
 * surface stays hidden until the state carries a contract. Both look like a
 * dead button from the outside. So this drives the shipped module, clicks the
 * button an actual person would click, and asserts on what fires.
 *
 * What it covers:
 *   - a finding renders its control pair, and the provenance line under it
 *   - pressing fires the instruction BEFORE the acknowledgement, which is the
 *     order that matters: acknowledging first releases the hold and lets the
 *     agent move before the instruction has landed
 *   - a held finding renders as an alertdialog, assertively, with a decline
 *     that means stop rather than "understood"
 *   - every interface type carries the option pair its card specifies
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.amazon.com/dp/X' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'getComputedStyle']) {
  global[k] = k === 'window' ? dom.window : (k === 'document' ? dom.window.document : dom.window[k]);
}
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

const { AgentWatch } = await import('../../tools/adapters/agent-watch.js');
const { toFindings } = await import('../extension/validation/reasoner.js');

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const MODEL = { vision: {}, cognition: {}, motor: {}, hearing: {} };
const FINDING = {
  widget: 'Which size went in?',
  phase: 'Check item',
  say: 'Which size went in? Size 5 Toddler.',
  from: 'Size: 5 Toddler',
  level: 'stop',
  paradigm: null,
  control: { label: 'Read me where it says that', action: 'facts-source', decline: 'Got it' },
};
// `contract` is what takes the surface out of its idle state. Without it the
// overlay renders nothing at all and every assertion below reads as a dead
// button rather than as a missing field.
const BASE = {
  phase: 'Check item',
  ask: 'flat sandals size 5 under $40',
  contract: { item: 'sandals', size: '5', budget: 40 },
  findings: [FINDING],
  acknowledged: [], steps: [], said: [],
};

const drive = (state) => {
  const calls = [];
  AgentWatch.onControl = (c) => calls.push({ kind: 'control', action: c.action });
  AgentWatch.onAcknowledge = (k) => calls.push({ kind: 'ack', key: k });
  AgentWatch.settled = new Set();
  AgentWatch.spoken = new Set();
  AgentWatch.model = MODEL;
  AgentWatch.update(state);
  return { calls, root: AgentWatch.root };
};

AgentWatch.enable({ model: MODEL });

// ── a finding nobody is held on ───────────────────────────────────────────────
{
  const { calls, root } = drive({ ...BASE });
  const labels = [...root.querySelectorAll('button')].map((b) => b.textContent.trim());
  ok(labels.includes('Read me where it says that'), 'the control the type asks for is on screen');
  ok(labels.includes('Got it'), 'the decline is on screen beside it');
  ok(root.querySelector('.aw-from')?.textContent === 'Size: 5 Toddler',
    'the provenance line carries the page\'s own words');

  const primary = [...root.querySelectorAll('button')]
    .find((b) => /Read me where/.test(b.textContent));
  primary.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  ok(calls.length === 2, 'one press does exactly two things');
  ok(calls[0]?.kind === 'control' && calls[0].action === 'facts-source',
    'the instruction goes first, carrying the type\'s action');
  ok(calls[1]?.kind === 'ack', 'the acknowledgement goes second, never first');
  ok(String(calls[1]?.key).startsWith('Which size went in?'),
    'the acknowledgement names the finding it settles');
}

// ── the same finding, held at the gate ────────────────────────────────────────
{
  const { root } = drive({
    ...BASE,
    gate: { allowed: false, waitingOn: ['Which size went in?'],
      say: 'Waiting for you: Which size went in?' },
  });
  const gate = root.querySelector('.aw-gate');
  ok(!!gate, 'a held finding renders as the gate, not as a queued aside');
  ok(gate?.getAttribute('role') === 'alertdialog', 'the gate is an alertdialog');
  ok(gate?.getAttribute('aria-live') === 'assertive',
    'the gate interrupts rather than waiting for a gap');
  const labels = [...gate.querySelectorAll('button')].map((b) => b.textContent.trim());
  ok(!labels.includes('Got it'),
    'declining a hold does not mean "understood"');
}

// ── every interface type gets the pair its card specifies ─────────────────────
{
  // From exemplar/type-cards.md, which is the spec for what each type offers.
  const CARD = {
    facts: ['Read me where it says that', 'Got it'],
    refine: ['Narrow it down', 'Keep them all'],
    compare: ['Read me the differences', 'Fine as is'],
    select: ['Read me the options', 'You pick'],
    approve: ['Hold on, check it with me', 'Go ahead'],
    photos: ['Describe the photos', 'Got it'],
    receipts: ['Read it back to me', 'Got it'],
    undo: ['Undo it', 'Leave it'],
    'hand over': ['Let me do this part', 'Carry on'],
    watch: ['Watch it for me', 'Decide now'],
  };
  const types = Object.keys(CARD);
  const findings = toFindings({
    alignedNodes: ['2.0'],
    noticed: [],
    answers: types.map((t, i) => ({
      node: `2.${i}`, question: `Q ${t}?`, answer: 'the page says X', quote: 'X',
      verify: 'verified_exact', cluster: t, moment: 'Now', confidence: 0.9,
    })),
  }, 'Check item');

  ok(findings.length === types.length, 'every type produces a finding');
  for (const f of findings) {
    const [label, decline] = CARD[f.cluster];
    ok(f.control?.label === label && f.control?.decline === decline,
      `${f.cluster} offers "${label}" / "${decline}"`);
  }
}

console.log(`${pass}/${pass + fail} - a widget press reaches the agent before it releases the hold.`);
if (fail) process.exit(1);
