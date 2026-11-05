// A page saved as MHTML (Chrome's chrome.pageCapture.saveAsMHTML, DevTools'
// Page.captureSnapshot): the page as the person saw it, with its styles,
// images and frames, each part under the address it came from. Read here
// into the verifier's copy of a page (sites.mjs), so an adapter made for one
// site is checked on that site's page, served at its own address, offline.
//
// Pure: no network; the copy's bodies are kept in memory (`inline`).

import { createHash } from 'node:crypto';

const decodeQuotedPrintable = (text) => {
  const soft = text.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < soft.length; i++) {
    const c = soft[i];
    if (c === '=' && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) { out.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2; } else out.push(...Buffer.from(c, 'latin1'));
  }
  return Buffer.from(out);
};

function headersOf(block) {
  const h = {};
  // Folded header lines continue with whitespace.
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
}

/**
 * The parts of an MHTML file: [{location, type, body: Buffer}], the page
 * first. Throws when it is not MHTML.
 */
export function readMhtml(data) {
  const text = Buffer.isBuffer(data) ? data.toString('latin1') : String(data);
  const top = text.search(/\r?\n\r?\n/);
  if (top < 0) throw new Error('not MHTML: no headers');
  const head = headersOf(text.slice(0, top));
  const boundary = /boundary="?([^";]+)"?/i.exec(head['content-type'] || '')?.[1];
  if (!/multipart\/related/i.test(head['content-type'] || '') || !boundary) throw new Error('not MHTML: no multipart/related boundary');
  const parts = [];
  for (const chunk of text.split(`--${boundary}`).slice(1)) {
    if (chunk.startsWith('--')) break; // the closing boundary
    const body = chunk.replace(/^\r?\n/, '');
    const cut = body.search(/\r?\n\r?\n/);
    if (cut < 0) continue;
    const h = headersOf(body.slice(0, cut));
    const raw = body.slice(cut).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
    const enc = (h['content-transfer-encoding'] || 'binary').toLowerCase();
    const bytes = enc === 'base64' ? Buffer.from(raw.replace(/\s+/g, ''), 'base64')
      : enc === 'quoted-printable' ? decodeQuotedPrintable(raw)
      : Buffer.from(raw, 'latin1');
    const location = h['content-location'] || (h['content-id'] ? `cid:${h['content-id'].replace(/[<>]/g, '')}` : null);
    if (location) parts.push({ location, type: (h['content-type'] || 'application/octet-stream').split(';')[0].trim(), charset: /charset="?([^";]+)/i.exec(h['content-type'] || '')?.[1] || null, body: bytes });
  }
  if (!parts.length) throw new Error('not MHTML: no parts');
  return parts;
}

/**
 * The verifier's copy of a page from its MHTML: {url, recordedAt, entries,
 * inline}, served by sites.mjs serveFromCopy at the page's own address.
 * `url` is the page's address (the first part's, unless given).
 */
export function copyFromMhtml(data, { url, recordedAt = Date.now() } = {}) {
  const parts = readMhtml(data);
  const page = url || parts[0].location;
  const entries = {}, inline = {};
  for (const [i, p] of parts.entries()) {
    if (!/^https?:/.test(p.location)) continue;
    const sha = createHash('sha256').update(p.body).digest('hex');
    inline[sha] = p.body;
    // The page's own part is the saved DOM: it is served with its charset, and without the page's CSP.
    const type = p.charset ? `${p.type}; charset=${p.charset}` : p.type;
    if (!entries[p.location] || i === 0) entries[p.location] = { status: 200, headers: { 'content-type': type }, body: sha };
  }
  if (!entries[page]) entries[page] = { ...entries[parts[0].location] };
  return { url: page, recordedAt, entries, inline, fromMhtml: true };
}
