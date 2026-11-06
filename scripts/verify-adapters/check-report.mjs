// A check's report (run.mjs --check): the notes its summary calls for, and
// one report from the slices of a check that ran in several places at once
// (run.mjs --shard i/n; agent-host/src/burst.js runs a slice per Cloud Run
// task, as Cloud Run gives a task at most 8 CPUs). Pure.

/** The notes under a check's result, from its summary. */
export function notesOf(s) {
  const notes = [];
  if (s.narrow && !s.ownPages) notes.push('It is made for some sites only, and there is no copy of a page of theirs to check it on: nothing here shows it works.');
  if (!s.narrow && !s.appliedOnTestPages) notes.push(`It applied on none of the ${s.testPages} test pages: the checks above say little until it runs on a page with the barrier it is for (--pages, or its own page).`);
  notes.push('These checks find some problems in code. They do not show that the adapter helps anyone: only the people who use it can.');
  return notes;
}

const SUMS = ['passed', 'failed', 'skipped', 'appliedOnTestPages', 'appliedOnOwnPages', 'ownRunsFailed'];
const SAME = ['testPages', 'ownPages', 'ownChecks'];

/** One report from its slices: the runs in the check's order, the counts added up. */
export function mergeShards(reports) {
  const parts = reports.filter(Boolean);
  if (!parts.length) return null;
  const runs = parts.flatMap((r) => r.runs || []).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map(({ at, ...run }) => run);
  const summary = { ...Object.fromEntries(SUMS.map((k) => [k, parts.reduce((n, r) => n + (Number(r.summary?.[k]) || 0), 0)])),
    ...Object.fromEntries(SAME.map((k) => [k, Math.max(0, ...parts.map((r) => Number(r.summary?.[k]) || 0))])),
    narrow: parts.some((r) => r.summary?.narrow === true) };
  return { adapter: parts[0].adapter, at: parts[0].at, runs, summary, notes: notesOf(summary) };
}
