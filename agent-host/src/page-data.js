// What a person shared of a page, kept on this host's disk only (never in a
// log), by account and chat, for the research team to deidentify after the
// workshop: <account>/page-data/<chat>/<time>-<kind>.json (+ .jpg).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function createPageData({ accounts }) {
  return function save(uid, chatId, kind, answer) {
    const dir = path.join(accounts.dirOf(uid), 'page-data', chatId);
    mkdirSync(dir, { recursive: true });
    const stem = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}`;
    const { screenshot, ...rest } = answer || {};
    writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ kind, ...rest, screenshot: screenshot ? `${stem}.jpg` : undefined }, null, 1));
    const m = /^data:image\/(?:jpeg|png);base64,(.+)$/.exec(String(screenshot || ''));
    if (m) writeFileSync(path.join(dir, `${stem}.jpg`), Buffer.from(m[1], 'base64'));
  };
}
