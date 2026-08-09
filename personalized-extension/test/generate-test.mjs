/**
 * Writing the task model from the person's own query.
 *
 * This module decides what the whole layer checks, so the cases below are the
 * ones where getting it wrong is silent. The expensive one is already on
 * record: a model built for a different task does not fail, it produces
 * confident contradictions about the task nobody is doing and holds the agent
 * on them until the hold times out. So the first thing asserted is that a model
 * knows which query it was written for, and the last is that a failure leaves
 * no model rather than a stale one.
 */
import * as G from '../extension/validation/generate.js';
import fs from 'node:fs';

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const EX = {
  demo: {
    task: 'a worked example',
    ask: 'do the example thing',
    tree: {
      id: '0',
      label: 'root',
      children: [
        { id: '1',
          label: 'first phase',
          children: [{ id: '1.1', label: 'a leaf', questions: [{ question: 'is it so?', cluster: 'facts', moment: 'Now', paradigm: 3 }] }] },
        { id: '2',
          label: 'second phase',
          children: [{ id: '2.1', label: 'another leaf', questions: [{ question: 'and this?', cluster: 'approve', moment: 'After', paradigm: 7 }] }] },
      ],
    },
  },
};

const PR = {
  'strong-stage1': 'TREE <<EXEMPLAR_TREE>> QUERY <<QUERY>> '
    + '<<NODE_LO>><<NODE_HI>><<LEAF_LO>><<LEAF_HI>><<TOP_LO>><<TOP_HI>><<DEPTH>>',
  'strong-questions': 'Q <<EXEMPLAR>> <<TASK>> <<ASK>> <<TREE>> <<SCOPE>>',
  'strong-coding': 'C <<TYPE_CARDS>> <<PARADIGM_CARDS>> <<EXEMPLAR>> <<MODEL>> '
    + '<<SCOPE>> <<TASK>> <<ASK>>',
  'strong-paradigm-cards': 'cards',
  'type-cards': 'types',
};

const TREE = {
  task: 'find out when the tower was finished',
  ask: 'when was it finished',
  tree: { id: '0',
    label: 'root',
    children: [
      { id: '1', label: 'find the page', children: [{ id: '1.1', label: 'search' }] },
      { id: '2', label: 'read it', children: [{ id: '2.1', label: 'find the date' }] },
    ] },
};

/** A caller that replies per stage, so each stage can be driven independently. */
function stub(replies, seen = []) {
  return async (prompt, opts) => {
    seen.push({ tag: opts.tag, prompt });
    const which = opts.tag.startsWith('gen-tree') ? 'tree'
      : (opts.tag.startsWith('gen-questions') ? 'questions' : 'coding');
    const r = replies[which];
    const out = typeof r === 'function' ? r(seen.length) : r;
    if (out instanceof Error) throw out;
    return typeof out === 'string' ? out : JSON.stringify(out);
  };
}

const QS = [{ nodeId: '1.1', questions: [{ question: 'did the search work?', why: 'w', whatTheAgentLoses: 'l' }] },
  { nodeId: '2.1', questions: [{ question: 'what date does it give?', why: 'w', whatTheAgentLoses: 'l' }] }];
const CODE = { codings: [
  { nodeId: '2.1', question: 'what date does it give?', cluster: 'facts', moment: 'Now', paradigm: 4, moneyMoving: false },
  { nodeId: '1.1', question: 'did the search work?', cluster: 'refine', moment: 'Now', paradigm: 2, moneyMoving: true },
] };

const run = async (replies, opts = {}) => {
  const seen = [];
  G.setAssets(PR, EX);
  G.setCaller(stub(replies, seen));
  const m = await G.generate(opts.query || 'when was the tower finished', opts);
  return { m, seen };
};


