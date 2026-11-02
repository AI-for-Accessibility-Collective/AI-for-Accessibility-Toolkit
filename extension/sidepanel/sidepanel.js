// The assistant sidebar: chats with the account's opencode agent on the
// toolkit (through /v1/agent, see agent-host/README.md), shows its replies
// without code and one line per step, and does what its browser tools ask on
// the tab this sidebar is open beside:
//
//   page            share the page: the address, the page source (an
//                   outline, runtime/page.js) or also a screenshot. The
//                   person chooses once per site per chat; the agent may ask
//                   again for a screenshot.
//   preview         run an adapter on the page without installing it
//                   (runtime/scripts.js buildPreviewScript), after the person
//                   says yes, or at once if they chose "Apply previews
//                   automatically"
//   remove-preview  take it off again
//
// Finished adapters can be added to the account (published privately and
// installed into this browser's runtime) or exported as a file.

import { readConnection } from '../runtime/config.js';
import { pageOutline } from '../runtime/page.js';
import { buildPreviewScript, previewTeardownScript } from '../runtime/scripts.js';
import { createRegistryClient } from '../vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP } from '../vendor/protocol/adapter/index.js';

const $ = (id) => document.getElementById(id);
const LEVELS = ['none', 'url', 'source', 'screenshot'];
const APP = { appId: 'assistant', appName: 'Browser assistant' };
const AUTO_KEY = 'assistantAutoPreview';

let connection = null;
let chats = [];
let chat = null;            // the open chat, in full
const requests = new Map(); // id -> request, for the open chat
let previewing = null;      // {name, tabId}
let streamAbort = null;

function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(text, className, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${connection.url}/v1/agent${path}`, {
    method,
    headers: { authorization: `Bearer ${connection.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `The toolkit answered ${res.status}.`), { status: res.status, code: data.error });
  return data;
}

// ── the tab beside this sidebar ──────────────────────────────────────────────

// The active tab of this sidebar's window, or one named with ?tab=<id> (how a
// test opens the sidebar as a page of its own).
const namedTab = Number(new URLSearchParams(location.search).get('tab'));
async function currentTab() {
  if (namedTab) return chrome.tabs.get(namedTab);
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab;
}
const isWebPage = (tab) => /^https?:/.test(tab?.url || '');
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

/** What the person agreed to share of this tab, at this level. */
async function collect(tab, level) {
  const shared = { level, url: tab.url, title: tab.title };
  if (level === 'source' || level === 'screenshot') {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageOutline, args: [40000] });
    Object.assign(shared, res?.result || {});
  }
  if (level === 'screenshot') shared.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  return shared;
}

// ── requests from the agent's browser tools ──────────────────────────────────

async function answer(request, value) {
  requests.delete(request.id);
  renderRequests();
  try { await api(`/requests/${request.id}`, { method: 'POST', body: value }); } catch (e) { say(`Could not send that to the assistant: ${e.message}`, true); }
}

async function sharePage(request, level, remember) {
  const tab = await currentTab();
  if (!isWebPage(tab)) return answer(request, { level: 'none', unavailable: 'the tab beside the sidebar is not a web page' });
  try {
    const shared = level === 'none' ? { level: 'none' } : await collect(tab, level);
    await answer(request, { ...shared, origin: originOf(tab.url), remember });
  } catch (e) {
    await answer(request, { level: 'none', unavailable: `the page could not be read (${e.message})` });
  }
}

async function runPreview(request) {
  const tab = await currentTab();
  if (!isWebPage(tab)) return answer(request, { status: 'failed', message: 'The tab beside the sidebar is not a web page.' });
  if (typeof chrome.userScripts?.execute !== 'function') {
    say('Previews need user scripts: turn on Allow User Scripts on this extension’s details page.', true);
    return answer(request, { status: 'failed', message: 'User scripts are off in this browser: ask the person to turn on "Allow User Scripts" on the extension’s details page.' });
  }
  let result;
  try {
    const [res] = await chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', injectImmediately: true,
      js: [{ code: buildPreviewScript({ code: request.code, urlPatterns: request.runsOn, parameters: request.parameters }) }] });
    result = res?.result || { status: 'failed', message: res?.error || 'the page gave no result' };
  } catch (e) {
    result = { status: 'failed', message: e.message };
  }
  if (result.status === 'applied') showPreview({ name: request.name, tabId: tab.id });
  // The page afterwards, at what the person shares on this site in this chat.
  const level = chat?.consent?.[originOf(tab.url)];
  let after;
  if (result.status === 'applied' && (level === 'source' || level === 'screenshot')) {
    await new Promise(r => setTimeout(r, 700));
    after = await collect(tab, level).catch(() => undefined);
  }
  await answer(request, { ...result, ...(after ? { after } : {}) });
}

