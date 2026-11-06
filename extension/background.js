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
//   blocks       the building blocks' AI (ai.text, ai.vision) goes to the
//                toolkit's /v1/ai with the token, which stays here; each
//                sync reads the person's profile and the settings they set
//                themselves (for every site and per site), which go into
//                every script; profile.set records a setting the person
//                chose (/v1/librarian/recordScopedSettings), zoom is the
//                browser's own (chrome.tabs.setZoom) and speech is chrome.tts
//   page types   an adapter for some kinds of page only asks what kind its
//                page is (runtime/page-type.js: the page's markup, else the
//                toolkit's pageType task, kept by address)
//   wake-ups     install/startup, a 30-second alarm, the registry's
//                notification stream while the worker is awake, and the
//                developer console page itself (bridge.js) right after a save
//   follow       the developer console in front, signed in, on the hosted
//                toolkit or one on this computer (runtime/config.js): the
//                runtime connects to it with the token it shows
//
// Shaped after the personalized extension's custom-adapter path (its user
// script world and reconcile loop), without its built-in adapters, agents,
// voice or Librarian.

import { createRegistryClient } from './vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP, normalizedUrl, urlPatternRegExpSource } from './vendor/protocol/adapter/index.js';
import { registrationFor, runnable, teardownScript, buildUserScript, personalScript, scriptId, keyOf, SCRIPT_PREFIX, BLOCKS_FILE, PREVIEW_KEY } from './runtime/scripts.js';
import { personalFromProfile, explicitFromMemories, personalFromSettings, siteOf, SETTABLE_KEYS } from './vendor/blocks/personal.js';
import { shortcutFromProfile, shortcutKeysFromProfile, checkCombo, normalCombo, SHORTCUT_FIELD } from './vendor/blocks/shortcut.js';
import { isAllowedServerUrl, readConnection, writeConnection, instanceId, runtimeLabel, FOLLOWED_ORIGINS, followsConsoleAt } from './runtime/config.js';
import { createPageTypes, askToolkit } from './runtime/page-type.js';

const APP = BROWSER_RUNTIME_APP;
const SYNC_ALARM = 'sync';
const REPORT_DELAY_MS = 800;

let registry = null;           // for the current connection
let watching = null;           // AbortController of the notification stream
let syncing = null;            // the sync in flight, so callers share it
let resyncRequested = false;
const pendingReports = [];
let reportTimer = null;

// ── state the side panel reads ──────────────────────────────────────────────
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

const codeOf = (script) => (script.js || []).map(j => j.code || `file:${j.file}`).join('\n');
// The adapter's own script, without the person's settings before it.
const adapterCodeOf = (script) => { const js = script.js || []; return js.length ? (js[js.length - 1].code || '') : ''; };

async function reconcile(adapters, personal, explicit, shortcut) {
  const status = userScriptsStatus();
  if (!status.available) return { registered: 0, ...status };
  await ensureWorld();
  const desired = runnable(adapters).map(a => registrationFor(a, { personal, explicit, shortcut }));
  const current = (await chrome.userScripts.getScripts()).filter(s => s.id.startsWith(SCRIPT_PREFIX));
  const currentById = new Map(current.map(s => [s.id, s]));
  const desiredIds = new Set(desired.map(s => s.id));
  const removed = current.filter(s => !desiredIds.has(s.id)).map(s => s.id);
  if (removed.length) await chrome.userScripts.unregister({ ids: removed });
  // `changed`: the adapter itself changed, so open pages run it again. A
  // change to the person's settings alone updates the registration; open
  // pages get the settings in place (applyToOpenTabs).
  const changed = [];
  for (const script of desired) {
    const before = currentById.get(script.id);
    if (!before) { await chrome.userScripts.register([script]); changed.push(script.id); continue; }
    const same = codeOf(before) === codeOf(script) && JSON.stringify(before.matches) === JSON.stringify(script.matches);
    if (!same) {
      await chrome.userScripts.update([script]);
      if (adapterCodeOf(before) !== adapterCodeOf(script) || JSON.stringify(before.matches) !== JSON.stringify(script.matches)) changed.push(script.id);
    }
  }
  return { registered: desired.length, removed, changed, ...status };
}

