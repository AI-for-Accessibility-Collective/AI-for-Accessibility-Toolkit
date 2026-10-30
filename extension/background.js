// The adapter runtime's service worker.
//
// It keeps this browser in step with what the signed-in developer installed
// into the app `browser-runtime` on their toolkit (adapter-mcp.md §14):
//
//   connect      a toolkit URL and the developer's default token, checked with
//                /v1/whoami, kept in chrome.storage.local
//   sync         adapter_installed (with an etag, so an unchanged answer is
//                cheap) → one chrome.userScripts registration per runnable
//                adapter → re-run in open tabs, so a saved edit shows up without
//                a reload (chrome.userScripts.execute, Chrome 135+)
//   report       what each script reports (applied, failed, skipped, removed,
//                with the page origin only) goes back with adapter_report
//   wake-ups     install/startup, a 30-second alarm, the registry's
//                notification stream while the worker is awake, and the
//                developer console page itself (bridge.js) right after a save
//
// Shaped after the personalized extension's custom-adapter path (its user
// script world and reconcile loop), without its built-in adapters, agents,
// voice or Librarian.

import { createRegistryClient } from './vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP, normalizedUrl, urlPatternRegExpSource } from './vendor/protocol/adapter/index.js';
import { registrationFor, runnable, teardownScript, buildUserScript, scriptId, keyOf, SCRIPT_PREFIX } from './runtime/scripts.js';
import { isAllowedServerUrl, readConnection, writeConnection, instanceId, runtimeLabel } from './runtime/config.js';

const APP = BROWSER_RUNTIME_APP;
const SYNC_ALARM = 'sync';
const REPORT_DELAY_MS = 800;

let registry = null;           // for the current connection
let watching = null;           // AbortController of the notification stream
let syncing = null;            // the sync in flight, so callers share it
let resyncRequested = false;
const pendingReports = [];
let reportTimer = null;

// ── state the popup reads ────────────────────────────────────────────────────
// Kept in storage.session so it survives the worker sleeping, not a browser restart.
async function readState() {
  const { runtimeState } = await chrome.storage.session.get('runtimeState');
  return runtimeState || { etag: null, adapters: [], lastSync: null, error: null, tabs: {} };
}
async function writeState(patch) {
  const state = { ...(await readState()), ...patch };
  await chrome.storage.session.set({ runtimeState: state });
  return state;
}

// ── user scripts ─────────────────────────────────────────────────────────────

function userScriptsStatus() {
  const us = chrome.userScripts;
  if (!us || typeof us.getScripts !== 'function') return { available: false, reason: 'toggle-off' };
  return { available: true, execute: typeof us.execute === 'function' };
}

let worldConfigured = false;
async function ensureWorld() {
  if (worldConfigured || !userScriptsStatus().available) return;
  // messaging lets a user script report back with chrome.runtime.sendMessage.
  await chrome.userScripts.configureWorld({ messaging: true });
  worldConfigured = true;
}

async function reconcile(adapters) {
  const status = userScriptsStatus();
  if (!status.available) return { registered: 0, ...status };
  await ensureWorld();
  const desired = runnable(adapters).map(registrationFor);
  const current = (await chrome.userScripts.getScripts()).filter(s => s.id.startsWith(SCRIPT_PREFIX));
  const currentById = new Map(current.map(s => [s.id, s]));
  const desiredIds = new Set(desired.map(s => s.id));
  const removed = current.filter(s => !desiredIds.has(s.id)).map(s => s.id);
  if (removed.length) await chrome.userScripts.unregister({ ids: removed });
  const changed = [];
  for (const script of desired) {
    const before = currentById.get(script.id);
    if (!before) { await chrome.userScripts.register([script]); changed.push(script.id); continue; }
    const same = before.js?.[0]?.code === script.js[0].code && JSON.stringify(before.matches) === JSON.stringify(script.matches);
    if (!same) { await chrome.userScripts.update([script]); changed.push(script.id); }
  }
  return { registered: desired.length, removed, changed, ...status };
}

