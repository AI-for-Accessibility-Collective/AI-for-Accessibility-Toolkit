import { BUILTIN_PROFILES } from './profiles.js';
import { createClient, editableProfile, profileRows, setKey, removeKey, validateProfile, readSaved, writeSaved, signIn, readSession, writeSession } from './client.js';
import { createValueEditor, VALUE_DEFAULTS } from './value-editor.js';
import { createAdaptersPage } from './adapters.js';
import { createAppsPage } from './apps.js';
import { createAccountPage } from './account.js';

const $ = id => document.getElementById(id);
let client = null, saved = [], draft = {}, selectedId = null, activeId = null, filter = 'all', busy = false;
// `session` is true when signed in with an account (presets and tokens live
// in the account); false when connected with a bare access token.
let session = false, defaultToken = null;
let editors = [], newValueEditor;
const controls = ['new-profile', 'connect', 'signin', 'disconnect', 'refresh', 'apply', 'save', 'use-json'];
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function dirty() { $('draft-state').textContent = 'Draft changes'; }
function updateControls() {
  for (const id of controls) $(id).disabled = busy || (['refresh', 'apply'].includes(id) && !client);
  $('signin-form').hidden = !!client;
  $('token-connect').hidden = !!client;
  $('signed-in').hidden = !client;
  $('disconnect').hidden = !client;
  $('disconnect').textContent = session ? 'Sign out' : 'Disconnect';
  $('instance-url').disabled = busy || !!client;
  $('instance-token').disabled = busy || !!client;
  $('signin-username').disabled = busy || !!client;
  $('signin-password').disabled = busy || !!client;
  for (const node of document.querySelectorAll('#key-list input, #key-list textarea, #key-list select, #key-list button, #add-form input, #add-form textarea, #add-form select, #add-form button, #profile-name, #profile-description, #profile-json')) node.disabled = busy;
  for (const node of document.querySelectorAll('[data-load]')) node.disabled = busy || !client;
  for (const node of document.querySelectorAll('[data-delete]')) node.disabled = busy;
  for (const node of document.querySelectorAll('.remove')) node.disabled = busy;
}
async function run(task) {
  if (busy) return;
  busy = true;
  updateControls();
  try { await task(); } catch (error) { status(error.message, true); }
  finally { busy = false; updateControls(); }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function parseValue(text, key) {
  try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON for ${key}. Put text in double quotes.`); }
}
function readEditor(exclude) {
  const next = structuredClone(draft);
  for (const { path, editor } of editors) if (editor !== exclude) setKey(next, path, editor.read());
  return validateProfile(next);
}
function editorChanged() {
  dirty();
  try { $('profile-json').value = JSON.stringify(readEditor(), null, 2); } catch { /* Keep incomplete input available for correction. */ }
}
function renderEditor() {
  $('key-list').replaceChildren();
  editors = [];
  const rows = profileRows(draft);
  $('key-count').textContent = rows.length;
  if (!rows.length) $('key-list').append(element('p', 'empty', 'Start with a key below, or connect and load a profile from the library.'));
  rows.forEach(({ path, value }, index) => {
    const row = element('div', 'key-row');
    const editor = createValueEditor({ value, path, id: `key-${index}`, onChange: editorChanged });
    editors.push({ path, editor });
    const label = element('label', 'key-label', path.join('.'));
    label.htmlFor = editor.id;
    label.id = `key-label-${index}`;
    if (editor.element.tagName === 'DIV') {
      editor.element.setAttribute('role', 'group');
      editor.element.setAttribute('aria-labelledby', label.id);
    }
    if (path.join('.') === 'fields.needs') row.classList.add('needs-row');
    const remove = element('button', 'remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${path.join('.')}`);
    remove.addEventListener('click', () => run(async () => {
      // Read all OTHER controls first so an incomplete field can be removed.
      const next = readEditor(editor);
      removeKey(next, path);
      draft = next;
      renderEditor(); dirty();
      status(`Removed ${path.join('.')} from the draft. Apply to update the toolkit.`);
    }));
    row.append(label, editor.element, remove);
    $('key-list').append(row);
  });
  $('profile-json').value = JSON.stringify(draft, null, 2);
  updateControls();
}
function renderNewValue() {
  newValueEditor = createValueEditor({ value: structuredClone(VALUE_DEFAULTS[$('new-type').value]), path: ['newValue'], id: 'new-value', onChange() {} });
  $('new-value-control').replaceChildren(newValueEditor.element);
  updateControls();
}
function renderLibrary() {
  const all = [...BUILTIN_PROFILES, ...saved];
  $('profile-count').textContent = all.length;
  const search = $('profile-search').value.trim().toLowerCase();
  const shown = all.filter(item => (filter !== 'custom' || item.id.startsWith('custom-'))
    && `${item.name} ${item.description || ''}`.toLowerCase().includes(search));
  $('profile-list').replaceChildren();
  if (!shown.length) $('profile-list').append(element('p', 'empty', 'No profiles here yet. Create a profile and save it as a preset.'));
  for (const item of shown) {
    const card = element('article', `profile-card${activeId === item.id ? ' active' : ''}`);
    const heading = element('h3', '', item.name);
    if (item.description) heading.append(element('span', 'descriptor', ` (${item.description})`));
    const actions = element('div', 'card-actions');
    const load = element('button', 'secondary', 'Load profile');
    load.type = 'button'; load.dataset.load = item.id;
    load.setAttribute('aria-label', `Load ${item.name}${item.description ? ` (${item.description})` : ''}`);
    load.addEventListener('click', () => run(async () => {
      const result = await client.call('replaceProfile', validateProfile(item.profile));
      draft = editableProfile(result); selectedId = item.id; activeId = item.id;
      $('profile-name').value = item.name; $('profile-description').value = item.description || '';
      $('draft-state').textContent = 'Applied';
      renderEditor(); renderLibrary();
      status(`${item.name} loaded. The toolkit’s active profile is updated.`);
    }));
    actions.append(load);
    if (item.source) {
      const link = element('a', '', 'WAI story ↗');
      link.href = item.source; link.target = '_blank'; link.rel = 'noreferrer';
      link.setAttribute('aria-label', `WAI source story for ${item.name}`);
      actions.append(link);
    } else {
      const remove = element('button', 'delete', 'Delete');
      remove.type = 'button'; remove.dataset.delete = item.id;
      remove.setAttribute('aria-label', `Delete saved preset ${item.name}`);
      remove.addEventListener('click', () => run(async () => {
        const next = saved.filter(p => p.id !== item.id);
        await storePresets(next); saved = next;
        if (selectedId === item.id) selectedId = null;
        if (activeId === item.id) activeId = null;
        renderLibrary();
        status(`Deleted saved preset ${item.name}. The toolkit’s active profile is unchanged.`);
      }));
      actions.append(remove);
    }
    card.append(heading, element('p', '', item.profile.freeText || 'Custom developer profile.'), actions);
    $('profile-list').append(card);
  }
  updateControls();
}

