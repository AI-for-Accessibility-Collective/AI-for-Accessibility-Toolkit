// What a person shared of a page, kept on this host's disk only (never in a
// log), by account and chat, for the research team to deidentify after the
// workshop: <account>/page-data/<chat>/<time>-<kind>.json (+ .jpg).
//
// A copy of the page (<time>-copy.mhtml, with <time>-copy.json saying its
// address) is the page as the person's browser saved it when an adapter was
// previewed on it, at the page-source level they chose. The background check
// of an adapter made for that site runs on it (verification.js).

import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const MAX_PAGE_COPY = 8_000_000; // bytes of MHTML; the host takes 12 MB bodies, and base64 adds a third
const MAX_COPIES = 5;

// By time, then a count: two saved in the same millisecond keep apart, in order.
let saved = 0;
const stemOf = (kind) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(saved++ % 1e6).padStart(6, '0')}-${kind}`;

export function createPageData({ accounts }) {
  const dirOf = (uid, chatId) => path.join(accounts.dirOf(uid), 'page-data', chatId);
  function save(uid, chatId, kind, answer) {
    const dir = dirOf(uid, chatId);
    mkdirSync(dir, { recursive: true });
    const stem = stemOf(kind);
    const { screenshot, ...rest } = answer || {};
    writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ kind, ...rest, screenshot: screenshot ? `${stem}.jpg` : undefined }, null, 1));
    const m = /^data:image\/(?:jpeg|png);base64,(.+)$/.exec(String(screenshot || ''));
    if (m) writeFileSync(path.join(dir, `${stem}.jpg`), Buffer.from(m[1], 'base64'));
  }
  /** Keep a copy of a page: {url, mhtml} with the MHTML in base64. */
  save.copy = function saveCopy(uid, chatId, { url, mhtml } = {}) {
    if (!/^https?:\/\//.test(String(url || ''))) throw Object.assign(new Error('A page copy needs the page’s address.'), { status: 400 });
    const data = Buffer.from(String(mhtml || ''), 'base64');
    if (!data.length || !/multipart\/related/i.test(data.subarray(0, 4000).toString('latin1'))) throw Object.assign(new Error('That is not a page saved as MHTML.'), { status: 400 });
    if (data.length > MAX_PAGE_COPY) throw Object.assign(new Error('The page copy is too large.'), { status: 413 });
    const dir = dirOf(uid, chatId);
    mkdirSync(dir, { recursive: true });
    const stem = stemOf('copy');
    writeFileSync(path.join(dir, `${stem}.mhtml`), data);
    writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ kind: 'copy', url: String(url).slice(0, 2000), at: new Date().toISOString(), bytes: data.length, file: `${stem}.mhtml` }, null, 1));
    return { url, bytes: data.length };
  };
  /** The chat's page copies, the latest of each address first, at most five: [{url, at, file (absolute)}]. */
  save.copies = function copiesOf(uid, chatId, { matches = () => true } = {}) {
    const dir = dirOf(uid, chatId);
    let names = [];
    try { names = readdirSync(dir).filter(n => n.endsWith('-copy.json')).sort().reverse(); } catch { return []; }
    const seen = new Set(), out = [];
    for (const n of names) {
      try {
        const d = JSON.parse(readFileSync(path.join(dir, n), 'utf8'));
        const file = path.join(dir, path.basename(String(d.file || '')));
        if (seen.has(d.url) || !matches(d.url) || !existsSync(file)) continue;
        seen.add(d.url);
        out.push({ url: d.url, at: d.at, file });
      } catch { /* the next one */ }
      if (out.length >= MAX_COPIES) break;
    }
    return out;
  };
  return save;
}
