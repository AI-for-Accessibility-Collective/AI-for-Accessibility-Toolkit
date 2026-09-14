// The trace, keyed to task model nodes.
//
// There were two records before this and neither one let you go back.
//
//   * The agent's `history` array lives for the length of a run and is
//     destroyed as it goes: past 30,000 rendered characters, history.js splices
//     out the middle and replaces it with a model-written summary. The
//     originals are gone.
//   * chrome.storage.local.bhAgent keeps the last 200 log entries, each one an
//     action name and a human sentence — a narration of the run, not something
//     you could look anything up in.
//
// Findings already carry `node`, `cluster`, `moment` and `verified`, and until
// now nothing read any of them. This is what reads them. Keying to nodes rather
// than to step indices is what turns "go back to where the size was chosen"
// into a lookup instead of a scan, and it is what makes a moment addressable:
// a moment belongs to a node.
//
// ── what going back can honestly mean ───────────────────────────────────────
//
// Going back in the trace re-opens a DECISION. It does not undo anything in the
// world. Once an order is placed or a form is submitted, every entry here can be
// read back and nothing outside the browser has moved. Where the world has
// already moved, the only real remedy is the site's own cancel path, which is a
// task in itself, can fail, and sometimes does not exist.
//
// So nothing in this file is called rewind or undo, and nothing here takes an
// action. It reads. A surface that showed re-opening a decision and undoing an
// action the same way would be promising something the system cannot do.

export const TRACE_KEY = 'aa.validation.trace';

/** Bounded like every other record here. Oldest entries fall off the front. */
export const TRACE_LIMIT = 500;

// Same reason publish() serialises: a read-then-write on one storage key, with
// two writers (a page settle and the agent's next action) that overlap.
let writing = Promise.resolve();
const serialise = (fn) => (writing = writing.then(fn, fn));

async function load() {
  try {
    const r = await chrome.storage.local.get(TRACE_KEY);
    const t = r[TRACE_KEY];
    return Array.isArray(t?.entries) ? t : { entries: [], seq: 0 };
  } catch {
    return { entries: [], seq: 0 };
  }
}

/**
 * Add one entry.
 *
 * @param {{nodeId?: string|null, nodes?: string[], label?: string|null,
 *          phase?: string|null, step?: number|null, action?: string,
 *          findings?: Array<{widget: string, node?: string|null, level?: string}>,
 *          answered?: string[], holder?: 'agent'|'person', url?: string|null}} e
 */
export async function record(e = {}) {
  return serialise(async () => {
    const t = await load();
    const seq = (t.seq || 0) + 1;
    const entry = {
      seq,
      nodeId: e.nodeId ?? null,
      // Every node the page was serving, because a real page serves several at
      // once and a lookup for any of them should find this moment.
      nodes: Array.isArray(e.nodes) ? e.nodes.slice(0, 12) : [],
      label: e.label ?? null,
      phase: e.phase ?? null,
      step: Number.isFinite(e.step) ? e.step : null,
      t: e.t ?? Date.now(),
      action: e.action ? String(e.action).slice(0, 160) : null,
      findings: (e.findings || []).slice(0, 40).map((f) => ({
        widget: String(f.widget || '').slice(0, 160),
        node: f.node ?? null,
        level: f.level ?? null,
        // Which surface it took - widget, checkpoint or log - so a lookup can
        // say not only that a finding pressed but how.
        surface: f.surface ?? null,
      })),
      answered: (e.answered || []).map((w) => String(w).slice(0, 160)),
      holder: e.holder === 'person' ? 'person' : 'agent',
      url: e.url ?? null,
    };
    const entries = t.entries.concat(entry).slice(-TRACE_LIMIT);
    await chrome.storage.local.set({ [TRACE_KEY]: { entries, seq } });
    return entry;
  });
}

export async function all() {
  return (await load()).entries;
}

/** Everything since a moment in time. What handing back reads. */
export async function since(t) {
  return (await load()).entries.filter((e) => e.t >= t);
}

export async function last() {
  const e = (await load()).entries;
  return e[e.length - 1] || null;
}

/**
 * Everything that happened at one node.
 *
 * Matches three ways because a node is reached three ways: the entry was filed
 * under it, the page was serving it, or a finding recorded there belonged to
 * it. Missing any of those would make the lookup quietly incomplete, which is
 * worse than not having it.
 */
export async function at(nodeId) {
  const id = String(nodeId);
  return (await load()).entries.filter((e) =>
    e.nodeId === id
    || (e.nodes || []).includes(id)
    || (e.findings || []).some((f) => f.node === id));
}

/**
 * What was happening at a node, or at a step. Reads the trace and calls no
 * model at all — this is a lookup, and its answer is only as good as what was
 * recorded, which is the honest limit of it.
 *
 * @param {{nodeId?: string, step?: number}} ref
 */
export async function why(ref = {}) {
  const entries = ref.nodeId != null
    ? await at(ref.nodeId)
    : (await load()).entries.filter((e) => e.step === ref.step);
  if (!entries.length) {
    return { found: false, nodeId: ref.nodeId ?? null, step: ref.step ?? null,
             say: 'Nothing on the record for that.' };
  }
  const first = entries[0];
  const lastOne = entries[entries.length - 1];
  const findings = [];
  const seen = new Set();
  for (const e of entries) {
    for (const f of e.findings || []) {
      if (seen.has(f.widget)) continue;
      seen.add(f.widget);
      findings.push(f);
    }
  }
  const actions = entries.filter((e) => e.action).map((e) => e.action);
  const answered = [...new Set(entries.flatMap((e) => e.answered || []))];
  return {
    found: true,
    nodeId: ref.nodeId ?? first.nodeId,
    label: first.label || null,
    phase: first.phase || null,
    from: first.t,
    to: lastOne.t,
    steps: entries.map((e) => e.step).filter((s) => s != null),
    actions,
    findings,
    answered,
    holder: lastOne.holder,
    // Said here rather than left to a surface to remember, because this is the
    // sentence that keeps re-opening a decision apart from undoing an action.
    note: 'This is what was on the record at that point. Going back to it '
        + 're-opens the decision; it does not undo anything that has already '
        + 'happened on the site.',
  };
}

export async function clear() {
  return serialise(async () => {
    await chrome.storage.local.set({ [TRACE_KEY]: { entries: [], seq: 0 } });
  });
}