// Presets live in the signed-in account (so they follow the developer to
// another browser), or in this browser when connected with a bare token.
async function storePresets(next) {
  if (session && client) await client.account.savePresets(next);
  else writeSaved(localStorage, next);
}
async function loadPresets() {
  let local = [];
  try { local = readSaved(localStorage); } catch (error) { status(`Could not read presets saved in this browser: ${error.message}`, true); }
  if (!(session && client)) return local;
  const remote = (await client.account.presets()).filter(item => { try { validateProfile(item.profile); return true; } catch { return false; } });
  // First sign-in from a browser that already had presets: bring them along.
  if (!remote.length && local.length) {
    await client.account.savePresets(local);
    return local;
  }
  return remote;
}

$('instance-url').value = location.origin;
try { saved = readSaved(localStorage); } catch (error) { status(`Could not read saved presets: ${error.message}`, true); }
renderEditor(); renderLibrary();
renderNewValue();

// ── pages: sidebar navigation + the shared connection ──────────────────────
// One connection serves both pages; the hash picks the page (#/profiles,
// #/adapters) so the whitelisted asset list stays a single HTML document.
const appsPage = createAppsPage({
  getClient: () => client, getAppToken: () => defaultToken, status, run,
  onLiveCount(n) { $('nav-live').hidden = !n; $('nav-live').textContent = String(n); $('nav-live').setAttribute('aria-label', `${n} live`); },
});
const adaptersPage = createAdaptersPage({ getClient: () => client, status, run, getHiddenApps: () => appsPage.hiddenApps });
const accountPage = createAccountPage({
  getClient: () => client, isSession: () => session, status, run,
  onDefaultToken(token, account) {
    defaultToken = token;
    $('sidebar-token-value').textContent = token;
    $('sidebar-token').hidden = !token;
    if (account) { $('account-name').textContent = account.displayName; $('account-uid').textContent = `(${account.uid})`; }
  },
});
const pages = new Map([['profiles', $('page-profiles')], ['apps', $('page-apps')], ['adapters', $('page-adapters')], ['account', $('page-account')]]);
const PAGE_LABELS = { profiles: ['PROFILE MANAGER', 'Profiles'], apps: ['CONNECTED APPS', 'Apps'], adapters: ['ADAPTER MARKETPLACE', 'Marketplace'], account: ['ACCOUNT', 'Account & tokens'] };
function showPage(name) {
  if (!pages.has(name)) name = 'profiles';
  for (const [key, node] of pages) node.hidden = key !== name;
  for (const link of document.querySelectorAll('.nav-link')) {
    const active = link.dataset.page === name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('environment').textContent = PAGE_LABELS[name][0];
  document.title = `${PAGE_LABELS[name][1]} · Toolkit Developer`;
  appsPage.setActive(name === 'apps');
  if (name === 'adapters') adaptersPage.refresh();
  if (name === 'account') accountPage.refresh();
}
const pageFromHash = () => (location.hash.match(/^#\/([a-z-]+)/) || [, 'profiles'])[1];
window.addEventListener('hashchange', () => showPage(pageFromHash()));
showPage(pageFromHash());

$('new-type').addEventListener('change', renderNewValue);
// One path for both ways in: an account sign-in (session) or a bare token.
async function connectWith(candidate, { asSession, account = null, token = null }) {
  const identity = await candidate.whoami();
  const profile = await candidate.call('getProfile');
  draft = editableProfile(validateProfile(profile));
  client = candidate; session = asSession; selectedId = null; activeId = null;
  // A bare app token can itself connect apps; a session hands out the default token.
  defaultToken = asSession ? token : (identity.kind === 'session' ? null : candidate.token);
  saved = await loadPresets();
  $('connection-state').textContent = asSession ? 'Signed in' : `Connected · ${identity.uid}`;
  $('connection-state').classList.add('connected');
  $('account-name').textContent = account?.displayName || identity.uid;
  $('account-uid').textContent = account ? `(${account.uid})` : '(access token)';
  $('sidebar-token-value').textContent = defaultToken || '';
  $('sidebar-token').hidden = !defaultToken;
  $('editor-heading').textContent = 'Active toolkit profile';
  $('profile-name').value = 'My profile'; $('profile-description').value = '';
  $('draft-state').textContent = 'In sync';
  renderEditor(); renderLibrary();
  appsPage.reset();
  await Promise.all([adaptersPage.refresh(), appsPage.refresh({ quiet: true }), accountPage.refresh()]);
  return identity;
}

$('signin-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const result = await signIn(location.origin, $('signin-username').value, $('signin-password').value);
    $('signin-password').value = '';
    const candidate = createClient(location.origin, result.token);
    writeSession(localStorage, { base: candidate.base, token: result.token, expiresAt: result.expiresAt, uid: result.account.uid });
    await connectWith(candidate, { asSession: true, account: result.account, token: result.defaultToken });
    status(`Signed in as ${result.account.displayName}. Your default token is in the sidebar; apps that connect with it appear under Apps.`);
  });
});
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const candidate = createClient($('instance-url').value, $('instance-token').value);
    const identity = await connectWith(candidate, { asSession: false });
    $('instance-token').value = '';
    status(`Connected to ${identity.uid}. Read the active toolkit profile.`);
  });
});
$('disconnect').addEventListener('click', () => run(async () => {
  const wasSession = session;
  if (wasSession) await client.account.logout().catch(() => {});
  writeSession(localStorage, null);
  client = null; session = false; defaultToken = null; activeId = null;
  try { saved = readSaved(localStorage); } catch { saved = []; }
  $('instance-token').value = '';
  $('connection-state').textContent = 'Signed out'; $('connection-state').classList.remove('connected');
  $('editor-heading').textContent = 'Current profile'; $('draft-state').textContent = 'Draft';
  $('sidebar-token').hidden = true;
  renderLibrary(); appsPage.reset(); accountPage.clear();
  await Promise.all([adaptersPage.refresh(), appsPage.refresh()]);
  status(wasSession ? 'Signed out. Your apps keep working with your default token.' : 'Disconnected. The editor draft is available to save locally.');
}));
$('sidebar-token-copy').addEventListener('click', () => run(async () => {
  await navigator.clipboard.writeText(defaultToken);
  status('Default token copied. Paste it into your app’s toolkit settings.');
}));

