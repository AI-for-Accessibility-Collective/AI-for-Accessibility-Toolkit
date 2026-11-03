// The runtime's popup: connect to a toolkit, see which installed adapters
// target the current page and what happened when they ran, and switch one
// off for this site; see every enabled adapter; and give the toolkit's one
// shortcut (toolkit/blocks/shortcut.js) to an adapter and choose its keys,
// saved in the person's profile. Everything else is managed in the
// developer console.

import { comboOf, comboLabel, checkCombo, SHORTCUT_DEFAULT } from '../vendor/blocks/shortcut.js';

const $ = (id) => document.getElementById(id);
let tab = null;
let current = null; // the last status from the service worker
let generation = 0;  // renders overlap (a storage change during one); only the newest writes

async function ask(type, fields = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...fields });
  if (!reply?.ok) throw new Error(reply?.error || 'The runtime did not answer.');
  return reply.result;
}
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

const RESULT_TEXT = {
  applied: 'Running on this page',
  failed: 'Failed',
  skipped: 'Not running',
  removed: 'Switched off',
};

async function render() {
  const mine = ++generation;
  const status = await ask('status');
  if (mine !== generation) return;
  current = status;
  const { connection, state } = current;
  $('state').textContent = connection ? (state.error ? 'Problem' : 'Connected') : 'Not connected';
  $('state').className = `badge${connection ? (state.error ? ' warn' : ' connected') : ''}`;
  $('user-scripts').hidden = !!state.scripts?.available;
  $('connect').hidden = !!connection;
  $('connected').hidden = !connection;
  if (state.error) say(state.error, true);
  if (!connection) return renderConnect();

  $('who-url').textContent = new URL(connection.url).host;
  $('who-uid').textContent = connection.uid;
  $('open-console').href = `${connection.url}/developer#/adapters`;
  renderShortcut(state);
  renderEnabled(state);
  const total = state.adapters.length;
  $('installed-count').textContent = `${total} adapter${total === 1 ? '' : 's'} installed in this browser runtime${state.lastSync ? ` · checked ${new Date(state.lastSync).toLocaleTimeString()}` : ''}.`;

  const list = document.createDocumentFragment();
  const show = (origin) => { $('page-origin').textContent = origin; $('page-adapters').replaceChildren(list); };
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    list.append(el('li', 'empty', 'Adapters run on web pages (http and https).'));
    return show('');
  }
  const { adapters, origin } = await ask('forUrl', { url: tab.url });
  if (mine !== generation) return;
  if (!adapters.length) {
    list.append(el('li', 'empty', 'None of your installed adapters targets this page. Add its address to an adapter’s “Runs on” list in the console.'));
    return show(origin);
  }
  const results = state.tabs?.[tab.id] || {};
  for (const a of adapters) {
    const key = `${a.adapter.owner}/${a.adapter.appId}/${a.adapter.id}`;
    const item = el('li');
    const top = el('div', 'adapter-top');
    top.append(el('strong', '', a.name || a.adapter.id));
    const on = a.sites?.[origin] !== false;
    const label = el('label', 'switch');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.role = 'switch'; box.checked = on && a.enabled && a.available;
    box.disabled = !a.available || !a.enabled;
    box.setAttribute('aria-label', `${a.name || a.adapter.id} on ${origin}`);
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        await ask('setSite', { key, origin, on: box.checked });
        say(box.checked ? `${a.name} is on for ${origin}.` : `${a.name} is off for ${origin}.`);
      } catch (e) { say(e.message, true); box.checked = !box.checked; }
      render().catch(e => say(e.message, true));
    });
    label.append(box, document.createTextNode('This site'));
    top.append(label);
    item.append(top);
    item.append(el('span', 'from', `${a.appName || a.adapter.appId} · ${a.mine ? 'yours' : `shared by ${a.owner}`} · revision ${a.revision ?? '–'}`));
    const r = results[key];
    if (!a.available) item.append(el('span', 'result failed', a.reason === 'not-shared' ? 'No longer shared by its owner.' : 'Deleted by its owner.'));
    else if (!a.enabled) item.append(el('span', 'result', 'Switched off in the console.'));
    else if (!on) item.append(el('span', 'result', 'Off on this site.'));
    else if (r) item.append(el('span', `result ${r.status}`, `${RESULT_TEXT[r.status] || r.status}${r.message ? `: ${r.message}` : ''}`));
    else item.append(el('span', 'result', 'Runs when the page loads. Reload the page if it was open before.'));
    // What the person adjusted with it here, for every site.
    const adj = state.adjustable?.[key];
    const site = new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
    const setHere = (adj?.settings || []).filter(k => state.explicit?.sites?.[site]?.[k] !== undefined);
    if (setHere.length) {
      const every = el('button', 'secondary every-site', `Use my ${adj.label.toLowerCase()} on every site`);
      every.type = 'button';
      every.addEventListener('click', async () => {
        every.disabled = true;
        try { await ask('everySite', { key, origin }); say(`Your ${adj.label.toLowerCase()} from ${site} is now used on every site.`); } catch (e) { say(e.message, true); every.disabled = false; }
      });
      item.append(every);
    }
    list.append(item);
  }
  show(origin);
}

