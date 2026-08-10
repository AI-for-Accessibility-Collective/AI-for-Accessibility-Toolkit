// The task model, written from the person's own query, at the moment they ask.
//
// ── why this file exists ────────────────────────────────────────────────────
//
// Until now the layer loaded `validation/taskmodel.json`, a file fixed at build
// time. So whatever the person typed, the questions being checked were the
// questions for some other task. A recorded run makes the consequence plain:
// someone asked when the Eiffel Tower was finished, the shipped model was for
// researching the Boeing 737 MAX, and the reasoner correctly reported that the
// agent was working on the wrong thing — then held the agent for four minutes
// until the hold timed out. The layer was right about the mismatch and the
// mismatch was ours.
//
// That is the same fault behind every off-task stop: "Is this the right
// country's Amazon? No, this is REI.com", "Is this actually Wikipedia? No, this
// is the BBC." None of those are page problems. They are a model built for one
// task being asked about another.
//
// A model generated from the query cannot disagree with the query, so the whole
// class of error goes away rather than being suppressed.
//
// ── what it costs, and how it is made to arrive in time ────────────────────
//
// The examples run to about sixty thousand tokens, so the whole model takes a
// few minutes. That is longer than many runs: a recorded Wikipedia lookup
// finished in ninety seconds, and a model delivered after the agent has stopped
// has checked nothing.
//
// So the model is handed over in pieces as they are written, through
// `onPartial`. The tree lands first, which is enough to say which phase a page
// belongs to. Each batch of questions lands next, phases in order, so the
// earliest part of the task can be checked while the later part is still being
// written. Coding arrives last and only adds insistence -- an uncoded question
// is still asked.
//
// Until the first piece arrives the layer runs without a model, which means it
// stays quiet. No model is a supported state and always was, and quiet is the
// honest state while there is nothing trustworthy to check against.
//
// ── it is the same generator that was measured ──────────────────────────────
//
// The prompts in `genprompts.json` and the examples in `exemplars.json` are
// copied verbatim out of the offline rig, so the thing running here is the
// thing whose coverage was measured against held-out gold. Stages 2, 4 and 6 —
// the gap-filling and type-coverage passes — are refinement and are skipped
// here, so live quality is a floor on the measured number, not equal to it.

const NUMWORD = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const LEAVES_PER_CALL = 12;

// How many worked examples the question and coding stages carry.
//
// These two stages resend their examples on every batch, and the examples are
// nearly the whole prompt: about 79k tokens for questions and 84k for coding,
// against 13k for the tree. That is what made the model take minutes to arrive.
//
// Scored in the rig before being cut: with one example instead of three, mean
// coverage across the four domains was 37.6% against 37.4%, a difference well
// inside run-to-run variance (amazon -1.6, flights -2.5, govforms +9.1,
// wikipedia -3.8). So the extra examples were not earning their cost here. The
// tree stage still gets all of them, because it is small and it is the one the
// agent waits for.
const EXAMPLES_FOR_QUESTIONS = 1;
const EXAMPLES_FOR_CODING = 1;
const QUESTIONS_PER_CALL = 24;
const GEN_TEMP = 0.3;

let PROMPTS = null;
let EXEMPLARS = null;
let caller = null;

/** The LLM. Same injection point as the reasoner, for the same reason. */
export function setCaller(fn) { caller = fn; }
export function hasCaller() { return typeof caller === 'function'; }

/** Prompts and worked examples, fetched once from the extension's own files. */
export async function loadAssets(fetcher) {
  if (PROMPTS && EXEMPLARS) return true;
  const get = fetcher || ((p) => fetch(chrome.runtime.getURL(p)).then((r) => r.json()));
  try {
    [PROMPTS, EXEMPLARS] = await Promise.all([
      get('validation/genprompts.json'), get('validation/exemplars.json'),
    ]);
    return true;
  } catch {
    PROMPTS = null; EXEMPLARS = null;
    return false;   // no assets is a supported state; the layer runs modelless
  }
}

export function setAssets(prompts, exemplars) { PROMPTS = prompts; EXEMPLARS = exemplars; }