// ── the model knows what it was written for ─────────────────────────────────
{
  const { m, seen } = await run({ tree: TREE, questions: QS, coding: CODE });
  ok(m && m.generatedFor === 'when was the tower finished',
    'the model records the query it was written for');
  ok(typeof m.generatedAt === 'number', 'and when, so a stale one can be told');
  ok(seen[0].prompt.includes('when was the tower finished'),
    'the query reaches the first stage — without it the tree is about nothing');

  const qs = [...G.walk(m.tree)].flatMap((n) => n.questions || []);
  ok(qs.length === 2, 'questions are hung on their nodes');
  ok(qs.some((q) => q.question === 'what date does it give?'),
    'and they are the generated ones');
}

// ── the coding reaches the questions ────────────────────────────────────────
{
  const { m, seen } = await run({ tree: TREE, questions: QS, coding: CODE });
  const byQ = Object.fromEntries([...G.walk(m.tree)]
    .flatMap((n) => n.questions || []).map((q) => [q.question, q]));
  ok(byQ['what date does it give?'].cluster === 'facts', 'cluster is applied');
  ok(byQ['what date does it give?'].moment === 'Now', 'moment is applied');
  ok(byQ['did the search work?'].paradigm === 2, 'paradigm is applied, as a number');
  ok(byQ['did the search work?'].moneyMoving === true,
    'moneyMoving is applied — policy.js stops on it, so a model without it can '
    + 'only ever be stopped by a contradiction');
  ok(byQ['what date does it give?'].moneyMoving === false,
    'and it is false rather than missing when the coder said so');

  const coding = seen.find((s) => s.tag.startsWith('gen-coding'));
  ok(coding.prompt.includes('find out when the tower was finished'),
    'the coding stage is told the task — "is this hard to undo?" is meaningless without it');
  ok(/2\.1 \| .*read it.* \| "what date does it give\?"/.test(coding.prompt),
    'and the path, not just the node id, so a question is coded in its phase');
}

// ── a malformed reply costs a question, never the run ───────────────────────
{
  const { m } = await run({
    tree: TREE,
    questions: [{ nodeId: '1.1', questions: ['a bare string where an object belongs'] },
      { nodeId: '2.1', questions: [{ question: 'the good one' }] }],
    coding: CODE,
  });
  const qs = [...G.walk(m.tree)].flatMap((n) => n.questions || []);
  ok(m !== null, 'a bare string does not kill the generation');
  ok(qs.length === 1 && qs[0].question === 'the good one',
    'the malformed entry is dropped and the well-formed one survives');
}

{
  const { m } = await run({ tree: TREE, questions: new Error('502'), coding: CODE });
  ok(m === null, 'but a tree with no questions at all is not a model — it checks nothing');
}

{
  const { m } = await run({
    tree: TREE, questions: QS, coding: new Error('502 from the coder'),
  });
  const qs = [...G.walk(m.tree)].flatMap((n) => n.questions || []);
  ok(m !== null && qs.length === 2,
    'a failed coding pass keeps the questions — uncoded they still get asked');
  ok(qs.every((q) => !q.cluster), 'they just carry no coding');
}

// ── failures leave nothing rather than something wrong ──────────────────────
{
  const { m } = await run({ tree: { ask: 'x', tree: {} }, questions: QS, coding: CODE })
    .catch((e) => ({ m: e }));
  ok(m instanceof Error && /missing 'task'/.test(m.message),
    'a first stage missing a key is an error, not a half-model');
}

{
  G.setAssets(PR, EX);
  G.setCaller(null);
  ok(await G.generate('anything') === null,
    'no caller means no model, rather than a throw the agent has to catch');
}

{
  const sig = { aborted: false };
  const seen = [];
  G.setAssets(PR, EX);
  G.setCaller(async (p, o) => {
    seen.push(o.tag);
    if (o.tag === 'gen-tree') sig.aborted = true;   // a second run supersedes this one
    return JSON.stringify(o.tag === 'gen-tree' ? TREE : QS);
  });
  const m = await G.generate('the abandoned task', { signal: sig });
  ok(m === null, 'an aborted generation returns nothing');
  ok(seen.length === 1, 'and stops calling — it does not finish a task nobody is doing');
}

