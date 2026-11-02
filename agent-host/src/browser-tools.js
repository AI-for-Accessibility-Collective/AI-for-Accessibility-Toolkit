// The agent's tools for the person's browser, served to its sandbox over MCP
// (streamable HTTP, JSON replies). Each call goes to the sidebar of the
// account the sandbox token names, and waits for the person:
//
//   browser_page            see the page the sidebar is open on, as much as
//                           the person agrees to share (URL, source, screenshot)
//   browser_preview         run an adapter file on that page as a preview
//   browser_remove_preview  take the preview off again
//   adapter_ready           offer a finished adapter to the person: they can
//                           export it or add it to their account
//
// The host, not opencode's event stream, writes the sidebar's line for each,
// so the person sees "Previewing … on your page" while it waits for them.

import { readFileSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { lintWebModule, urlPatternError, SUPPORT_AREAS, MAX_PACKAGE_CODE } from '../../toolkit/protocol/adapter/index.js';

const MAX_OUTLINE = 40_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const TOOLS = [
  {
    name: 'browser_page',
    description: 'See the web page the person has the sidebar open on. The person chooses what to share: the address only, the page source (structure, text and some styles), or also a screenshot. They decide once per site per chat; pass screenshot: true to ask for a screenshot again. Returns what they shared, or that they chose not to.',
    inputSchema: { type: 'object', properties: {
      reason: { type: 'string', description: 'One plain sentence the person reads: why you want to see the page.' },
      screenshot: { type: 'boolean', description: 'Ask for a screenshot this time, even if they shared less before.' },
    }, required: ['reason'], additionalProperties: false },
  },
  {
    name: 'browser_preview',
    description: 'Preview an adapter on the person\'s page: runs the adapter file (a web module under /work) on the tab the sidebar is open on, without installing it. The person may be asked first. Returns whether enable() applied, failed (with the error) or skipped, and the page afterwards at the level the person shares, so you can review the change. A new preview replaces the last one.',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'The adapter file, e.g. adapters/bigger-buttons.js (relative to /work).' },
      name: { type: 'string', description: 'The adapter\'s name, as the person will see it.' },
      runs_on: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'URL patterns it runs on, e.g. https://example.com/*' },
      parameters: { type: 'object', description: 'Parameters passed to enable(), if any.' },
    }, required: ['file', 'name', 'runs_on'], additionalProperties: false },
  },
  {
    name: 'browser_remove_preview',
    description: 'Take the current preview off the person\'s page (calls its disable()).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'adapter_ready',
    description: 'Offer a finished, previewed adapter to the person. The sidebar then shows it with "Add to my account" and "Export". Call it once the preview works and you have reviewed it.',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'The adapter file under /work, e.g. adapters/bigger-buttons.js' },
      id: { type: 'string', description: 'Short id: lowercase letters, digits and dashes, e.g. bigger-buttons' },
      name: { type: 'string' },
      about: { type: 'string', description: 'One or two plain sentences: what it changes, and for whom.' },
      runs_on: { type: 'array', items: { type: 'string' }, minItems: 1 },
      support_areas: { type: 'array', items: { type: 'string', enum: [...SUPPORT_AREAS] } },
    }, required: ['file', 'id', 'name', 'about', 'runs_on'], additionalProperties: false },
  },
];

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

