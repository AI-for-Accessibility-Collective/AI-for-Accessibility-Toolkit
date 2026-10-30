// The runtime's popup: connect to a toolkit, see which installed adapters
// target the current page and what happened when they ran, and switch one
// off for this site. Everything else is managed in the developer console.

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
    list.append(item);
  }
  show(origin);
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