// Pages that are already open run the new code now (or stop the old one).
async function applyToOpenTabs(adapters, { removed = [], changed = [] }, personal, explicit, personalChanged = false, shortcut = null) {
  if (typeof chrome.userScripts?.execute !== 'function' || (!removed.length && !changed.length && !personalChanged)) return;
  const byId = new Map(runnable(adapters).map(a => [scriptId(keyOf(a)), a]));
  const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || ''));
  const jobs = [];
  for (const tab of tabs) {
    // The person's settings, in place: the adapters keep running.
    if (personalChanged) jobs.push(chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', js: [{ code: personalScript({ personal, explicit, shortcut }) }], injectImmediately: true }));
    for (const id of removed) {
      const key = id.slice(SCRIPT_PREFIX.length).replaceAll('~', '/');
      jobs.push(chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', js: [{ code: teardownScript(key) }] }));
    }
    for (const id of changed) {
      const entry = byId.get(id);
      if (entry) jobs.push(chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', js: [{ file: BLOCKS_FILE }, { code: personalScript({ personal, explicit, shortcut }) }, { code: buildUserScript(entry) }], injectImmediately: true }));
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
    // Without user scripts nothing can run, but the side panel still lists what is installed.
    const scripts = userScriptsStatus();
    // The etag only stands for scripts that are really registered: none while
    // user scripts are off, and not after Chrome dropped them (an extension
    // reload or update).
    // The person's settings the blocks follow. A change rebuilds every
    // script, so open pages pick it up. Unreadable: keep the last ones.
    let personal = state.personal || {};
    let explicit = state.explicit || null;
    let shortcutSetting = state.shortcutSetting || null;
    let shortcutKeys = state.shortcutKeys || shortcutKeysFromProfile(null);
    try {
      const got = await client.profile.get();
      personal = personalFromProfile(got?.profile ?? got);
      shortcutSetting = shortcutFromProfile(got?.profile ?? got);
      shortcutKeys = shortcutKeysFromProfile(got?.profile ?? got);
    } catch { /* the profile could not be read this time */ }
    try {
      explicit = explicitFromMemories((await librarian('listMemories', [{ status: 'active' }]))?.memories);
    } catch { /* the same */ }
    const personalChanged = JSON.stringify([personal, explicit, shortcutSetting]) !== JSON.stringify([state.personal || {}, state.explicit || null, state.shortcutSetting || null]);
    let trusted = !!state.etag && scripts.available && reason !== 'reconnect' && !personalChanged;
    if (trusted) {
      const ours = (await chrome.userScripts.getScripts()).filter(x => x.id.startsWith(SCRIPT_PREFIX)).length;
      trusted = ours === state.registered;
    }
    const answer = await client.installed(APP, { includeCode: true, ...(trusted ? { ifEtag: state.etag } : {}) });
    if (answer.unchanged) return writeState({ lastSync: new Date().toISOString(), error: null, scripts, shortcutKeys });
    // The shortcut names its adapter, for what it announces.
    const assigned = shortcutSetting && answer.adapters.find(a => keyOf(a) === shortcutSetting.adapter);
    const shortcut = assigned ? { ...shortcutSetting, name: assigned.name || assigned.adapter.id } : null;
    const outcome = await reconcile(answer.adapters, personal, explicit, shortcut);
    await applyToOpenTabs(answer.adapters, outcome, personal, explicit, personalChanged, shortcut);
    // The side panel needs no code.
    const listed = answer.adapters.map(({ package: pkg, descriptor, ...a }) => ({ ...a, portable: !!pkg }));
    const next = await writeState({
      etag: scripts.available ? answer.etag : null, registered: outcome.registered,
      adapters: listed, lastSync: new Date().toISOString(), error: null, scripts, personal, explicit, shortcutSetting, shortcutKeys,
    });
    await staleZoomInOpenTabs(next).catch(() => {});
    return next;
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

// The building blocks' AI (toolkit/blocks ai.text, ai.vision): an installed
// adapter or the sidebar's preview asks, and the toolkit answers with its own
// model, prompts and checks. The token never reaches the page.
chrome.runtime.onUserScriptMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ai4a11y:ai') return false;
  aiCall(message, sender).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function aiCall(message, sender) {
  const key = String(message.key || '');
  if (key !== PREVIEW_KEY) {
    const state = await readState();
    if (!(state.adapters || []).some(a => keyOf(a) === key)) throw new Error('This adapter is not installed in this browser.');
  }
  const connection = await readConnection();
  if (!connection) return { text: null, reason: 'not-connected' };
  const r = message.request || {};
  const kind = r.kind === 'vision' ? 'vision' : 'text';
  let image = r.image;
  if (kind === 'vision' && !image && r.rect) {
    image = await captureRect(sender.tab, r.rect).catch(() => null);
    if (!image) return { text: null, reason: 'not-captured' };
  }
  const res = await fetch(`${connection.url}/v1/ai/${kind}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ task: r.task, input: r.input || '', options: r.options || {}, adapter: key, ...(image ? { image } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { text: null, reason: body.error || `http-${res.status}` };
  return { text: typeof body.text === 'string' ? body.text : null, ...(body.reason ? { reason: body.reason } : {}) };
}

// What kind of page an adapter that runs on some kinds only is on: the
// address is the tab's, not what the page says it is.
const pageTypes = createPageTypes({ storage: chrome.storage.local, ask: async (input) => askToolkit(await readConnection())(input) });
chrome.runtime.onUserScriptMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ai4a11y:pagetype') return false;
  (async () => {
    if (!(await knownAdapter(String(message.key || '')))) throw new Error('This adapter is not installed in this browser.');
    return pageTypes.classify({ ...(message.facts || {}), url: String(sender.url || sender.tab?.url || '').split('#')[0] });
  })().then((r) => sendResponse(r), () => sendResponse(null));
  return true;
});

// The person's Librarian on the toolkit, with the token, for what the MCP
// tools do not cover: the settings they set themselves.
async function librarian(method, args) {
  const connection = await readConnection();
  if (!connection) throw new Error('This browser is not connected to a toolkit.');
  const res = await fetch(`${connection.url}/v1/librarian/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `http-${res.status}`);
  return body.result;
}

// An installed adapter, or the sidebar's preview.
async function knownAdapter(key) {
  if (key === PREVIEW_KEY) return true;
  const state = await readState();
  return (state.adapters || []).some(a => keyOf(a) === key);
}

// ── the blocks' profile, zoom and speech ─────────────────────────────────────

chrome.runtime.onUserScriptMessage?.addListener((message, sender, sendResponse) => {
  const handler = { 'ai4a11y:profile': profileCall, 'ai4a11y:zoom': zoomCall, 'ai4a11y:adjustable': adjustableCall, 'ai4a11y:toggle': toggleCall }[message?.type];
  if (!handler) return false;
  handler(message, sender).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// profile.set: a setting the person chose in an adapter (the block checked
// it was their own click or key), recorded as theirs for this site or for
// every site. For every site, this site's own value goes, so it follows.
// A preview's change stays in the page.
async function profileCall(message, sender) {
  const key = String(message.key || '');
  if (!(await knownAdapter(key))) throw new Error('This adapter is not installed in this browser.');
  const r = message.request || {};
  if (r.op !== 'set') throw new Error(`Unknown profile operation ${r.op}.`);
  const changes = personalFromSettings(Object.fromEntries(Object.entries(r.changes || {}).filter(([k]) => SETTABLE_KEYS.includes(k))), { keepOff: true });
  if (!Object.keys(changes).length) throw new Error('Nothing to set.');
  if (key === PREVIEW_KEY) return { saved: false, reason: 'preview' };
  const site = siteOf(sender.url || '');
  if (!site) throw new Error('No site to record it for.');
  if (!(await readConnection())) return { saved: false, reason: 'not-connected' };
  const scope = r.scope === 'all' ? 'general' : `origin:${site}`;
  await librarian('recordScopedSettings', [scope, changes, { writer: 'person' }]);
  if (scope === 'general') for (const k of Object.keys(changes)) await librarian('removeScopedSetting', [`origin:${site}`, k]).catch(() => {});
  sync('profile');
  return { saved: true };
}

// keys.adjust: what an adapter adjusts, for the side panel, where the person
// chooses which adapter their shortcut goes to.
async function adjustableCall(message) {
  const key = String(message.key || '');
  if (key === PREVIEW_KEY || !(await knownAdapter(key))) return null;
  const state = await readState();
  const settings = (Array.isArray(message.settings) ? message.settings : []).filter(k => SETTABLE_KEYS.includes(k));
  const info = { label: String(message.label || '').slice(0, 60), settings };
  if (JSON.stringify(state.adjustable?.[key]) !== JSON.stringify(info)) await writeState({ adjustable: { ...(state.adjustable || {}), [key]: info } });
  return null;
}

// The shortcut's first key, for an adapter with nothing to adjust: on or off
// on this site, as the Profile tab's switch. Only for the adapter the person gave
// their shortcut to.
async function toggleCall(message, sender) {
  const key = String(message.key || '');
  const state = await readState();
  if (!state.shortcutSetting || state.shortcutSetting.adapter !== key) throw new Error('The shortcut is not for this adapter.');
  let origin;
  try { origin = new URL(sender.url).origin; } catch { throw new Error('No site.'); }
  await handlers.setSite({ key, origin, on: message.on === true });
  return { on: message.on === true };
}

// zoom: the browser's own zoom, which Chrome keeps per site. What the site's
// zoom was before an adapter changed it is kept here (zoomRecords, by
// hostname), so turning the adapter off puts it back even after reloads and
// in another tab; a zoom the person changed meanwhile stays theirs. A restore
// waits a moment, because an update turns an adapter off and on again.
const ZOOM_RESTORE_MS = 1500;
const zoomRestores = new Map();
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const sameZoom = (a, b) => Math.abs(a - b) < 0.001;
async function zoomRecords() { return (await chrome.storage.local.get('zoomRecords')).zoomRecords || {}; }

async function zoomCall(message, sender) {
  const key = String(message.key || '');
  const r = message.request || {};
  // Putting the zoom back is always allowed: an adapter being uninstalled
  // asks after it is gone from the list.
  if (r.op !== 'restore' && !(await knownAdapter(key))) throw new Error('This adapter is not installed in this browser.');
  const tabId = sender.tab?.id;
  const host = hostOf(sender.url || '');
  if (tabId === undefined || !host) throw new Error('No tab to zoom.');
  if (r.op === 'get') return { factor: await chrome.tabs.getZoom(tabId) };
  if (r.op === 'set') {
    const factor = Math.max(0.25, Math.min(5, Number(r.factor)));
    if (!Number.isFinite(factor)) throw new Error('A zoom factor is a number.');
    clearTimeout(zoomRestores.get(host));
    zoomRestores.delete(host);
    const now = await chrome.tabs.getZoom(tabId);
    const records = await zoomRecords();
    records[host] = { original: records[host]?.original ?? now, applied: factor, key };
    await chrome.storage.local.set({ zoomRecords: records });
    if (!sameZoom(now, factor)) await chrome.tabs.setZoom(tabId, factor);
    return { ok: true };
  }
  if (r.op === 'restore') {
    clearTimeout(zoomRestores.get(host));
    zoomRestores.set(host, setTimeout(() => { zoomRestores.delete(host); restoreZoom(tabId, host).catch(() => {}); }, ZOOM_RESTORE_MS));
    return { ok: true };
  }
  throw new Error(`Unknown zoom operation ${r.op}.`);
}

async function restoreZoom(tabId, host) {
  const records = await zoomRecords();
  const rec = records[host];
  if (!rec) return;
  const now = await chrome.tabs.getZoom(tabId); // a closed tab throws: the record waits for the next page
  if (sameZoom(now, rec.applied)) await chrome.tabs.setZoom(tabId, rec.original);
  delete records[host];
  await chrome.storage.local.set({ zoomRecords: records });
}

// A site whose zoom an adapter changed, where that adapter no longer runs
// (uninstalled, switched off, switched off for the site, or it was a
// preview): put the zoom back. Checked when such a page loads, and in open
// pages after every sync: the page that zoomed may be long gone, and Chrome
// kept the zoom for the site.
async function staleZoom(tabId, url, state) {
  const host = hostOf(url);
  if (!host || zoomRestores.has(host)) return;
  const rec = (await zoomRecords())[host];
  if (!rec) return;
  state ||= await readState();
  let here;
  try { here = normalizedUrl(url); } catch { return; }
  const origin = new URL(url).origin;
  const runs = rec.key !== PREVIEW_KEY && (state.adapters || []).some(a => keyOf(a) === rec.key && a.available && a.enabled && a.portable
    && a.sites?.[origin] !== false && (a.urlPatterns || []).some(p => new RegExp(urlPatternRegExpSource(p)).test(here)));
  if (!runs) await restoreZoom(tabId, host);
}

async function staleZoomInOpenTabs(state) {
  const records = await zoomRecords();
  if (!Object.keys(records).length) return;
  for (const tab of await chrome.tabs.query({})) {
    if (/^https?:/.test(tab.url || '') && records[hostOf(tab.url)]) await staleZoom(tab.id, tab.url, state).catch(() => {});
  }
}

// speech: chrome.tts, one voice in the browser. Each say() chunk comes over
// the page's port; its events go back the same way. When the page goes away
// (or stops), so does its speech, and only its own.
let ttsPort = null;
chrome.runtime.onUserScriptConnect?.addListener((port) => {
  if (port.name !== 'ai4a11y:tts') return;
  const post = (e) => { try { port.postMessage(e); } catch { /* gone */ } };
  port.onMessage.addListener(async (m) => {
    if (m?.op === 'speak') {
      if (!(await knownAdapter(String(m.key || '')))) { post({ type: 'error', error: 'not installed' }); return; }
      ttsPort = port;
      chrome.tts.speak(String(m.text || '').slice(0, 32000), {
        rate: Math.max(0.5, Math.min(2, Number(m.speechRate) || 1)), pitch: Math.max(0, Math.min(2, Number(m.pitch) || 1)),
        ...(m.lang ? { lang: String(m.lang) } : {}), ...(m.voice ? { voiceName: String(m.voice) } : {}),
        enqueue: false,
        onEvent: (e) => {
          if (['end', 'interrupted', 'cancelled', 'error'].includes(e.type) && ttsPort === port) ttsPort = null;
          post({ type: e.type, charIndex: e.charIndex, length: e.length });
        },
      });
    } else if (ttsPort === port) {
      if (m?.op === 'stop') { ttsPort = null; chrome.tts.stop(); } else if (m?.op === 'pause') chrome.tts.pause(); else if (m?.op === 'resume') chrome.tts.resume();
    }
  });
  port.onDisconnect.addListener(() => { if (ttsPort === port) { ttsPort = null; chrome.tts.stop(); } });
});

// What the person sees of an element, from the visible tab: for an element
// the page cannot draw itself (another site's image). It must be in view.
async function captureRect(tab, rect) {
  if (!tab || tab.windowId === undefined) return null;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bitmap.width / Math.max(1, rect.viewportWidth || bitmap.width);
  const sx = Math.max(0, Math.round(rect.x * scale)), sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale)), sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale));
  if (sw < 4 || sh < 4) return null;
  const fit = Math.min(1, 1024 / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(Math.round(sw * fit), Math.round(sh * fit));
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: 'image/png', data: btoa(binary) };
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

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // A navigation starts the page's adapters over.
  if (info.status === 'loading') readState().then(s => { if (s.tabs?.[tabId]) { delete s.tabs[tabId]; writeState({ tabs: s.tabs }); } }).catch(() => {});
  if (info.status === 'complete' && /^https?:/.test(tab?.url || '')) staleZoom(tabId, tab.url).catch(() => {});
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
  // The consoles it follows (a match pattern has no port: any port on this
  // computer), and the connected toolkit's.
  const hosts = new Set([...FOLLOWED_ORIGINS, 'http://localhost', 'http://127.0.0.1']);
  if (connection) { const u = new URL(connection.url); hosts.add(`${u.protocol}//${u.hostname}`); }
  const matches = [...hosts].map(h => `${h}/developer*`);
  await chrome.scripting.registerContentScripts([{
    id: 'console-bridge', js: ['bridge.js'], matches, runAt: 'document_start', persistAcrossSessions: true,
  }]);
  // A registered script reaches pages loaded from now on. Consoles already
  // open (the one the person just connected from, say) get it now, so they
  // show this runtime without a reload.
  for (const tab of await chrome.tabs.query({ url: matches })) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
    } catch { /* a tab that is closing or not ready yet */ }
  }
}

// The console in front, signed in, on a toolkit it follows: connect to that
// one, with the default token the console shows, unless already connected
// with it. One at a time: tab switches and the bridge can ask together.
let following = Promise.resolve();
function followConsole(tabId) {
  following = following.then(() => followNow(tabId)).catch(() => {});
  return following;
}
async function followNow(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !tab.url) return;
  let u;
  try { u = new URL(tab.url); } catch { return; }
  if (!u.pathname.startsWith('/developer') || !followsConsoleAt(u.origin)) return;
  const [{ result: token } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.getElementById('sidebar-token-value')?.textContent?.trim() || null,
  }).catch(() => []);
  if (!/^aat_[A-Za-z0-9_-]+$/.test(token || '')) return;
  const connection = await readConnection();
  if (connection?.url === u.origin && connection.token === token) return;
  await handlers.connect({ url: u.origin, token });
}
chrome.tabs.onActivated.addListener(({ tabId }) => { followConsole(tabId); });
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
  if (tab) followConsole(tab.id);
});

