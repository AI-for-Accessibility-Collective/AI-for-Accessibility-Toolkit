// Where the rubric rules InterA11y adapted from GenA11y (GPL-3.0-only) come
// from: InterA11y itself, at the commit vendored in intera11y/, each file
// checked against the hash recorded here. intera11y.mjs reads them when an
// agent asks for a rubric. The agent host fetches them with fetchRubrics
// into a folder of its own for the server's reviewers, whose container has
// no internet (INTERA11Y_DIR). Nothing here imports the browser.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export const IA_COMMIT = '8dcf06e258df88a8f39a3e37ebfce060c45a1cdd';
export const IA_RUBRIC_SHA256 = {
  '1.1.1': '391612c491e0b673c4a5e8762ad5bec9a12a8821e77182175a216feda3283d7d',
  '1.4.1': '9654df19dbfe459cfcb657ad012300b870ed6b5ed3b9e17cedda8ed7a5d9f980',
  '2.4.4': 'a70a23a82c708a8a1732b4b4e9c6b89571eea403281f490fe8335b0596116563',
  '3.3.1': 'fa94100d81182f11bd46e8f4dfe1078068c2357e9294ee46d75d7401df995fd7',
};
export const rubricUrl = (sc) => `https://raw.githubusercontent.com/jszh/InterA11y/${IA_COMMIT}/runtime/intera11y/rubrics/${sc}.js`;
/** The file under an INTERA11Y_DIR (a checkout of InterA11y, or a folder of just these files). */
export const rubricFile = (dir, sc) => path.join(dir, 'runtime', 'intera11y', 'rubrics', `${sc}.js`);
export const rubricMatches = (sc, src) => src != null && createHash('sha256').update(src).digest('hex') === IA_RUBRIC_SHA256[sc];

/** Fetch the files that are not in dir yet, as INTERA11Y_DIR wants them. Resolves to { have, missing: [{sc, reason}] }. */
export async function fetchRubrics(dir, { fetch = globalThis.fetch } = {}) {
  const have = [], missing = [];
  for (const sc of Object.keys(IA_RUBRIC_SHA256)) {
    const file = rubricFile(dir, sc);
    let src = null;
    try { src = readFileSync(file, 'utf8'); } catch { /* not yet */ }
    if (rubricMatches(sc, src)) { have.push(sc); continue; }
    try {
      const res = await fetch(rubricUrl(sc), { signal: AbortSignal.timeout(15_000) });
      const text = res.ok ? await res.text() : null;
      if (!rubricMatches(sc, text)) { missing.push({ sc, reason: res.ok ? 'does not match the vendored commit' : `GitHub answered ${res.status}` }); continue; }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, text);
      renameSync(`${file}.tmp`, file);
      have.push(sc);
    } catch (e) { missing.push({ sc, reason: String(e.message || e).slice(0, 120) }); }
  }
  return { have, missing };
}
