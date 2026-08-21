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
// How many trees the first stage shows. With four exemplars this was all of
// them; the pool now grows as pipeline HTAs land, and twenty trees would put
// the whole dataset in a prompt whose examples are meant to calibrate size.
const EXAMPLES_FOR_TREE = 4;
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

// ── which examples this query gets ──────────────────────────────────────────
//
// The exemplar pool is no longer four fixed golds: it is whatever domains the
// pipeline has produced HTAs for, re-exported as new ones land. The question
// and coding stages carry one example each, so which one matters — the rig
// measured 74% coverage with the matching example against 9-30% with a
// mismatched one. Scored lexically, no extra call: the words of the query
// against the words of each exemplar's task line, domain name and top-level
// labels. All-zero overlap keeps the pool's own order, which is the honest
// state for a task unlike anything in the pool.

// Two kinds of word carry no evidence about WHICH task this is: grammar, and
// the verbs any task instruction uses. Both are stopped. Domain-shared words
// like "book" are handled separately, by the document-frequency weighting in
// matchDomain - they carry some evidence, just less. What must never land
// here is a word that tells tasks apart: search, compare, appointment,
// refundable, settings.
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'you',
  'your', 'when', 'online', 'other', 'sites', 'site',
  'find', 'get', 'make', 'take', 'takes', 'pick', 'open', 'close', 'stop',
  'start', 'check', 'show', 'tell', 'give', 'look', 'need', 'want', 'help',
  'well', 'good', 'best', 'new', 'near', 'next', 'week', 'today', 'tomorrow',
  'before', 'after', 'only', 'but', 'who', 'how', 'what', 'where', 'anything',
  'something', 'please', 'complete', 'belong', 'variants', 'surface', 'pinned',
  'seeded', 'variant', 'app', 'web', 'screen']);

const tokens = (s) => new Set(String(s || '').toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));

/** Exemplars ranked by how much they look like this query, best first. */
export function pickExemplars(query, exemplars = EXEMPLARS) {
  const entries = Object.entries(exemplars || {});
  const q = tokens(query);
  const scored = entries.map(([name, ex], i) => {
    const own = tokens(`${name} ${ex.task || ''} `
      + (ex.tree?.children || []).map((c) => c.label || '').join(' '));
    let hits = 0;
    for (const w of q) if (own.has(w)) hits += 1;
    return { ex, hits, i };
  });
  scored.sort((a, b) => b.hits - a.hits || a.i - b.i);
  return scored.map((s) => s.ex);
}

// ── the retrieval tier ──────────────────────────────────────────────────────
//
// A query about a task the pipeline has already built an HTA for should not
// spend a minute generating a weaker model of the same task. The full models
// ship beside the exemplars (validation/htas/), and this decides whether one
// of them IS this task rather than merely the nearest example for writing a
// new one.
//
// The match is deliberately conservative, because a wrong tier-1 match is the
// exact failure the generated path was built to end: checking one task's
// pages against another task's questions. The scoring is the same lexical
// overlap as pickExemplars, and a domain only wins with at least two distinct
// word hits AND twice the runner-up. Anything short of that falls through to
// generation, which is never wrong about whose task it is.

const MATCH_MIN_SCORE = 2;
const MATCH_LEAD = 2;

/**
 * Which built domain this query IS, if any. Pure scoring, no fetch.
 *
 * Words are weighted by how many domains use them, because the real task
 * lines are long paragraphs and their generic verbs otherwise decide the
 * outcome. Found on real data: "book the earliest appointment on zocdoc"
 * scored doctor 3 (book, appointment, zocdoc) but privacy 2 on junk (find,
 * new), and the two-to-one lead rule vetoed the real match. A word unique to
 * one domain counts in full; a word shared by k domains counts 1/k. So a
 * match needs about two words that belong to that domain and no other, which
 * is also how a person would tell the tasks apart.
 */
export function matchDomain(query, index) {
  const entries = Object.entries(index || {});
  const own = entries.map(([domain, task]) => tokens(`${domain} ${task}`));
  const df = new Map();
  for (const set of own) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  const q = tokens(query);
  let best = null; let bestScore = 0; let second = 0;
  entries.forEach(([domain], i) => {
    let score = 0;
    for (const w of q) if (own[i].has(w)) score += 1 / df.get(w);
    if (score > bestScore) { second = bestScore; bestScore = score; best = domain; }
    else if (score > second) { second = score; }
  });
  if (!best || bestScore < MATCH_MIN_SCORE || bestScore < second * MATCH_LEAD) return null;
  return best;
}

// ── adapting a retrieved model to THIS request ──────────────────────────────
//
// A built model's questions were written for the KIND of task, from
// recordings of other people, before this person typed anything. Two things
// follow, and a live run produced both on its first night: a question can
// bake in a default the request contradicts ("are the default settings of
// one adult and one room correct?" against a request for 2 adults - the
// layer flagged a correct page as a mismatch), and a request can carry a
// constraint no question covers ("breakfast included", "near the convention
// center"). One call fixes both: it returns a small patch - rewrites and
// additions - which is applied deterministically here, so the model's
// structure can never be corrupted by a generation hiccup.