// ── tree helpers, ported from the rig's common.py ───────────────────────────

export function* walk(node) {
  yield node;
  for (const c of node.children || []) yield* walk(c);
}
const leaves = (m) => [...walk(m.tree)].filter((n) => !(n.children || []).length);
const nodeById = (m, id) => [...walk(m.tree)].find((n) => String(n.id) === String(id)) || null;
const inScope = (id, prefixes) =>
  prefixes.some((p) => id === p || String(id).startsWith(`${p}.`));

function depth(node, d = 1) {
  const kids = node.children || [];
  return kids.length ? Math.max(...kids.map((c) => depth(c, d + 1))) : d;
}

function stripQuestions(model, { codingsOnly = false } = {}) {
  const m = JSON.parse(JSON.stringify(model));
  for (const n of walk(m.tree)) {
    if (codingsOnly) {
      for (const q of n.questions || []) {
        delete q.cluster; delete q.moment; delete q.exampleWidgets;
        delete q.paradigm; delete q.moneyMoving;
      }
    } else {
      delete n.questions;
    }
  }
  return m;
}

const modelJson = (m, keys = ['task', 'ask', 'tree']) =>
  JSON.stringify(Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, m[k]])), null, 2);

function block(models, heading, keys) {
  const parts = [heading.replace(/<<N>>/g, NUMWORD[models.length] || String(models.length))];
  for (const m of models) {
    parts.push(`### ${m.task || '(untitled task)'}\n\n${modelJson(m, keys)}`);
  }
  return parts.join('\n\n');
}

function fill(template, tokens) {
  let t = template;
  for (const [k, v] of Object.entries(tokens)) t = t.split(`<<${k}>>`).join(String(v));
  const left = t.match(/<<[A-Z_]+>>/g);
  if (left) throw new Error(`unfilled tokens: ${[...new Set(left)].join(', ')}`);
  return t;
}

/**
 * The size band the examples actually occupy — measured, not asserted, so the
 * first stage has a real number to check its draft against.
 */
function calibration(exs) {
  const st = exs.map((e) => ({
    nodes: [...walk(e.tree)].length,
    leaf: leaves(e).length,
    top: (e.tree.children || []).length,
    depth: depth(e.tree),
  }));
  const lo = (k) => String(Math.min(...st.map((s) => s[k])));
  const hi = (k) => String(Math.max(...st.map((s) => s[k])));
  return {
    NODE_LO: lo('nodes'), NODE_HI: hi('nodes'),
    LEAF_LO: lo('leaf'), LEAF_HI: hi('leaf'),
    TOP_LO: lo('top'), TOP_HI: hi('top'),
    DEPTH: hi('depth'),
  };
}