// ── the shortcut ─────────────────────────────────────────────────────────────

let capturing = null; // 'up' | 'down' while waiting for the person's keys

function renderShortcut(state) {
  const keys = state.shortcutKeys || SHORTCUT_DEFAULT;
  const assigned = state.shortcutSetting?.adapter || '';
  const enabled = (state.adapters || []).filter(a => a.enabled && a.available && a.portable);
  const select = $('shortcut-adapter');
  const options = [el('option', '', 'Off')];
  options[0].value = '';
  for (const a of enabled) {
    const key = `${a.adapter.owner}/${a.adapter.appId}/${a.adapter.id}`;
    const o = el('option', '', a.name || a.adapter.id);
    o.value = key;
    options.push(o);
  }
  if (document.activeElement !== select) { select.replaceChildren(...options); select.value = assigned; }
  if (capturing !== 'up') $('key-up').textContent = comboLabel(keys.up);
  if (capturing !== 'down') $('key-down').textContent = comboLabel(keys.down);
  const a = enabled.find(x => `${x.adapter.owner}/${x.adapter.appId}/${x.adapter.id}` === assigned);
  const adj = a && state.adjustable?.[assigned];
  $('shortcut-does').textContent = !a ? 'Off. Choose an adapter to use the keys.'
    : adj ? `${comboLabel(keys.up)} and ${comboLabel(keys.down)} adjust ${adj.label.toLowerCase()} in ${a.name}. On a site where it is off, ${comboLabel(keys.up)} turns it on.`
      : `${comboLabel(keys.up)} turns ${a.name} on and off on the site you are on.`;
}

$('shortcut-adapter').addEventListener('change', async () => {
  const adapter = $('shortcut-adapter').value || null;
  try {
    await ask('setShortcut', { adapter });
    say(adapter ? `The shortcut is for ${$('shortcut-adapter').selectedOptions[0].textContent}.` : 'The shortcut is off.');
  } catch (e) { say(e.message, true); }
  render().catch(e => say(e.message, true));
});

function startCapture(which) {
  capturing = which;
  const kbd = $(`key-${which}`);
  kbd.textContent = 'Press the keys…';
  kbd.classList.add('capturing');
  say(`Press the new ${which} keys, with Alt (Option on a Mac). Escape cancels.`);
}
function stopCapture() {
  if (!capturing) return;
  $(`key-${capturing}`).classList.remove('capturing');
  capturing = null;
}
$('change-up').addEventListener('click', () => startCapture('up'));
$('change-down').addEventListener('click', () => startCapture('down'));
document.addEventListener('keydown', async (e) => {
  if (!capturing) return;
  if (e.key === 'Escape') { e.preventDefault(); stopCapture(); say('Kept the keys as they were.'); render().catch(() => {}); return; }
  const combo = comboOf(e);
  if (!combo) return; // a modifier on its own: wait for the key
  e.preventDefault();
  const why = checkCombo(combo);
  if (why) { say(why, true); return; }
  const which = capturing;
  stopCapture();
  try {
    await ask('setShortcut', { adapter: current?.state?.shortcutSetting?.adapter || null, [which]: combo });
    say(`The ${which} key is now ${comboLabel(combo)}.`);
  } catch (err) { say(err.message, true); }
  render().catch(() => {});
}, true);
$('reset-keys').addEventListener('click', async () => {
  try {
    await ask('setShortcut', { adapter: current?.state?.shortcutSetting?.adapter || null, ...SHORTCUT_DEFAULT });
    say(`The keys are ${comboLabel(SHORTCUT_DEFAULT.up)} and ${comboLabel(SHORTCUT_DEFAULT.down)}.`);
  } catch (e) { say(e.message, true); }
  render().catch(() => {});
});

