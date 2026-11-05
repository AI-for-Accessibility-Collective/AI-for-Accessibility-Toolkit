// The side panel's Settings tab (what the toolbar popup used to hold):
// connect to a toolkit, allow user scripts, give the toolkit's one shortcut
// (toolkit/blocks/shortcut.js) to an adapter and choose its keys, saved in
// the person's profile; sync, disconnect, and a link to the developer
// console. The adapters themselves are on the Profile tab.

import { comboOf, comboLabel, checkCombo, SHORTCUT_DEFAULT } from '../vendor/blocks/shortcut.js';
import { $, say, el, ask, pageTab, keyOf } from './ui.js';

let current = null;  // the last status from the service worker
let generation = 0;  // renders overlap (a storage change during one); only the newest writes
let capturing = null; // 'up' | 'down' while waiting for the person's keys

export async function renderSettings() {
  const mine = ++generation;
  const status = await ask('status');
  if (mine !== generation) return;
  current = status;
  const { connection, state } = current;
  $('user-scripts').hidden = !!state.scripts?.available;
  $('connect').hidden = !!connection;
  $('connected').hidden = !connection;
  if (!connection) return renderConnect();
  $('who-url').textContent = new URL(connection.url).host;
  $('who-uid').textContent = connection.uid;
  $('open-console').href = `${connection.url}/developer#/adapters`;
  renderShortcut(state);
  const total = state.adapters.length;
  $('installed-count').textContent = `${total} adapter${total === 1 ? '' : 's'} installed in this browser${state.lastSync ? ` · checked ${new Date(state.lastSync).toLocaleTimeString()}` : ''}.`;
}

// ── the shortcut ─────────────────────────────────────────────────────────────

function renderShortcut(state) {
  const keys = state.shortcutKeys || SHORTCUT_DEFAULT;
  const assigned = state.shortcutSetting?.adapter || '';
  const enabled = (state.adapters || []).filter(a => a.enabled && a.available && a.portable);
  const select = $('shortcut-adapter');
  const options = [el('option', '', 'Off')];
  options[0].value = '';
  for (const a of enabled) {
    const o = el('option', '', a.name || a.adapter.id);
    o.value = keyOf(a);
    options.push(o);
  }
  if (document.activeElement !== select) { select.replaceChildren(...options); select.value = assigned; }
  if (capturing !== 'up') $('key-up').textContent = comboLabel(keys.up);
  if (capturing !== 'down') $('key-down').textContent = comboLabel(keys.down);
  const a = enabled.find(x => keyOf(x) === assigned);
  const adj = a && state.adjustable?.[assigned];
  $('shortcut-does').textContent = !a ? 'Off. Choose an adapter to use the keys.'
    : adj ? `${comboLabel(keys.up)} and ${comboLabel(keys.down)} adjust ${adj.label.toLowerCase()} in ${a.name}. On a site where it is off, ${comboLabel(keys.up)} turns it on.`
      : `${comboLabel(keys.up)} turns ${a.name} on and off on the site you are on.`;
}

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

async function renderConnect() {
  $('use-console').hidden = true;
  const tab = await pageTab();
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

/** Wire the tab's controls once. `refresh` redraws the whole panel. */
export function initSettings({ refresh }) {
  const again = () => refresh().catch(e => say(e.message, true));
  $('shortcut-adapter').addEventListener('change', async () => {
    const adapter = $('shortcut-adapter').value || null;
    try {
      await ask('setShortcut', { adapter });
      say(adapter ? `The shortcut is for ${$('shortcut-adapter').selectedOptions[0].textContent}.` : 'The shortcut is off.');
    } catch (e) { say(e.message, true); }
    again();
  });
  $('change-up').addEventListener('click', () => startCapture('up'));
  $('change-down').addEventListener('click', () => startCapture('down'));
  document.addEventListener('keydown', async (e) => {
    if (!capturing) return;
    if (e.key === 'Escape') { e.preventDefault(); stopCapture(); say('Kept the keys as they were.'); again(); return; }
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
    again();
  }, true);
  $('reset-keys').addEventListener('click', async () => {
    try {
      await ask('setShortcut', { adapter: current?.state?.shortcutSetting?.adapter || null, ...SHORTCUT_DEFAULT });
      say(`The keys are ${comboLabel(SHORTCUT_DEFAULT.up)} and ${comboLabel(SHORTCUT_DEFAULT.down)}.`);
    } catch (e) { say(e.message, true); }
    again();
  });

  $('use-console-button').addEventListener('click', async () => {
    try {
      const tab = await pageTab();
      const [{ result: token }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // The console shows the signed-in developer's default token in its sidebar.
        func: () => document.getElementById('sidebar-token-value')?.textContent?.trim() || null,
      });
      if (!token || !token.startsWith('aat_')) throw new Error('Sign in to the console first, then try again.');
      const who = await ask('connect', { url: new URL(tab.url).origin, token });
      say(`Connected as ${who.uid}.`);
    } catch (e) { say(e.message, true); }
  });
  $('connect-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const who = await ask('connect', { url: $('url').value, token: $('token').value });
      $('token').value = '';
      say(`Connected as ${who.uid}.`);
    } catch (e) { say(e.message, true); }
  });
  $('sync').addEventListener('click', async () => {
    try { await ask('sync'); say('Synced with the toolkit.'); again(); } catch (e) { say(e.message, true); }
  });
  $('disconnect').addEventListener('click', async () => {
    try { await ask('disconnect'); say('Disconnected. Adapters stopped running in this browser.'); } catch (e) { say(e.message, true); }
  });
  $('open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });
}