/** Leaves grouped by top-level phase, so each call's scope is contiguous. */
function leafChunks(model, size = LEAVES_PER_CALL) {
  const chunks = []; let cur = [];
  for (const phase of model.tree.children || []) {
    const lv = leaves(model).filter((n) => inScope(String(n.id), [String(phase.id)]));
    if (!lv.length) continue;
    if (cur.length && cur.length + lv.length > size) { chunks.push(cur); cur = []; }
    cur.push(...lv);
    if (cur.length >= size) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * The first complete JSON value in a reply, tolerating prose and fences.
 *
 * The rig's parser keeps the longest complete decode rather than the first,
 * because a truncated trailing object otherwise wins over a complete one.
 */
export function parseJson(text) {
  const s = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  let best = null;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{' && s[i] !== '[') continue;
    for (let j = s.length; j > i; j -= 1) {
      const c = s[j - 1];
      if (c !== '}' && c !== ']') continue;
      try {
        const v = JSON.parse(s.slice(i, j));
        if (best === null || j - i > best.len) best = { v, len: j - i };
        break;
      } catch { /* keep shrinking */ }
    }
  }
  if (!best) throw new Error('no JSON in reply');
  return best.v;
}

/**
 * Hang generated questions on their nodes.
 *
 * Anything not shaped like a question becomes one lost question rather than a
 * lost run. The rig learned this the expensive way: a bare string where an
 * object was expected threw out of the generator and killed eight of twelve
 * cells in a single run.
 */
function attachQuestions(model, qlist) {
  let attached = 0; const orphans = [];
  for (const entry of qlist || []) {
    if (!entry || typeof entry !== 'object') { orphans.push(entry); continue; }
    const node = nodeById(model, entry.nodeId);
    if (!node) { orphans.push(entry); continue; }
    if (!Array.isArray(entry.questions)) { orphans.push(entry); continue; }
    node.questions = node.questions || [];
    for (const q of entry.questions) {
      if (!q || typeof q !== 'object' || !q.question) {
        if (!q || typeof q !== 'object') orphans.push(q);
        continue;
      }
      node.questions.push({
        question: q.question, why: q.why || '',
        whatTheAgentLoses: q.whatTheAgentLoses || '',
      });
      attached += 1;
    }
  }
  return { attached, orphans };
}

function flattenQuestions(model) {
  const out = [];
  const rec = (n, path) => {
    const here = path ? `${path} > ${n.label || ''}` : (n.label || '');
    for (const q of n.questions || []) {
      out.push({ nodeId: n.id, path: here, question: q.question });
    }
    for (const c of n.children || []) rec(c, here);
  };
  rec(model.tree, '');
  return out;
}

function applyCodings(model, out) {
  const codings = Array.isArray(out) ? out : (out?.codings || []);
  let coded = 0; const unmatched = [];
  for (const c of codings) {
    if (!c || typeof c !== 'object') { unmatched.push(c); continue; }
    const node = nodeById(model, c.nodeId);
    const q = node && (node.questions || []).find((x) => x.question === c.question);
    if (!q) { unmatched.push(c); continue; }
    q.cluster = c.cluster;
    q.moment = c.moment;
    // Whether continuing past this step is hard to undo. policy.js escalates on
    // it before falling back to three Amazon phase names, so a model without it
    // can only ever be stopped by a contradiction.
    q.moneyMoving = c.moneyMoving === true;
    let p = c.paradigm;
    if (typeof p === 'string' && /^\d+$/.test(p.trim())) p = parseInt(p.trim(), 10);
    if (Number.isInteger(p) && p >= 1 && p <= 12) q.paradigm = p;
    q.exampleWidgets = c.exampleWidgets || [];
    coded += 1;
  }
  return { coded, unmatched };
}

// ── the stages ──────────────────────────────────────────────────────────────

async function call(prompt, tag) {
  const text = await caller(prompt, { temperature: GEN_TEMP, tag });
  return parseJson(text);
}

/**
 * Write a task model for this query.
 *
 * @param {string} query        what the person typed, verbatim
 * @param {{onStage?: Function, signal?: {aborted: boolean}}} opts
 * @returns {Promise<object|null>} the model, or null if it could not be written
 */
export async function generate(query, opts = {}) {
  const say = opts.onStage || (() => {});
  // Hand over whatever is written so far. Copied, because the caller loads it
  // while later stages keep mutating this one.
  const hand = (m, st = {}) => {
    if (!opts.onPartial) return;
    try { opts.onPartial(JSON.parse(JSON.stringify(m)), st); } catch { /* never fatal */ }
  };
  const stop = () => opts.signal?.aborted === true;
  if (!hasCaller()) return null;
  if (!(await loadAssets(opts.fetcher))) return null;

  const exs = Object.values(EXEMPLARS);
  if (!exs.length) return null;

  // ---- stage 1: the tree ----
  say({ stage: 'tree', of: 3 });
  const trees = exs.map((e) => stripQuestions(e));
  const model = await call(fill(PROMPTS['strong-stage1'], {
    EXEMPLAR_TREE: block(trees,
      'Here are <<N>> finished trees, one per task. The questions have been '
      + 'removed - this stage is only about the tree:'),
    QUERY: query,
    ...calibration(exs),
  }), 'gen-tree');
  for (const k of ['task', 'ask', 'tree']) {
    if (!(k in model)) throw new Error(`stage 1 output missing '${k}'`);
  }
  if (stop()) return null;
  // The tree alone already earns its keep: it is what says which phase a page
  // belongs to, and phase is what the insistence rules key on.
  model.generatedFor = query;
  hand(model);

  // ---- stage 3: the questions ----
  const qBlock = block(exs.slice(0, EXAMPLES_FOR_QUESTIONS)
    .map((e) => stripQuestions(e, { codingsOnly: true })),
    'Here are <<N>> finished task models, from <<N>> different tasks. Study '
    + 'the style of their questions.');
  const treeJson = modelJson(model);
  const chunks = leafChunks(model);
  let asked = 0;
  let landed = 0;
  // The batches do not depend on each other, so running them one after another
  // just multiplies the wait. Sequentially, generation never once finished
  // inside a recorded run - all four ended part way through this stage and the
  // coding stage never ran at all, so the layer spent every run checking
  // against a partial model. Together they take about as long as the slowest
  // one. Each is attached and handed over the moment it lands.
  await Promise.all(chunks.map(async (chunk, i) => {
    if (stop()) return;
    const scope = chunk.map((n) =>
      `${n.id} ${n.label || ''}${n.note ? ` - ${n.note}` : ''}`).join('\n');
    try {
      const qlist = await call(fill(PROMPTS['strong-questions'], {
        EXEMPLAR: qBlock, TASK: model.task, ASK: model.ask || '',
        TREE: treeJson, SCOPE: scope,
      }), `gen-questions-${i}`);
      if (stop()) return;
      asked += attachQuestions(model, qlist).attached;
      landed += 1;
      say({ stage: 'questions', of: 3, part: landed, parts: chunks.length });
      // Usable now, for the phases covered so far.
      hand(model);
    } catch (e) {
      // One chunk failing costs its questions, not the model.
      landed += 1;
      say({ stage: 'questions', of: 3, part: landed, parts: chunks.length, failed: e.message });
    }
  }));
  if (stop()) return null;
  if (!asked) return null;   // a tree with no questions checks nothing

  // ---- stage 5: the coding ----
  const cBlock = block(exs.slice(0, EXAMPLES_FOR_CODING),
    'Here are <<N>> fully coded models, from <<N>> different tasks, with every '
    + 'question carrying its cluster and its moment:');
  const modelJsonStr = modelJson(model);
  const qs = flattenQuestions(model);
  const codeChunks = [];
  for (let i = 0; i < qs.length; i += QUESTIONS_PER_CALL) {
    codeChunks.push({ i, qs: qs.slice(i, i + QUESTIONS_PER_CALL) });
  }
  let coded = 0;
  await Promise.all(codeChunks.map(async ({ i, qs: chunk }) => {
    if (stop()) return;
    // The path, not just the id. Coding in chunks means the model is otherwise
    // asked "is continuing past this hard to undo?" about a bare sentence with
    // no idea it sits under "Check out and pay".
    const scope = chunk.map((q) => `${q.nodeId} | ${q.path} | "${q.question}"`).join('\n');
    try {
      const out = await call(fill(PROMPTS['strong-coding'], {
        TYPE_CARDS: PROMPTS['type-cards'], PARADIGM_CARDS: PROMPTS['strong-paradigm-cards'],
        EXEMPLAR: cBlock, MODEL: modelJsonStr, SCOPE: scope,
        TASK: model.task || '', ASK: model.ask || '',
      }), `gen-coding-${i}`);
      if (stop()) return;
      applyCodings(model, out);
      coded += 1;
      say({ stage: 'coding', of: 3, part: coded, parts: codeChunks.length });
      hand(model);
    } catch (e) {
      // Uncoded questions still get asked; they just carry no paradigm and
      // cannot raise a money-moving stop.
      coded += 1;
      say({ stage: 'coding', of: 3, part: coded, parts: codeChunks.length, failed: e.message });
    }
  }));

  model.generatedFor = query;
  model.generatedAt = Date.now();
  say({ stage: 'done', of: 3, questions: asked, nodes: [...walk(model.tree)].length });
  return model;
}