const MAX_REWRITES = 20;
const MAX_ADDITIONS = 8;
const MOMENTS = new Set(['Now', 'After', 'Completion', 'On demand']);

const ADAPT_PROMPT = `A person just typed this request:
"<<QUERY>>"

Below is every verification question for this KIND of task, written before \
anyone knew this person's request, one per line as \`id | question\`.

<<QUESTIONS>>

Two jobs, and only these:

1. "rewrites" - questions whose wording assumes a default or a detail this \
request contradicts. Rewrite each to fit THIS request while checking the same \
thing. Do not rewrite questions that are merely generic - a generic question \
is fine; a WRONG assumption is not. [{"id": "...", "question": "..."}]

2. "additions" - constraints stated in the request that NO question above \
covers. Write at most <<MAX>> new questions, each hung on the id of the \
existing subtask where it belongs. \
[{"nodeId": "...", "question": "...", "why": "...", \
"moment": "Now"|"After"|"Completion"|"On demand", "moneyMoving": true|false}]

Return only JSON: {"rewrites": [...], "additions": [...]}. Empty arrays when \
nothing needs it.`;

/** Where a flat question id lives on the tree: its node, and which question. */
function resolveFlatId(model, flatId) {
  const s = String(flatId);
  const hash = s.lastIndexOf('#');
  const nodeId = hash > 0 ? s.slice(0, hash) : s;
  const idx = hash > 0 ? parseInt(s.slice(hash + 1), 10) - 1 : 0;
  const node = nodeById(model, nodeId);
  if (!node || !Array.isArray(node.questions) || idx < 0 || idx >= node.questions.length) {
    return null;
  }
  return { node, idx };
}

/**
 * Apply a patch to a model, refusing anything malformed. Pure bookkeeping:
 * every accepted change lands exactly where the id says, every rejected one
 * is counted, and nothing else on the model moves.
 */
export function applyAdaptations(model, patch) {
  const out = { rewritten: 0, added: 0, skipped: 0 };
  for (const r of (patch?.rewrites || []).slice(0, MAX_REWRITES)) {
    const hit = r && typeof r.question === 'string' && r.question.trim()
      ? resolveFlatId(model, r.id) : null;
    if (!hit) { out.skipped += 1; continue; }
    const q = hit.node.questions[hit.idx];
    // The original wording is kept on the question: the rewrite is this
    // run's view, and the bank's wording is the provenance.
    q.originalQuestion = q.originalQuestion || q.question;
    q.question = r.question.trim();
    q.adapted = true;
    out.rewritten += 1;
  }
  for (const a of (patch?.additions || []).slice(0, MAX_ADDITIONS)) {
    if (!a || typeof a.question !== 'string' || !a.question.trim()) {
      out.skipped += 1; continue;
    }
    const node = nodeById(model, a.nodeId) || model.tree;
    node.questions = node.questions || [];
    node.questions.push({
      question: a.question.trim(),
      why: typeof a.why === 'string' ? a.why : 'stated in the request',
      whatTheAgentLoses: '',
      moment: MOMENTS.has(a.moment) ? a.moment : 'Now',
      moneyMoving: a.moneyMoving === true,
      fromAsk: true,
    });
    out.added += 1;
  }
  return out;
}

/**
 * One call that fits a retrieved model to the person's request.
 *
 * Never throws and never returns a half-model: on any failure the original
 * model is returned untouched, which is exactly the state before this
 * existed. The patch shape keeps the call's output small, so this runs in
 * seconds where full generation runs in minutes.
 */