async function removePreview() {
  const tabId = previewing?.tabId ?? (await currentTab())?.id;
  let removed = false;
  if (tabId != null && typeof chrome.userScripts?.execute === 'function') {
    try {
      const [res] = await chrome.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', injectImmediately: true, js: [{ code: previewTeardownScript() }] });
      removed = res?.result === true;
    } catch { /* the tab is gone */ }
  }
  showPreview(null);
  return removed;
}

function showPreview(p) {
  previewing = p;
  $('preview-bar').hidden = !p;
  $('preview-label').textContent = p ? `Previewing “${p.name}” on this page.` : '';
}

async function handleRequest(request) {
  if (request.chatId !== chat?.id) return;
  if (request.kind === 'remove-preview') return answer(request, { removed: await removePreview() });
  if (request.kind === 'preview' && $('auto-preview').checked) return runPreview(request);
  if (request.kind === 'page') {
    const tab = await currentTab();
    const origin = originOf(tab?.url);
    const agreed = origin && chat.consent?.[origin];
    // Once per site per chat; a screenshot may be asked for again.
    if (agreed && !(request.screenshot && LEVELS.indexOf(agreed) < LEVELS.indexOf('screenshot'))) return sharePage(request, agreed, false);
    request.again = !!agreed;
  }
  requests.set(request.id, request);
  renderRequests();
}

function renderRequests() {
  const cards = [];
  for (const request of requests.values()) {
    const card = el('section', 'card');
    card.setAttribute('aria-label', 'The assistant asks');
    if (request.kind === 'page') {
      const tabOrigin = el('strong');
      currentTab().then(t => { tabOrigin.textContent = originOf(t?.url) || 'this tab'; });
      const again = request.again;
      card.append(el('h2', '', again ? 'May the assistant take a screenshot of this page?' : 'May the assistant see this page?'));
      if (request.reason) card.append(el('p', 'why', request.reason));
      const site = el('p', 'note');
      site.append('Page: ', tabOrigin, again ? '. Just this once.' : '. Your choice holds for this site for the rest of this chat.');
      card.append(site);
      const choices = el('div', 'choices');
      if (again) {
        choices.append(
          button('Share a screenshot', 'primary', () => sharePage(request, 'screenshot', false)),
          button('Not now', 'secondary', async () => { const t = await currentTab(); sharePage(request, chat.consent?.[originOf(t?.url)] || 'none', false); }));
      } else {
        choices.append(
          button('The address only', 'secondary', () => sharePage(request, 'url', true)),
          button('The address and the page source', 'secondary', () => sharePage(request, 'source', true)),
          button('The address, the source and a screenshot', 'primary', () => sharePage(request, 'screenshot', true)),
          button('Don’t share', 'text-button', () => sharePage(request, 'none', true)));
      }
      card.append(choices, el('p', 'note', 'The assistant needs the page source and a screenshot to build the best adapter. What you share stays on the toolkit’s server for this research and is not used to identify you.'));
    } else if (request.kind === 'preview') {
      card.append(el('h2', '', `Preview “${request.name}” on this page?`),
        el('p', 'note', 'It runs on this tab only, until you remove it or reload the page. Nothing is installed.'));
      const row = el('div', 'row');
      row.append(button('Preview', 'primary', () => { requests.delete(request.id); renderRequests(); runPreview(request); }),
        button('Not now', 'secondary', () => answer(request, { status: 'declined' })));
      card.append(row);
    }
    cards.push(card);
  }
  $('requests').replaceChildren(...cards);
}

// ── chats ────────────────────────────────────────────────────────────────────