// A signed-in console survives a reload until its session expires.
const remembered = readSession(localStorage);
if (remembered && remembered.base === location.origin) {
  run(async () => {
    try {
      const candidate = createClient(remembered.base, remembered.token);
      const overview = await candidate.account.get();
      await connectWith(candidate, { asSession: true, account: overview.account, token: overview.defaultToken });
      status(`Signed in as ${overview.account.displayName}.`);
    } catch {
      writeSession(localStorage, null);
      status('Your sign-in expired. Sign in again.');
    }
  });
}
$('new-profile').addEventListener('click', () => {
  draft = { supportAreas: [], freeText: '', fields: { needs: [] }, metaPreferences: { language: 'standard' } };
  selectedId = null;
  $('profile-name').value = 'My profile'; $('profile-description').value = '';
  renderEditor(); dirty();
  $('profile-name').focus(); status('New profile draft. Add keys, then save a preset or apply it to the toolkit.');
});
$('refresh').addEventListener('click', () => run(async () => {
  draft = editableProfile(await client.call('getProfile')); selectedId = null; activeId = null;
  $('profile-name').value = 'My profile'; $('profile-description').value = '';
  renderEditor(); renderLibrary(); $('draft-state').textContent = 'In sync';
  status('Read the current profile from the toolkit.');
}));
$('apply').addEventListener('click', () => run(async () => {
  const result = await client.call('replaceProfile', readEditor());
  draft = editableProfile(result); activeId = null;
  renderEditor(); renderLibrary(); $('draft-state').textContent = 'Applied';
  status('Profile applied to the toolkit, including added and removed keys.');
}));
$('save').addEventListener('click', () => run(async () => {
  const name = $('profile-name').value.trim();
  if (!name) throw new Error('Enter a preset name before saving.');
  const profile = readEditor();
  const id = selectedId?.startsWith('custom-') ? selectedId : `custom-${crypto.randomUUID()}`;
  const item = { id, name, description: $('profile-description').value.trim(), profile };
  const next = [...saved.filter(p => p.id !== id), item];
  await storePresets(next); saved = next; selectedId = id; draft = profile;
  renderEditor(); renderLibrary();
  status(`Saved ${name} ${session ? 'in your account' : 'in this browser'}. Load the preset or apply the draft to update the toolkit.`);
}));
$('add-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const next = readEditor();
    const path = $('new-key').value.trim().split('.');
    const exists = profileRows(next).some(row => row.path.length === path.length && row.path.every((part, index) => part === path[index]));
    if (exists) throw new Error('That key already exists. Edit its value above.');
    // Do not let an add silently replace an existing object subtree either.
    let parent = next;
    for (const key of path.slice(0, -1)) parent = parent?.[key];
    if (parent && Object.hasOwn(parent, path.at(-1))) throw new Error('That key already exists. Edit it in the full JSON view.');
    setKey(next, path, newValueEditor.read());
    validateProfile(next); draft = next;
    $('new-key').value = ''; renderEditor(); dirty();
    status(`Added ${path.join('.')} to the draft.`);
  });
});
$('use-json').addEventListener('click', () => run(async () => {
  draft = editableProfile(validateProfile(parseValue($('profile-json').value, 'profile')));
  renderEditor(); dirty(); status('JSON loaded into the draft. Apply to update the toolkit.');
}));
$('profile-search').addEventListener('input', renderLibrary);
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const tab of document.querySelectorAll('[data-filter]')) tab.setAttribute('aria-pressed', tab === button ? 'true' : 'false');
  renderLibrary();
});
window.addEventListener('storage', event => {
  if (event.key === 'ai4a11y.developer.profiles.v1' && !session) {
    try { saved = readSaved(localStorage); renderLibrary(); } catch (error) { status(error.message, true); }
  }
});