export async function adaptModel(model, query, opts = {}) {
  const callFn = opts.caller || caller;
  if (typeof callFn !== 'function' || !query) return { model, rewritten: 0, added: 0 };
  const m = JSON.parse(JSON.stringify(model));
  try {
    const lines = [];
    const rec = (n) => {
      const qs = Array.isArray(n.questions) ? n.questions : [];
      qs.forEach((q, i) => {
        lines.push(`${qs.length > 1 ? `${n.id}#${i + 1}` : String(n.id)} | ${q.question}`);
      });
      for (const c of n.children || []) rec(c);
    };
    rec(m.tree);
    const prompt = ADAPT_PROMPT
      .split('<<QUERY>>').join(String(query).slice(0, 500))
      .split('<<QUESTIONS>>').join(lines.join('\n'))
      .split('<<MAX>>').join(String(MAX_ADDITIONS));
    const text = await callFn(prompt, { temperature: GEN_TEMP, tag: 'adapt' });
    const patch = parseJson(text);
    const r = applyAdaptations(m, patch);
    return { model: m, ...r };
  } catch (e) {
    return { model, rewritten: 0, added: 0, error: String(e?.message || e).slice(0, 120) };
  }
}

/**
 * The built model for this query, or null if no built domain matches.
 *
 * @returns {Promise<{domain, source, model}|null>} `source` is the extension
 *   path the model was fetched from, which is what rehydrate() refetches
 *   after a worker restart.
 */
export async function retrieveModel(query, fetcher) {
  const get = fetcher || ((p) => fetch(chrome.runtime.getURL(p)).then((r) => r.json()));
  let index;
  try { index = await get('validation/htas/index.json'); } catch { return null; }
  const domain = matchDomain(query, index);
  if (!domain) return null;
  try {
    const source = `validation/htas/${domain}.json`;
    const model = await get(source);
    if (!model?.tree) return null;
    return { domain, source, model };
  } catch { return null; }
}

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

  // Ranked by likeness to the query, so the one example the question and
  // coding stages carry is the nearest thing the pool has to this task.
  const exs = pickExemplars(query);
  if (!exs.length) return null;

  // ---- stage 1: the tree ----
  say({ stage: 'tree', of: 3 });
  const treeExs = exs.slice(0, EXAMPLES_FOR_TREE);
  const trees = treeExs.map((e) => stripQuestions(e));
  const model = await call(fill(PROMPTS['strong-stage1'], {
    EXEMPLAR_TREE: block(trees,
      'Here are <<N>> finished trees, one per task. The questions have been '
      + 'removed - this stage is only about the tree:'),
    QUERY: query,
    // The size band comes from the trees actually shown, not the whole pool.
    ...calibration(treeExs),
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
  // Coding, built once and used twice: behind each batch of questions as it
  // lands, and again at the end for anything those missed.
  const cBlock = block(exs.slice(0, EXAMPLES_FOR_CODING),
    'Here are <<N>> fully coded models, from <<N>> different tasks, with every '
    + 'question carrying its cluster and its moment:');
  const codedAlready = new Set();
  let codedCalls = 0;

  const codeThese = async (m, questions, tag) => {
    if (!questions.length || stop()) return;
    // The path, not just the id. Coding in chunks means the model is otherwise
    // asked "is continuing past this hard to undo?" about a bare sentence with
    // no idea it sits under "Check out and pay".
    const scope = questions.map((q) => `${q.nodeId} | ${q.path} | "${q.question}"`).join('\n');
    try {
      const out = await call(fill(PROMPTS['strong-coding'], {
        TYPE_CARDS: PROMPTS['type-cards'], PARADIGM_CARDS: PROMPTS['strong-paradigm-cards'],
        EXEMPLAR: cBlock, MODEL: modelJson(m), SCOPE: scope,
        TASK: m.task || '', ASK: m.ask || '',
      }), tag);
      if (stop()) return;
      applyCodings(m, out);
      for (const q of questions) codedAlready.add(q.question);
      codedCalls += 1;
      say({ stage: 'coding', of: 3, part: codedCalls });
      hand(m);
    } catch (e) {
      // Uncoded questions still get asked; they just carry no paradigm and
      // cannot raise a money-moving stop.
      codedCalls += 1;
      say({ stage: 'coding', of: 3, part: codedCalls, failed: e.message });
    }
  };

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

      // Code these questions now rather than after every other batch lands.
      // Coding sets `moneyMoving`, and `moneyMoving` is what stops the agent
      // before something that cannot be undone. As its own stage at the end it
      // finished at 125 to 171 seconds in the recorded runs and in one run not
      // at all, so for most of every run the rule the design turns on was not
      // armed. A phase's own questions are all that is needed to code it.
      const ids = chunk.map((n) => String(n.id));
      await codeThese(model,
        flattenQuestions(model).filter((q) => ids.includes(String(q.nodeId))
          && !codedAlready.has(q.question)),
        `gen-coding-q${i}`);
    } catch (e) {
      // One chunk failing costs its questions, not the model.
      landed += 1;
      say({ stage: 'questions', of: 3, part: landed, parts: chunks.length, failed: e.message });
    }
  }));
  if (stop()) return null;
  if (!asked) return null;   // a tree with no questions checks nothing

  // ---- whatever the per-batch coding did not reach ----
  const left = flattenQuestions(model).filter((q) => !codedAlready.has(q.question));
  const sweeps = [];
  for (let i = 0; i < left.length; i += QUESTIONS_PER_CALL) {
    sweeps.push(left.slice(i, i + QUESTIONS_PER_CALL));
  }
  await Promise.all(sweeps.map((c, i) => codeThese(model, c, `gen-coding-rest-${i}`)));

  model.generatedFor = query;
  model.generatedAt = Date.now();
  say({ stage: 'done', of: 3, questions: asked, nodes: [...walk(model.tree)].length });
  return model;
}