function renderChats() {
  const select = $('chat-select');
  select.replaceChildren(...chats.map(c => {
    const o = el('option', '', `${c.title}${c.busy ? ' (working)' : ''}`);
    o.value = c.id;
    return o;
  }));
  if (chat) select.value = chat.id;
}

function entryNode(entry) {
  if (entry.kind === 'step') {
    const li = el('li', `step ${entry.state || 'done'}`, entry.text);
    li.dataset.id = entry.id;
    return li;
  }
  const li = el('li', `msg ${entry.kind}`, entry.text);
  li.dataset.id = entry.id;
  if (entry.kind === 'agent') li.setAttribute('aria-label', `Assistant: ${entry.text}`);
  return li;
}

function renderTranscript() {
  const list = $('transcript');
  if (!chat?.entries.length) {
    list.replaceChildren(el('li', 'empty', 'Say what gets in your way on the page beside this sidebar, for example “the buttons are too small to tap” or “I can’t read the gray text”. The assistant asks a few questions, then builds an adapter and previews it here.'));
  } else list.replaceChildren(...chat.entries.map(entryNode));
  list.scrollTop = list.scrollHeight;
}

function addEntry(entry) {
  const i = chat.entries.findIndex(e => e.id === entry.id);
  if (i >= 0) chat.entries[i] = { ...chat.entries[i], ...entry };
  else chat.entries.push(entry);
  const list = $('transcript');
  const existing = [...list.children].find(n => n.dataset.id === entry.id);
  if (existing) existing.replaceWith(entryNode(chat.entries[i >= 0 ? i : chat.entries.length - 1]));
  else { list.querySelector('.empty')?.remove(); list.append(entryNode(entry)); }
  list.scrollTop = list.scrollHeight;
}

function renderReady() {
  const list = $('ready-list');
  const adapters = chat?.adapters || [];
  $('ready').hidden = !adapters.length;
  list.replaceChildren(...adapters.map(a => {
    const li = el('li');
    li.append(el('strong', '', a.name), el('p', 'about', a.about), el('p', 'where', `Runs on ${a.runsOn.join(', ')}`));
    const row = el('div', 'row');
    row.append(button('Add to my account', 'primary', (e) => addToAccount(a, e.currentTarget)), button('Export', 'secondary', () => exportAdapter(a)));
    li.append(row);
    return li;
  }));
}

function renderBusy() {
  const busy = !!chats.find(c => c.id === chat?.id)?.busy;
  $('stop').hidden = !busy;
  $('send').disabled = busy;
  $('state').textContent = busy ? 'Working' : 'Ready';
  $('state').className = `badge ${busy ? 'busy' : 'ok'}`;
}

async function openChat(id) {
  chat = (await api(`/chats/${id}`)).chat;
  requests.clear();
  renderChats(); renderTranscript(); renderReady(); renderRequests(); renderBusy();
  try { await chrome.storage.local.set({ assistantChat: id }); } catch { /* fine */ }
}

async function loadChats() {
  chats = (await api('/chats')).chats;
  if (!chats.length) chats = [(await api('/chats', { method: 'POST' })).chat];
  const { assistantChat } = await chrome.storage.local.get('assistantChat');
  await openChat(chats.some(c => c.id === assistantChat) ? assistantChat : chats[0].id);
}

// ── the event stream ─────────────────────────────────────────────────────────

async function stream() {
  streamAbort?.abort();
  const ctl = new AbortController();
  streamAbort = ctl;
  let wait = 1000;
  while (!ctl.signal.aborted) {
    try {
      const res = await fetch(`${connection.url}/v1/agent/events`, { headers: { authorization: `Bearer ${connection.token}` }, signal: ctl.signal });
      if (!res.ok) throw new Error(`The toolkit answered ${res.status}.`);
      wait = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').find(l => l.startsWith('data: '));
          if (data) onEvent(JSON.parse(data.slice(6)));
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      $('state').textContent = 'Reconnecting';
      $('state').className = 'badge warn';
    }
    await new Promise(r => setTimeout(r, wait));
    wait = Math.min(wait * 2, 30_000);
  }
}