// Pages that are already open run the new code now (or stop the old one).
async function applyToOpenTabs(adapters, { removed = [], changed = [] }) {
  if (typeof chrome.userScripts?.execute !== 'function' || (!removed.length && !changed.length)) return;
  const byId = new Map(runnable(adapters).map(a => [scriptId(keyOf(a)), a]));
  const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || ''));
  const jobs = [];
  for (const tab of tabs) {
    for (const id of removed) {
      const key = id.slice(SCRIPT_PREFIX.length).replaceAll('~', '/');
      jobs.push(chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', js: [{ code: teardownScript(key) }] }));
    }
    for (const id of changed) {
      const entry = byId.get(id);
      if (entry) jobs.push(chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', js: [{ code: buildUserScript(entry) }], injectImmediately: true }));
    }
  }
  // A tab that cannot take scripts (the Web Store, a crashed page) is skipped.
  await Promise.allSettled(jobs);
}

async function clearScripts() {
  if (!userScriptsStatus().available) return;
  const ours = (await chrome.userScripts.getScripts()).filter(s => s.id.startsWith(SCRIPT_PREFIX)).map(s => s.id);
  if (ours.length) {
    await chrome.userScripts.unregister({ ids: ours });
    await applyToOpenTabs([], { removed: ours });
  }
}

// ── sync ─────────────────────────────────────────────────────────────────────

async function connectionRegistry() {
  const connection = await readConnection();
  if (!connection) { registry = null; return null; }
  if (!registry || registry.url !== connection.url || registry.token !== connection.token) {
    registry = Object.assign(createRegistryClient({ url: connection.url, token: connection.token }), { url: connection.url, token: connection.token });
    startWatching();
  }
  return registry;
}

/** Bring the registered scripts in line with what is installed. Concurrent callers share one run. */
function sync(reason = 'manual') {
  if (syncing) { resyncRequested = true; return syncing; }
  syncing = (async () => {
    try {
      do {
        resyncRequested = false;
        await syncOnce(reason);
      } while (resyncRequested);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function syncOnce(reason) {
  const client = await connectionRegistry();
  if (!client) {
    await clearScripts();
    return writeState({ etag: null, adapters: [], lastSync: null, error: null, scripts: userScriptsStatus() });
  }
  const state = await readState();
  try {
    // Without user scripts nothing can run, but the popup still lists what is installed.
    const scripts = userScriptsStatus();
    // The etag only stands for scripts that are really registered: none while
    // user scripts are off, and not after Chrome dropped them (an extension
    // reload or update).
    let trusted = !!state.etag && scripts.available && reason !== 'reconnect';
    if (trusted) {
      const ours = (await chrome.userScripts.getScripts()).filter(x => x.id.startsWith(SCRIPT_PREFIX)).length;
      trusted = ours === state.registered;
    }
    const answer = await client.installed(APP, { includeCode: true, ...(trusted ? { ifEtag: state.etag } : {}) });
    if (answer.unchanged) return writeState({ lastSync: new Date().toISOString(), error: null, scripts });
    const outcome = await reconcile(answer.adapters);
    await applyToOpenTabs(answer.adapters, outcome);
    // The popup needs no code.
    const listed = answer.adapters.map(({ package: pkg, descriptor, ...a }) => ({ ...a, portable: !!pkg }));
    return writeState({
      etag: scripts.available ? answer.etag : null, registered: outcome.registered,
      adapters: listed, lastSync: new Date().toISOString(), error: null, scripts,
    });
  } catch (e) {
    const message = e?.code === 'unauthorized' || /401|unauthorized/i.test(e?.message || '') ? 'The toolkit did not accept the token. Connect again.' : `Could not reach the toolkit: ${e?.message || e}`;
    return writeState({ error: message, lastSync: new Date().toISOString(), scripts: userScriptsStatus() });
  }
}

function startWatching() {
  watching?.abort();
  watching = new AbortController();
  const client = registry;
  client.watch((meta) => {
    // A report of our own changes nothing to run.
    if (meta.reason && meta.reason !== 'status' && meta.reason !== 'connected') sync('notification');
  }, { signal: watching.signal }).catch(() => {});
}

// ── reports from the user scripts ────────────────────────────────────────────

// An adapter's own data and observations (enable's second argument, scripts.js).
// Only an adapter installed here may ask, and only as itself.
chrome.runtime.onUserScriptMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ai4a11y:data' && message?.type !== 'ai4a11y:observe') return false;
  adapterCall(message, sender).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function adapterCall(message, sender) {
  const key = String(message.key || '');
  const state = await readState();
  if (!(state.adapters || []).some(a => keyOf(a) === key)) throw new Error('This adapter is not installed in this browser.');
  const [owner, appId, id] = key.split('/');
  const adapter = { owner, appId, id };
  const client = await connectionRegistry();
  if (!client) throw new Error('This browser is not connected to a toolkit.');
  if (message.type === 'ai4a11y:observe') {
    const text = String(message.text || '').trim().slice(0, 400);
    if (!text) throw new Error('observe needs a sentence saying what the person did.');
    let origin;
    try { origin = new URL(sender.url).origin; } catch { /* no page */ }
    return client.profile.observe({
      text, type: message.kind === 'setting-change' ? 'setting-change' : 'observation', app: APP, adapter,
      ...(origin ? { origin } : {}), ...(message.data && typeof message.data === 'object' ? { data: message.data } : {}),
    });
  }
  const data = client.data(adapter);
  if (message.op === 'get') return data.get(message.k ?? undefined);
  if (message.op === 'set') return data.set(message.k, message.value);
  if (message.op === 'delete') return data.delete(message.k ?? undefined);
  throw new Error(`Unknown data operation ${message.op}.`);
}

chrome.runtime.onUserScriptMessage?.addListener((message, sender) => {
  if (message?.type !== 'ai4a11y:report' || typeof message.key !== 'string') return;
  const [owner, appId, id] = message.key.split('/');
  const result = {
    adapter: { owner, appId, id }, origin: String(message.origin || '').slice(0, 300), status: message.status,
    ...(typeof message.revision === 'number' ? { revision: message.revision } : {}),
    ...(message.message ? { message: String(message.message).slice(0, 500) } : {}),
    at: new Date().toISOString(),
  };
  pendingReports.push(result);
  rememberTab(sender.tab?.id, message.key, result).catch(() => {});
  clearTimeout(reportTimer);
  reportTimer = setTimeout(flushReports, REPORT_DELAY_MS);
});

async function rememberTab(tabId, key, result) {
  if (tabId == null) return;
  const state = await readState();
  const tabs = state.tabs || {};
  tabs[tabId] = { ...(tabs[tabId] || {}), [key]: { status: result.status, message: result.message, at: result.at } };
  await writeState({ tabs });
}

async function flushReports() {
  const batch = pendingReports.splice(0, 200);
  if (!batch.length) return;
  const client = await connectionRegistry();
  if (!client) return;
  try {
    await client.report(APP, await instanceId(), batch, runtimeLabel());
  } catch {
    // Reports are best effort: the page already shows what happened.
  }
  if (pendingReports.length) flushReports();
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A navigation starts the page's adapters over.
  if (info.status === 'loading') readState().then(s => { if (s.tabs?.[tabId]) { delete s.tabs[tabId]; writeState({ tabs: s.tabs }); } }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  readState().then(s => { if (s.tabs?.[tabId]) { delete s.tabs[tabId]; writeState({ tabs: s.tabs }); } }).catch(() => {});
});

// ── the developer console bridge ─────────────────────────────────────────────
// On the connected toolkit's console only: a save there wakes this worker at
// once instead of at the next alarm, and the console can tell whether this
// browser's runtime is connected.

async function registerBridge() {
  const connection = await readConnection();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['console-bridge'] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['console-bridge'] });
  if (!connection) return;
  const u = new URL(connection.url);
  const matches = [`${u.protocol}//${u.hostname}/developer*`];
  await chrome.scripting.registerContentScripts([{
    id: 'console-bridge', js: ['bridge.js'], matches, runAt: 'document_start', persistAcrossSessions: true,
  }]);
  // A registered script reaches pages loaded from now on. The console the
  // person just connected from is already open: give it the bridge too, so it
  // shows this runtime without a reload.
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  for (const tab of await chrome.tabs.query({ url: matches })) {
    try {
      const at = new URL(tab.url);
      if ((at.port || (at.protocol === 'https:' ? '443' : '80')) !== port) continue;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
    } catch { /* a tab that is closing or not ready yet */ }
  }
}

// ── messages from the popup and the bridge ───────────────────────────────────

const handlers = {
  async status() {
    const [connection, state] = await Promise.all([readConnection(), readState()]);
    return { connection: connection && { url: connection.url, uid: connection.uid }, state: { ...state, scripts: userScriptsStatus() } };
  },
  async sync() { return sync('manual'); },
  async connect({ url, token }) {
    const base = String(url || '').trim().replace(/\/+$/, '');
    if (!isAllowedServerUrl(base)) throw new Error('Use an https:// address, or http:// on localhost.');
    if (!/^aat_[A-Za-z0-9_-]+$/.test(String(token || '').trim())) throw new Error('That does not look like a toolkit token (aat_…).');
    const res = await fetch(`${base}/v1/whoami`, { headers: { authorization: `Bearer ${token.trim()}` } });
    if (res.status === 401) throw new Error('The toolkit did not accept that token.');
    if (!res.ok) throw new Error(`The toolkit answered ${res.status}.`);
    const who = await res.json();
    if (who.kind === 'session') throw new Error('Use your default token (from the console sidebar), not a sign-in session.');
    await writeConnection({ url: base, token: token.trim(), uid: who.uid });
    await writeState({ etag: null, adapters: [], tabs: {}, error: null });
    await registerBridge();
    await sync('reconnect');
    // Check in with an empty report, so the toolkit knows this runtime before
    // it runs anything (the skill's `adapter.mjs check`, the console's list).
    await (await connectionRegistry())?.report(APP, await instanceId(), [], runtimeLabel()).catch(() => {});
    return { uid: who.uid, url: base };
  },
  async disconnect() {
    watching?.abort();
    watching = null;
    registry = null;
    await writeConnection(null);
    await registerBridge();
    await sync('disconnect');
    return { ok: true };
  },
  /** Switch one installed adapter on or off for one site. */
  async setSite({ key, origin, on }) {
    const client = await connectionRegistry();
    if (!client) throw new Error('Not connected.');
    const [owner, appId, id] = String(key).split('/');
    await client.install(APP, { owner, appId, id }, { sites: { [origin]: on === true } });
    return sync('site');
  },
  /** For the popup: does this URL fall inside an installed adapter's patterns? */
  async forUrl({ url }) {
    const state = await readState();
    let here;
    try { here = normalizedUrl(url); } catch { return { adapters: [] }; }
    const adapters = state.adapters.filter(a => (a.urlPatterns || []).some(p => new RegExp(urlPatternRegExpSource(p)).test(here)));
    return { adapters, origin: new URL(url).origin };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  // The extension's own pages (the popup) may ask anything. The bridge may
  // only ask for a sync or the status, and only from the connected toolkit's
  // own console: it runs in a web page.
  const ownPage = typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (!ownPage) {
    if (!['sync', 'status'].includes(message.type)) return false;
    readConnection().then((connection) => {
      if (!connection || new URL(connection.url).origin !== sender.origin) return sendResponse({ ok: false, error: 'not this toolkit' });
      handler(message).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
    });
    return true;
  }
  handler(message).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// ── wake-ups ─────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SYNC_ALARM) sync('alarm'); });
async function start(reason) {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
  await registerBridge().catch(() => {});
  await sync(reason);
}
chrome.runtime.onInstalled.addListener(() => start('installed'));
chrome.runtime.onStartup.addListener(() => start('startup'));
// The worker also starts for an alarm or a message; open the stream then too.
connectionRegistry().catch(() => {});

// For tests and the console: what this runtime is doing.
globalThis.ai4a11yRuntime = { sync, handlers, readState };