export function createBrowserTools({ uidForToken, chats, requests, pageData, workDir, log }) {
  /** Read an adapter file from the account's /work, refusing anything outside it. */
  function readAdapter(uid, file) {
    const root = realpathSync(workDir(uid));
    const rel = String(file || '').replace(/^\/work\/?/, '');
    if (!/\.m?js$/.test(rel)) throw new Error('The adapter must be a .js file under /work.');
    let full;
    try { full = realpathSync(path.resolve(root, rel)); } catch { throw new Error(`There is no file ${rel} under /work.`); }
    if (!full.startsWith(root + path.sep)) throw new Error('The adapter must be a file under /work.');
    if (statSync(full).size > MAX_PACKAGE_CODE) throw new Error(`The adapter is over ${MAX_PACKAGE_CODE} characters.`);
    const code = readFileSync(full, 'utf8');
    const errors = lintWebModule(code).filter(f => f.level === 'error');
    if (errors.length) throw new Error(`The adapter has problems to fix first:\n${errors.map(e => `- ${e.line ? `line ${e.line}: ` : ''}${e.message}`).join('\n')}`);
    return { code, file: path.relative(root, full) };
  }

  function patternsOf(list) {
    const patterns = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
    if (!patterns.length) throw new Error('Give at least one URL pattern in runs_on.');
    for (const p of patterns) { const e = urlPatternError(p); if (e) throw new Error(`runs_on "${p}": ${e}`); }
    return patterns;
  }

  function pageContent(intro, shared) {
    const lines = [intro];
    if (shared?.url) lines.push(`Address: ${shared.url}`);
    if (shared?.title) lines.push(`Title: ${shared.title}`);
    if (shared?.outline) lines.push('', 'Page source (outline):', String(shared.outline).slice(0, MAX_OUTLINE));
    const content = [{ type: 'text', text: lines.join('\n') }];
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(shared?.screenshot || ''));
    if (m) content.push({ type: 'image', mimeType: m[1], data: m[2] });
    return content;
  }

  const handlers = {
    async browser_page(uid, chatId, args) {
      const step = chats.addEntry(uid, chatId, { kind: 'step', text: 'Asking to see your page', state: 'running' });
      const a = await requests.ask(uid, chatId, { kind: 'page', reason: String(args.reason || '').slice(0, 300), screenshot: args.screenshot === true });
      if (a.cancelled || a.timedOut) {
        chats.addEntry(uid, chatId, { id: step.id, text: 'Asked to see your page: no answer', state: 'failed' });
        return text(a.timedOut ? 'The person did not answer. Ask them in your reply whether they want to share the page.' : 'The chat was stopped.');
      }
      if (a.unavailable) {
        chats.addEntry(uid, chatId, { id: step.id, text: 'This tab cannot be shared', state: 'failed' });
        return text(`The page cannot be shared: ${String(a.unavailable).slice(0, 200)}. Ask the person to open the page they mean beside the sidebar.`);
      }
      if (a.remember && a.origin && a.level) chats.setConsent(uid, chatId, a.origin, a.level);
      if (!a.level || a.level === 'none') {
        chats.addEntry(uid, chatId, { id: step.id, text: 'You chose not to share the page', state: 'done' });
        return text('The person chose not to share this page. Work from what they tell you, and do not ask again in this chat unless they bring it up.');
      }
      pageData(uid, chatId, 'page', a);
      chats.addEntry(uid, chatId, { id: step.id, text: a.level === 'url' ? 'Got the page’s address' : 'Looking at the page', state: 'done' });
      const what = { url: 'only the address', source: 'the address and the page source', screenshot: 'the address, the page source and a screenshot' }[a.level] || 'part of the page';
      return { content: pageContent(`The person shared ${what}.`, a) };
    },

    async browser_preview(uid, chatId, args) {
      let adapter, patterns;
      try { adapter = readAdapter(uid, args.file); patterns = patternsOf(args.runs_on); } catch (e) { return fail(e.message); }
      const name = String(args.name || adapter.file).slice(0, 80);
      const step = chats.addEntry(uid, chatId, { kind: 'step', text: `Previewing “${name}” on your page`, state: 'running' });
      const a = await requests.ask(uid, chatId, { kind: 'preview', name, file: adapter.file, code: adapter.code, runsOn: patterns,
        parameters: args.parameters && typeof args.parameters === 'object' ? args.parameters : {} });
      if (a.cancelled || a.timedOut) {
        chats.addEntry(uid, chatId, { id: step.id, text: `Preview of “${name}”: no answer`, state: 'failed' });
        return text(a.timedOut ? 'The person did not answer the preview request.' : 'The chat was stopped.');
      }
      if (a.status === 'declined') {
        chats.addEntry(uid, chatId, { id: step.id, text: `You chose not to preview “${name}”`, state: 'done' });
        return text('The person chose not to preview it now. Ask them in your reply what they would like.');
      }
      if (a.after) pageData(uid, chatId, 'after-preview', a.after);
      const label = { applied: `“${name}” is previewing on your page`, skipped: `“${name}” did not apply on this page`, failed: `“${name}” failed on your page` }[a.status] || `Preview of “${name}” finished`;
      chats.addEntry(uid, chatId, { id: step.id, text: label, state: a.status === 'failed' ? 'failed' : 'done' });
      const intro = [
        `Preview result: ${a.status}${a.message ? ` (${String(a.message).slice(0, 1000)})` : ''}.`,
        a.status === 'skipped' && /pattern|scope|match/i.test(a.message || '') ? 'Its runs_on patterns do not match the page the person is on.' : '',
        a.after ? 'The page with the preview on, as the person shares it:' : 'The person shares less than the page source, so you cannot see the page afterwards; ask them how it looks.',
      ].filter(Boolean).join('\n');
      return { content: pageContent(intro, a.after) };
    },

    async browser_remove_preview(uid, chatId) {
      const a = await requests.ask(uid, chatId, { kind: 'remove-preview' });
      if (a.cancelled || a.timedOut) return text('The sidebar did not answer.');
      chats.addEntry(uid, chatId, { kind: 'step', text: 'Took the preview off your page', state: 'done' });
      return text(a.removed ? 'The preview is off the page.' : 'There was no preview on the page.');
    },

    async adapter_ready(uid, chatId, args) {
      let adapter, patterns;
      try { adapter = readAdapter(uid, args.file); patterns = patternsOf(args.runs_on); } catch (e) { return fail(e.message); }
      const id = String(args.id || '');
      if (!SLUG.test(id)) return fail('id must be lowercase letters, digits and dashes, starting with a letter or digit.');
      const areas = (args.support_areas || []).filter(a => SUPPORT_AREAS.includes(a));
      const name = String(args.name || id).slice(0, 80);
      chats.markReady(uid, chatId, { id, file: adapter.file, name, about: String(args.about || '').slice(0, 600), runsOn: patterns, supportAreas: areas });
      chats.addEntry(uid, chatId, { kind: 'notice', text: `“${name}” is ready. You can add it to your account or export it.` });
      return text('The sidebar now offers it to the person with "Add to my account" and "Export". Tell them in one or two sentences what it does; do not publish it yourself.');
    },
  };

  async function call(uid, name, args) {
    const chatId = chats.activeChat(uid);
    if (!chatId) return fail('No chat is running for this person.');
    if (!handlers[name]) return fail(`Unknown tool ${name}.`);
    log?.info('tool.call', { uid, chatId, tool: name });
    try { return await handlers[name](uid, chatId, args || {}); } catch (e) { log?.warn('tool.error', { uid, tool: name, error: e.message }); return fail(e.message); }
  }

  return async function handle(req, res) {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const uid = uidForToken(token);
    if (!uid) return json(res, 401, { error: 'unknown sandbox' });
    let msg;
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    if (msg.id === undefined || msg.id === null) { res.writeHead(202); return res.end(); }
    const reply = (result) => json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ai4a11y-browser', version: '0.1.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': return reply(await call(uid, msg.params?.name, msg.params?.arguments));
      default: return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
    }
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export const BROWSER_TOOLS = TOOLS;