function onEvent(event) {
  if (event.type === 'chat') {
    const i = chats.findIndex(c => c.id === event.chat.id);
    if (i >= 0) chats[i] = event.chat; else chats.unshift(event.chat);
    renderChats(); renderBusy();
    return;
  }
  if (event.chatId !== chat?.id) return;
  if (event.type === 'entry') addEntry(event.entry);
  else if (event.type === 'request') handleRequest(event.request);
  else if (event.type === 'request-closed') { requests.delete(event.id); renderRequests(); }
  else if (event.type === 'consent') chat.consent = event.consent;
  else if (event.type === 'adapter') { chat.adapters = [...chat.adapters.filter(a => a.id !== event.adapter.id), event.adapter]; renderReady(); }
}

// ── finished adapters ────────────────────────────────────────────────────────

async function addToAccount(a, btn) {
  btn.disabled = true;
  say(`Adding “${a.name}” to your account…`);
  try {
    const { adapter } = await api(`/chats/${chat.id}/adapters/${a.id}`);
    const registry = createRegistryClient({ url: connection.url, token: connection.token });
    const r = await registry.publish({
      appName: APP.appName, code: adapter.code,
      descriptor: { appId: APP.appId, id: a.id, name: a.name, description: a.about, targets: [{ platforms: ['*'], urls: a.runsOn }], supportAreas: a.supportAreas || [] },
    });
    await registry.install(BROWSER_RUNTIME_APP, { appId: APP.appId, id: a.id });
    // The installed copy takes over from the preview.
    if (previewing) await removePreview();
    await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
    say(`“${a.name}” is in your account (revision ${r.revision}), private to you, and runs in this browser on the pages it targets.`);
  } catch (e) {
    say(`Could not add it: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function exportAdapter(a) {
  try {
    const { adapter } = await api(`/chats/${chat.id}/adapters/${a.id}`);
    const header = [
      `// ${a.name}: ${a.about}`,
      `// Runs on: ${a.runsOn.join(', ')}${a.supportAreas?.length ? `. Helps with: ${a.supportAreas.join(', ')}` : ''}.`,
      '// Made with the AI for Accessibility toolkit’s assistant. Unvalidated: check what it changes.',
      `// Publish it with the toolkit skill: node <skill folder>/scripts/adapter.mjs publish ${a.id}.js --name "${a.name}" ${a.runsOn.map(p => `--runs-on "${p}"`).join(' ')}`,
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([header, adapter.code], { type: 'text/javascript' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${a.id}.js` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    say(`Saved ${a.id}.js.`);
  } catch (e) {
    say(`Could not export it: ${e.message}`, true);
  }
}

// ── start ────────────────────────────────────────────────────────────────────

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('message').value.trim();
  if (!text || !chat) return;
  $('send').disabled = true;
  try {
    await api(`/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
    $('message').value = '';
    say('');
  } catch (err) {
    say(err.message, true);
    $('send').disabled = false;
  }
});
$('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('stop').addEventListener('click', () => api(`/chats/${chat.id}/stop`, { method: 'POST' }).catch(e => say(e.message, true)));
$('new-chat').addEventListener('click', async () => {
  const created = (await api('/chats', { method: 'POST' })).chat;
  chats.unshift(created);
  await openChat(created.id);
  $('message').focus();
});
$('chat-select').addEventListener('change', (e) => openChat(e.target.value).catch(err => say(err.message, true)));
$('remove-preview').addEventListener('click', async () => { await removePreview(); say('The preview is off the page.'); });
$('auto-preview').addEventListener('change', (e) => chrome.storage.local.set({ [AUTO_KEY]: e.target.checked }));
// A navigation clears the page, and with it the preview.
chrome.tabs.onUpdated.addListener((tabId, info) => { if (previewing?.tabId === tabId && info.status === 'loading') showPreview(null); });

async function start() {
  connection = await readConnection();
  $('not-connected').hidden = !!connection;
  $('main').hidden = !connection;
  if (!connection) { $('state').textContent = 'Not connected'; return; }
  $('auto-preview').checked = !!(await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY];
  try {
    await api('/status');
    await loadChats();
    stream();
  } catch (e) {
    $('state').textContent = 'Unavailable';
    $('state').className = 'badge warn';
    say(e.code === 'agent-unavailable' ? 'The assistant is not set up on this toolkit.' : e.message, true);
  }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.connection) start(); });
start();
