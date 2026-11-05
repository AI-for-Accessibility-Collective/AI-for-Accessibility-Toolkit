// What kind of page a tab shows, of the toolkit's page types
// (protocol/adapter/page-types.js), for adapters that run on one kind of
// page (descriptor pageTypes) and for the assistant's "this type of page".
//
//   1. The page's own markup: schema.org types (JSON-LD, microdata) and
//      og:type, when they name one kind (declaredPageType).
//   2. Otherwise the toolkit's model (the pageType task on /v1/ai, Gemini
//      Flash-Lite), from what the page shows: address, title, headings,
//      landmarks, a few counts and the start of its text.
//
// Each answer is kept in chrome.storage.local by address (without the
// #fragment), for 30 days (a day when the model could not tell), at most
// MAX_KEPT addresses, so a page is sorted once, not on every visit or by
// every adapter. What is sent to the toolkit is page content: the service
// does not log it (server/src/ai.js).

import { PAGE_TYPES, declaredPageType } from '../vendor/protocol/adapter/index.js';

export const PAGE_TYPE_KEY = 'pageTypes';
const KEEP_MS = 30 * 24 * 3600_000;
const UNSURE_MS = 24 * 3600_000;
const MAX_KEPT = 2000;

/**
 * What the page shows, for sorting it. Runs in the page (chrome.scripting
 * or inlined into a user script), so it uses nothing from outside itself.
 */
export function pageFacts(maxText = 1500) {
  const types = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const t = node['@type'];
    for (const one of Array.isArray(t) ? t : [t]) if (typeof one === 'string') types.push(one);
    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent || 'null')); } catch (e) { /* the site's broken JSON */ }
  }
  // Microdata: only items that are not inside another item.
  for (const el of document.querySelectorAll('[itemscope][itemtype]')) {
    if (!el.parentElement || !el.parentElement.closest('[itemscope]')) types.push(...String(el.getAttribute('itemtype')).split(/\s+/).map((u) => u.split('/').pop()));
  }
  const og = document.querySelector('meta[property="og:type"]');
  const text = (el) => String(el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main, [role="main"]') || document.body;
  const body = text(main);
  return {
    url: location.href.split('#')[0],
    title: document.title.slice(0, 200),
    declared: { types: [...new Set(types)].slice(0, 30), ogType: og ? String(og.getAttribute('content') || '').slice(0, 40) : '' },
    headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 15).map((h) => `${h.tagName.toLowerCase()}: ${text(h).slice(0, 120)}`),
    counts: {
      forms: document.forms.length,
      fields: document.querySelectorAll('input:not([type=hidden]), select, textarea').length,
      passwords: document.querySelectorAll('input[type=password]').length,
      videos: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
      prices: (body.match(/(?:[$€£¥₹]\s?\d|\d[\d.,]*\s?(?:USD|EUR|GBP))/g) || []).length,
      links: document.links.length,
      articles: document.querySelectorAll('article').length,
    },
    landmarks: ['main', 'nav', 'search', 'aside', 'form'].filter((l) => document.querySelector(l === 'search' ? 'search, [role="search"]' : l)),
    text: body.slice(0, maxText),
  };
}

/** The address an answer is kept under. */
export function pageKey(url) {
  try { const u = new URL(url); return u.origin + u.pathname + u.search; } catch { return null; }
}

/** What the model reads: the facts as plain lines. */
export function factsText(f) {
  const c = f.counts || {};
  return [
    `Address: ${f.url}`,
    `Title: ${f.title || '(none)'}`,
    f.declared?.ogType ? `og:type: ${f.declared.ogType}` : '',
    f.declared?.types?.length ? `schema.org types in its markup: ${f.declared.types.join(', ')}` : '',
    f.landmarks?.length ? `Landmarks: ${f.landmarks.join(', ')}` : '',
    `It has ${c.forms || 0} forms with ${c.fields || 0} fields${c.passwords ? ` (${c.passwords} password)` : ''}, ${c.videos || 0} videos, ${c.prices || 0} prices, ${c.articles || 0} article elements and ${c.links || 0} links.`,
    f.headings?.length ? `Headings:\n${f.headings.join('\n')}` : 'No headings.',
    `The start of its text:\n${f.text || ''}`,
  ].filter(Boolean).join('\n');
}

/**
 * @param {object} o
 * @param {{get: Function, set: Function}} o.storage  chrome.storage.local
 * @param {(input: string) => Promise<{text: string|null, reason?: string}>} o.ask  the pageType task on /v1/ai/text
 */
export function createPageTypes({ storage, ask, now = () => Date.now() }) {
  const pending = new Map(); // key -> promise, so adapters on one page ask once

  async function kept() {
    try { return (await storage.get(PAGE_TYPE_KEY))[PAGE_TYPE_KEY] || {}; } catch { return {}; }
  }
  async function keep(key, answer) {
    const all = await kept();
    all[key] = { ...answer, at: now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_KEPT) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_KEPT)) delete all[k];
    try { await storage.set({ [PAGE_TYPE_KEY]: all }); } catch { /* full or gone */ }
  }

  /** {type: id or null, source: 'page' | 'model' | 'unknown', cached} for a page's facts. */
  async function classify(facts) {
    const key = pageKey(facts?.url);
    if (!key) return { type: null, source: 'unknown' };
    const hit = (await kept())[key];
    if (hit && now() - hit.at < (hit.type ? KEEP_MS : UNSURE_MS)) return { type: hit.type, source: hit.source, cached: true };
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const declared = declaredPageType(facts.declared || {});
      if (declared) { const a = { type: declared, source: 'page' }; await keep(key, a); return a; }
      let reply;
      try { reply = await ask(factsText(facts)); } catch { reply = { text: null, reason: 'unreachable' }; }
      const n = Number(reply?.text);
      const type = Number.isInteger(n) && n >= 1 && n <= PAGE_TYPES.length ? PAGE_TYPES[n - 1].id : null;
      const a = { type, source: type ? 'model' : 'unknown' };
      // Not kept when the toolkit did not answer at all: ask again next time.
      if (type || reply?.reason === 'no-answer' || reply?.reason === 'cannot tell') await keep(key, a);
      return a;
    })().finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  return { classify };
}

/** The pageType task on the toolkit, with the person's token. */
export function askToolkit(connection, fetchImpl = fetch) {
  return async (input) => {
    if (!connection) return { text: null, reason: 'not-connected' };
    const res = await fetchImpl(`${connection.url}/v1/ai/text`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'pageType', input, adapter: 'toolkit/page-type' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { text: null, reason: body.error || `http-${res.status}` };
    return { text: typeof body.text === 'string' ? body.text : null, ...(body.reason ? { reason: body.reason } : {}) };
  };
}