// ── the model arrives in pieces, early enough to be worth having ────────────
{
  const seenPartials = [];
  await run({ tree: TREE, questions: QS, coding: CODE },
    { onPartial: (m) => seenPartials.push(m) });

  ok(seenPartials.length > 1, 'the model is handed over as it is written, not only at the end');

  const first = seenPartials[0];
  const firstQs = [...G.walk(first.tree)].flatMap((n) => n.questions || []);
  ok(firstQs.length === 0 && (first.tree.children || []).length === 2,
    'the tree comes first — on its own it already says which phase a page is in');

  const withQs = seenPartials.find((m) =>
    [...G.walk(m.tree)].some((n) => (n.questions || []).length));
  ok(!!withQs, 'questions follow, before the coding is done');
  ok(seenPartials.indexOf(withQs) < seenPartials.length - 1,
    'and they are usable before the last piece lands, which is the whole point');

  const last = seenPartials[seenPartials.length - 1];
  ok([...G.walk(last.tree)].flatMap((n) => n.questions || []).some((q) => q.cluster),
    'the coding lands last and only adds insistence');
}

{
  // A caller holding a reference must not see it change underneath.
  const grabbed = [];
  const { m } = await run({ tree: TREE, questions: QS, coding: CODE },
    { onPartial: (x) => grabbed.push(x) });
  const firstQs = [...G.walk(grabbed[0].tree)].flatMap((n) => n.questions || []);
  ok(firstQs.length === 0 && [...G.walk(m.tree)].flatMap((n) => n.questions || []).length === 2,
    'each handover is a copy, so an early one does not mutate into the final model');
}

// ── the reply parser ────────────────────────────────────────────────────────
{
  ok(G.parseJson('```json\n{"a":1}\n```').a === 1, 'fences are tolerated');
  ok(G.parseJson('here you go: {"a":1} hope that helps').a === 1, 'so is prose around it');
  const long = G.parseJson('{"a":1} then {"b":2,"c":[3,4,5]}');
  ok(long.b === 2,
    'the longest complete value wins, so a truncated tail cannot beat a whole object');
  let threw = false;
  try { G.parseJson('no json here'); } catch { threw = true; }
  ok(threw, 'and no JSON is an error rather than a silent null');
}

// ── the shipped prompts are the measured prompts ────────────────────────────
//
// The whole claim for the live generator is that it runs the thing the rig
// scored against held-out gold. That claim rests on the two copies being the
// same text, and nothing was checking it - they had already drifted once, so
// the extension was generating with an older coding prompt than the one whose
// numbers were being quoted.
{
  const RIG = '/Users/chuanenl/Stanford/Summer Project Ideation /Verification '
    + 'Affordances/taskmodel/rig/prompts';
  if (!fs.existsSync(RIG)) {
    console.log('SKIP the rig is not on this machine, so drift cannot be checked');
  } else {
    const shipped = JSON.parse(
      fs.readFileSync('extension/validation/genprompts.json', 'utf8'));
    const pairs = [
      ['strong-stage1', 'strong-stage1.txt'],
      ['strong-questions', 'strong-questions.txt'],
      ['strong-coding', 'strong-coding.txt'],
      ['strong-paradigm-cards', 'strong-paradigm-cards.md'],
    ];
    for (const [key, file] of pairs) {
      const onDisk = fs.readFileSync(`${RIG}/${file}`, 'utf8');
      ok(shipped[key] === onDisk,
        `the shipped ${key} is the one the rig measured`);
    }
  }
}

console.log(`\n${pass}/${pass + fail} - the model is written from the query, and a failure `
  + 'leaves no model rather than one about another task.');
if (fail) process.exit(1);