// ── every enabled adapter ────────────────────────────────────────────────────

function renderEnabled(state) {
  const enabled = (state.adapters || []).filter(a => a.enabled && a.available);
  const items = enabled.map((a) => {
    const item = el('li');
    const key = `${a.adapter.owner}/${a.adapter.appId}/${a.adapter.id}`;
    item.append(el('strong', '', a.name || a.adapter.id));
    const where = (a.urlPatterns || []).slice(0, 3).join(', ') + ((a.urlPatterns || []).length > 3 ? ', …' : '');
    item.append(el('span', 'from', `Runs on ${where || 'no pages'}${!a.portable ? ' · cannot run in the browser' : ''}`));
    const off = Object.entries(a.sites || {}).filter(([, on]) => on === false).map(([o]) => new URL(o).host);
    if (off.length) item.append(el('span', 'result', `Off on ${off.join(', ')}`));
    if (state.shortcutSetting?.adapter === key) item.append(el('span', 'result applied', 'Has the shortcut'));
    return item;
  });
  if (!items.length) items.push(el('li', 'empty', 'No adapter is enabled. Install one in the console.'));
  $('enabled-adapters').replaceChildren(...items);
}

async function renderConnect() {
  $('use-console').hidden = true;
  if (!tab?.url) return;
  let u;
  try { u = new URL(tab.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || !u.pathname.startsWith('/developer')) return;
  // A toolkit answers /v1/healthz with {ok, version}.
  try {
    const health = await (await fetch(`${u.origin}/v1/healthz`)).json();
    if (health?.ok !== true) return;
  } catch { return; }
  $('console-origin').textContent = u.origin;
  $('use-console').hidden = false;
  $('manual').open = false;
  $('url').value = u.origin;
}

$('use-console-button').addEventListener('click', async () => {
  try {
    const [{ result: token }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // The console shows the signed-in developer's default token in its sidebar.
      func: () => document.getElementById('sidebar-token-value')?.textContent?.trim() || null,
    });
    if (!token || !token.startsWith('aat_')) throw new Error('Sign in to the console first, then try again.');
    const who = await ask('connect', { url: new URL(tab.url).origin, token });
    say(`Connected as ${who.uid}.`);
    await render();
  } catch (e) { say(e.message, true); }
});

$('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const who = await ask('connect', { url: $('url').value, token: $('token').value });
    $('token').value = '';
    say(`Connected as ${who.uid}.`);
    await render();
  } catch (e) { say(e.message, true); }
});

$('sync').addEventListener('click', async () => {
  try { await ask('sync'); say('Synced with the toolkit.'); await render(); } catch (e) { say(e.message, true); }
});
$('disconnect').addEventListener('click', async () => {
  try { await ask('disconnect'); say('Disconnected. Adapters stopped running in this browser.'); await render(); } catch (e) { say(e.message, true); }
});
// The assistant sidebar opens beside the page this popup is about.
$('open-assistant').addEventListener('click', async () => {
  try { await chrome.sidePanel.open({ windowId: tab?.windowId ?? (await chrome.windows.getCurrent()).id }); window.close(); } catch (e) { say(e.message, true); }
});
$('open-details').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.runtimeState) render().catch(() => {});
});

// The page the popup is about: the active tab, or one named with ?tab=<id>
// (how a test opens the popup as a page of its own).
const named = Number(new URLSearchParams(location.search).get('tab'));
tab = named ? await chrome.tabs.get(named).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
render().catch(e => say(e.message, true));
// Opening the popup syncs too, so it shows what is installed now, not at the
// last alarm (up to 30 seconds ago). An unchanged answer is cheap (etag), and
// the storage listener above redraws when the sync writes.
ask('sync').catch(() => {});