// ── messages from the side panel and the bridge ───────────────────────────────────

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
  /** Switch one installed adapter off, or on again, everywhere. */
  async setEnabled({ key, on }) {
    const client = await connectionRegistry();
    if (!client) throw new Error('Not connected.');
    const [owner, appId, id] = String(key).split('/');
    await client.install(APP, { owner, appId, id }, { enabled: on === true });
    return sync('enabled');
  },
  /**
   * The person's one shortcut (toolkit/blocks/shortcut.js), in their
   * profile: which adapter it goes to (null turns it off) and its keys.
   */
  async setShortcut({ adapter = null, up, down }) {
    const state = await readState();
    let value = null;
    if (adapter) {
      if (!(state.adapters || []).some(a => keyOf(a) === adapter)) throw new Error('That adapter is not installed in this browser.');
      const keys = { up: up || state.shortcutKeys?.up, down: down || state.shortcutKeys?.down };
      if (!keys.up || !keys.down) Object.assign(keys, shortcutKeysFromProfile(null), up ? { up } : {}, down ? { down } : {});
      for (const k of ['up', 'down']) { const why = checkCombo(keys[k]); if (why) throw new Error(why); keys[k] = normalCombo(keys[k]); }
      if (keys.up === keys.down) throw new Error('The two keys must be different.');
      value = { adapter, ...keys };
    } else {
      // Off keeps the keys the person chose, for next time.
      const keys = { up: up || state.shortcutKeys?.up, down: down || state.shortcutKeys?.down };
      for (const k of ['up', 'down']) if (keys[k]) { const why = checkCombo(keys[k]); if (why) throw new Error(why); keys[k] = normalCombo(keys[k]); }
      value = keys.up && keys.down ? { adapter: null, ...keys } : null;
    }
    await librarian('setProfileField', [`fields.${SHORTCUT_FIELD}`, value]);
    await sync('shortcut');
    return { shortcut: value?.adapter ? value : null };
  },
  /** What the person adjusted with an adapter on this site, for every site. */
  async everySite({ key, origin }) {
    const state = await readState();
    const settings = state.adjustable?.[key]?.settings || [];
    const site = siteOf(origin || '');
    const values = Object.fromEntries(settings.filter(k => state.explicit?.sites?.[site]?.[k] !== undefined).map(k => [k, state.explicit.sites[site][k]]));
    if (!Object.keys(values).length) throw new Error('Nothing set on this site yet.');
    await librarian('recordScopedSettings', ['general', values, { writer: 'person' }]);
    for (const k of Object.keys(values)) await librarian('removeScopedSetting', [`origin:${site}`, k]).catch(() => {});
    await sync('profile');
    return { values };
  },
  /** For the side panel: does this URL fall inside an installed adapter's patterns? */
  async forUrl({ url }) {
    const state = await readState();
    let here;
    try { here = normalizedUrl(url); } catch { return { adapters: [] }; }
    const adapters = state.adapters.filter(a => (a.urlPatterns || []).some(p => new RegExp(urlPatternRegExpSource(p)).test(here)));
    return { adapters, origin: new URL(url).origin };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A console on a toolkit it follows says it shows a token: the runtime
  // reads it from the page itself, and only while that tab is in front.
  if (message?.type === 'followConsole') {
    if (sender.tab?.id == null || !followsConsoleAt(sender.origin)) return false;
    followConsole(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  const handler = handlers[message?.type];
  if (!handler) return false;
  // The extension's own pages (the side panel) may ask anything. The bridge may
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

// The toolbar button opens the side panel (Profile, Builder, Settings); there is no popup.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SYNC_ALARM) sync('alarm'); });
async function start(reason) {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
  await registerBridge().catch(() => {});
  await sync(reason);
  // On first launch too: the console that is already in front.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab) await followConsole(tab.id);
}
chrome.runtime.onInstalled.addListener(() => start('installed'));
chrome.runtime.onStartup.addListener(() => start('startup'));
// The worker also starts for an alarm or a message; open the stream then too.
connectionRegistry().catch(() => {});

// For tests and the console: what this runtime is doing.
globalThis.ai4a11yRuntime = { sync, handlers, readState, zoomRecords };
