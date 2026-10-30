// The Adapters page: see the adapters you built, run them in your browser
// with the adapter runtime extension, share it, and install what others
// shared (docs/design/adapter-mcp.md §14). Everything goes through the
// toolkit's registry at /v1/mcp with the SDK's registry client; the browser
// runtime reports back what happened on each site.

import {
  createRegistryClient, lintWebModule, urlPatternError, BROWSER_RUNTIME_APP,
} from '/sdk/toolkit/adapter-mcp/index.js';
import { visibilityControl } from './visibility.js';

const $ = id => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}
function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString();
}
const keyOf = (a) => `${a.owner}/${a.appId}/${a.id}`;

const RESULT_TEXT = { applied: 'Running', failed: 'Failed', skipped: 'Not running', removed: 'Switched off' };

export function createAdaptersPage({ getClient, getAppToken = () => null, status, run }) {
  let registry = null;     // for the current connection
  let uid = null;
  let mine = [], shared = [], installed = new Map(), results = [], instances = [], apps = [];
  let restrictions = new Map(); // adapter key -> the level the person narrowed it to
  let tab = 'mine';
  let editing = null;      // the adapter_get result being edited
  let active = false;
  let watching = null;
  let runtimeHere = null;  // what the extension's bridge said, in this browser
  let refreshTimer = null;

  function registryFor(client) {
    if (!client) return null;
    if (!registry || registry.base !== client.base || registry.token !== client.token) {
      registry = Object.assign(createRegistryClient({ url: client.base, token: client.token }), { base: client.base, token: client.token });
      uid = null;
    }
    return registry;
  }

  // A read-only reload; not wrapped in run(), because it is also called from
  // inside the workspace's run() when the connection changes.
  async function refresh() {
    const r = registryFor(getClient());
    if (!r) {
      mine = []; shared = []; installed = new Map(); results = []; instances = []; apps = []; restrictions = new Map();
      closeEditor();
      render();
      return;
    }
    try {
      const client = getClient();
      const [who, a, b, inst, st, appList, visibility] = await Promise.all([
        uid ? { uid } : client.whoami(),
        r.search({ scope: 'mine' }), r.search({ scope: 'shared' }),
        r.installed(BROWSER_RUNTIME_APP), r.status({ app: BROWSER_RUNTIME_APP }),
        client.apps.list().catch(() => ({ apps: [] })),
        r.access.get().catch(() => ({ adapters: [] })),
      ]);
      restrictions = new Map(visibility.adapters.map(x => [keyOf(x.adapter), x.restricted]));
      uid = who.uid;
      mine = a.adapters;
      shared = b.adapters.filter(x => !x.mine);
      installed = new Map((inst.adapters || []).map(x => [keyOf(x.adapter), x]));
      results = st.results;
      instances = st.instances;
      apps = appList.apps.filter(x => x.appId !== BROWSER_RUNTIME_APP);
      render();
    } catch (error) {
      status(error.message, true);
    }
  }
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (active) refresh(); }, 300);
  }

  // ── list ──────────────────────────────────────────────────────────────────

  function render() {
    renderRuntime();
    $('ws-new').disabled = !getClient();
    for (const t of document.querySelectorAll('[data-ws-tab]')) t.setAttribute('aria-pressed', String(t.dataset.wsTab === tab));
    const groups = $('ws-groups');
    groups.replaceChildren();
    if (!getClient()) {
      $('ws-count').textContent = '0';
      groups.append(element('p', 'empty', 'Sign in in the sidebar to write, run and share adapters.'));
      return;
    }
    const search = $('ws-search').value.trim().toLowerCase();
    const list = (tab === 'mine' ? mine : shared)
      .filter(a => !search || `${a.name} ${a.description} ${a.appName} ${a.adapter.id} ${a.owner} ${(a.urlPatterns || []).join(' ')}`.toLowerCase().includes(search));
    $('ws-count').textContent = String(list.length);
    if (!list.length) {
      groups.append(element('p', 'empty', tab === 'mine'
        ? (mine.length ? 'None of your adapters match.' : 'You have no adapters yet. Choose + New adapter to write one, or publish one from your app with the SDK.')
        : (shared.length ? 'No shared adapters match.' : 'Nobody has shared an adapter on this toolkit yet.')));
      return;
    }
    const byApp = new Map();
    for (const a of list) {
      const k = a.adapter.appId;
      if (!byApp.has(k)) byApp.set(k, { name: a.appName || k, items: [] });
      byApp.get(k).items.push(a);
    }
    for (const [appId, { name, items }] of byApp) {
      const group = element('section', 'adapter-group');
      const heading = element('div', 'section-heading');
      heading.append(element('h3', '', name), element('span', 'count', String(items.length)));
      group.append(heading);
      if (name !== appId) group.append(element('p', 'adapter-group-id', `app id: ${appId}`));
      const grid = element('div', 'adapter-grid');
      for (const a of items) grid.append(tab === 'mine' ? mineCard(a) : sharedCard(a));
      group.append(grid);
      groups.append(group);
    }
  }

  function cardTop(a, badges) {
    const card = element('article', 'adapter-card');
    card.dataset.adapter = keyOf(a.adapter);
    const title = element('div', 'adapter-title');
    title.append(element('h4', '', a.name));
    for (const [cls, text] of badges) title.append(element('span', `badge ${cls}`, text));
    card.append(title);
    return card;
  }
  function details(card, a, meta) {
    card.append(element('p', 'adapter-id', meta));
    if (a.description) card.append(element('p', 'adapter-description', a.description));
    const pills = element('div', 'pills');
    for (const p of a.urlPatterns || []) pills.append(element('span', 'pill url', p));
    for (const area of a.supportAreas || []) pills.append(element('span', 'pill area', area));
    if (pills.children.length) card.append(pills);
  }
  function runtimeLines(card, a) {
    const key = keyOf(a.adapter);
    const mineResults = results.filter(r => keyOf(r.adapter) === key).slice(0, 4);
    if (!mineResults.length) return;
    const list = element('ul', 'runtime-results');
    list.setAttribute('aria-label', `What happened when ${a.name} ran`);
    for (const r of mineResults) {
      const item = element('li', `result ${r.status}`);
      item.append(element('span', 'dot' + (r.status === 'applied' ? ' is-live' : r.status === 'failed' ? ' is-failed' : '')));
      item.append(element('span', '', `${RESULT_TEXT[r.status] || r.status} on ${r.origin || 'a page'}${r.revision ? ` · revision ${r.revision}` : ''} · ${r.label || 'browser'} · ${ago(r.at)}${r.message ? ` — ${r.message}` : ''}`));
      list.append(item);
    }
    card.append(list);
  }

  function visibilityOf(a) {
    return visibilityControl({
      id: `visibility-${keyOf(a.adapter).replaceAll(/[^a-z0-9]/gi, '-')}`, name: a.name,
      declared: a.visibility || 'user', restricted: restrictions.get(keyOf(a.adapter)) || null, levels: ['app', 'adapter'],
      onChange: (level) => run(async () => {
        await registry.access.restrict({ adapter: a.adapter }, level);
        await refresh();
        status(level ? `Narrowed who can read what ${a.name} gives the toolkit.` : `${a.name} is back to what it declares.`);
      }),
    });
  }

  function runToggle(a) {
    const key = keyOf(a.adapter);
    const inst = installed.get(key);
    const on = !!inst;
    return button(on ? 'secondary' : 'primary', on ? 'Stop running in my browser' : 'Run in my browser', () => run(async () => {
      if (on) await registry.uninstall(BROWSER_RUNTIME_APP, a.adapter);
      else await registry.install(BROWSER_RUNTIME_APP, a.adapter);
      wakeRuntime();
      await refresh();
      status(on ? `${a.name} stopped. Your browser runtime turns it off in open pages.` : `${a.name} runs in your browser runtime on ${(a.urlPatterns || []).join(', ')}.`);
    }), `${on ? 'Stop running' : 'Run'} ${a.name} in my browser`);
  }

  function mineCard(a) {
    const inst = installed.get(keyOf(a.adapter));
    const badges = [[a.shared ? 'live' : 'offline', a.shared ? 'Shared' : 'Private']];
    if (inst) badges.push(['connected', 'In your browser']);
    if (!a.portable) badges.push(['offline', 'Description only']);
    const card = cardTop(a, badges);
    details(card, a, `${a.adapter.appId}/${a.adapter.id} · revision ${a.revision} · updated ${ago(a.updatedAt)}`);
    runtimeLines(card, a);
    card.append(visibilityOf(a));
    const actions = element('div', 'card-actions');
    if (a.portable) actions.append(button('secondary', 'Edit', () => run(() => openEditor(a)), `Edit ${a.name}`));
    if (a.portable) actions.append(runToggle(a));
    actions.append(button('secondary', a.shared ? 'Stop sharing' : 'Share', () => run(async () => {
      await registry.share(a.adapter, !a.shared);
      await refresh();
      status(a.shared ? `${a.name} is private again. Apps that installed it stop receiving it.` : `${a.name} is shared: everyone on this toolkit can find and install it.`);
    }), `${a.shared ? 'Stop sharing' : 'Share'} ${a.name}`));
    if (a.portable) actions.append(button('text-button', 'View code', () => run(() => showCode(card, a)), `View code of ${a.name}`));
    actions.append(button('delete', 'Delete', () => run(async () => {
      await registry.remove(a.adapter);
      wakeRuntime();
      if (editing && keyOf(editing.adapter) === keyOf(a.adapter)) closeEditor();
      await refresh();
      status(`Deleted ${a.name} and all its revisions.`);
    }), `Delete ${a.name}`));
    card.append(actions);
    return card;
  }

  function sharedCard(a) {
    const inst = installed.get(keyOf(a.adapter));
    const badges = [];
    if (inst) badges.push(['connected', `In your browser · revision ${inst.revision}`]);
    if (!a.portable) badges.push(['offline', 'Description only']);
    const card = cardTop(a, badges);
    details(card, a, `${a.appName} · by ${a.owner} · revision ${a.revision} · updated ${ago(a.updatedAt)}`);
    runtimeLines(card, a);
    card.append(visibilityOf(a));
    const actions = element('div', 'card-actions');
    if (a.portable) actions.append(runToggle(a));
    if (inst?.updateAvailable) {
      actions.append(button('primary', `Update to revision ${inst.latestRevision}`, () => run(async () => {
        await registry.install(BROWSER_RUNTIME_APP, a.adapter, { revision: inst.latestRevision });
        wakeRuntime();
        await refresh();
        status(`${a.name} updated to revision ${inst.latestRevision} in your browser runtime.`);
      }), `Update ${a.name} to revision ${inst.latestRevision}`));
    }
    if (a.portable && apps.length) {
      const form = element('div', 'install-into');
      const id = `ws-into-${keyOf(a.adapter).replaceAll(/[^a-z0-9]/gi, '-')}`;
      const label = element('label', 'visually-hidden', `Install ${a.name} into an app`);
      label.htmlFor = id;
      const select = element('select');
      select.id = id;
      for (const x of apps) select.append(new Option(x.name || x.appId, x.appId));
      form.append(label, select, button('secondary', 'Install into app', () => run(async () => {
        await registry.install(select.value, a.adapter);
        await refresh();
        status(`Installed ${a.name} into ${select.selectedOptions[0].textContent}. The app loads it from the registry.`);
      }), `Install ${a.name} into the chosen app`));
      actions.append(form);
    }
    if (a.portable) actions.append(button('text-button', 'View code', () => run(() => showCode(card, a)), `View code of ${a.name}`));
    card.append(actions);
    return card;
  }

  async function showCode(card, a) {
    card.querySelector('.adapter-code')?.remove();
    const got = await registry.get(a.adapter);
    const box = element('details', 'adapter-code');
    box.open = true;
    box.append(element('summary', '', `Code · revision ${got.revision} · ${got.package.code.length} characters · ${String(got.artifactDigest).slice(0, 19)}…`));
    box.append(element('pre', '', got.package.code));
    card.append(box);
  }

  // ── editor ────────────────────────────────────────────────────────────────

  async function openEditor(summary) {
    // Load first, so the editor never shows one adapter's title over another's code.
    editing = await registry.get(summary.adapter);
    const d = editing.descriptor;
    $('ws-form').reset();
    $('ws-editor-eyebrow').textContent = `EDIT · ${editing.appName.toUpperCase()}`;
    $('ws-editor-heading').textContent = `Edit ${editing.name}`;
    $('ws-editor-revision').textContent = `revision ${editing.revision}`;
    $('ws-name').value = d.name;
    $('ws-id').value = d.id;
    $('ws-description').value = d.description || '';
    $('ws-urls').value = (editing.urlPatterns || []).join('\n');
    for (const box of document.querySelectorAll('input[name=ws-area]')) box.checked = (d.supportAreas || []).includes(box.value);
    $('ws-code').value = editing.package.code;
    $('ws-run').checked = installed.has(keyOf(editing.adapter));
    $('ws-share').checked = editing.shared;
    $('ws-editor').hidden = false;
    renderLint();
    $('ws-editor').scrollIntoView({ block: 'start' });
    $('ws-name').focus();
  }

  function closeEditor() {
    editing = null;
    $('ws-editor').hidden = true;
  }

  function urlsFromField() {
    return $('ws-urls').value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function problems() {
    const out = [];
    for (const f of lintWebModule($('ws-code').value)) out.push({ ...f, where: f.line ? `Line ${f.line}` : 'Code' });
    const urls = urlsFromField();
    if (!urls.length) out.push({ level: 'error', where: 'Runs on', message: 'add at least one address pattern, such as https://example.com/*' });
    for (const u of urls) { const e = urlPatternError(u); if (e) out.push({ level: 'error', where: 'Runs on', message: e }); }
    return out;
  }

  function renderLint() {
    const list = $('ws-lint');
    list.replaceChildren();
    for (const f of lintWebModule($('ws-code').value)) {
      list.append(element('li', f.level, `${f.level === 'error' ? 'Error' : 'Check'}${f.line ? `, line ${f.line}` : ''}: ${f.message}`));
    }
  }

  async function save() {
    const name = $('ws-name').value.trim();
    if (!name) { $('ws-name').focus(); throw new Error('Give the adapter a name.'); }
    const errors = problems().filter(p => p.level === 'error');
    if (errors.length) {
      (errors[0].where === 'Runs on' ? $('ws-urls') : $('ws-code')).focus();
      throw new Error(`Fix this before saving — ${errors[0].where}: ${errors[0].message}.`);
    }
    const areas = [...document.querySelectorAll('input[name=ws-area]:checked')].map(b => b.value);
    const { descriptorDigest: _d, executionArtifactDigest: _e, ...before } = editing.descriptor;
    const descriptor = { ...before, name, description: $('ws-description').value.trim(), targets: [{ platforms: ['*'], urls: urlsFromField() }], supportAreas: areas };
    const shareIt = $('ws-share').checked;
    const result = await registry.publish({
      appName: editing.appName, descriptor, code: $('ws-code').value,
      ...(editing.package?.entry ? { entry: editing.package.entry } : {}), shared: shareIt,
    });
    const key = keyOf(result.adapter);
    const runIt = $('ws-run').checked;
    if (runIt && !installed.has(key)) await registry.install(BROWSER_RUNTIME_APP, result.adapter);
    if (!runIt && installed.has(key)) await registry.uninstall(BROWSER_RUNTIME_APP, result.adapter);
    wakeRuntime();
    closeEditor();
    tab = 'mine';
    await refresh();
    status(result.unchanged
      ? `Nothing changed in ${name} since revision ${result.revision}.`
      : `Saved ${name}, revision ${result.revision}.${runIt ? ' Your browser runtime runs it on matching pages within a few seconds.' : ''}${shareIt ? ' Shared with everyone on this toolkit.' : ''}`);
  }

  // ── the browser runtime ───────────────────────────────────────────────────

  // The extension's bridge answers on this page only (bridge.js); a save
  // tells it to sync now rather than at its next 30-second check.
  function wakeRuntime() {
    window.postMessage({ source: 'ai4a11y-console', type: 'adapters-changed' }, location.origin);
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== 'ai4a11y-runtime' || event.data.type !== 'present') return;
    runtimeHere = event.data;
    renderRuntime();
  });

  function renderRuntime() {
    const badge = $('ws-runtime-state');
    let text = 'Not found in this browser', cls = 'badge';
    if (runtimeHere) {
      if (!runtimeHere.connected) { text = 'Installed, not connected'; cls = 'badge warn'; }
      else if (uid && runtimeHere.uid !== uid) { text = `Connected as ${runtimeHere.uid}`; cls = 'badge warn'; }
      else if (!runtimeHere.userScripts) { text = 'Allow User Scripts is off'; cls = 'badge warn'; }
      else { text = 'Connected in this browser'; cls = 'badge connected'; }
    }
    badge.textContent = text;
    badge.className = cls;
    $('ws-runtime-setup').open = !runtimeHere?.connected;
    const list = $('ws-runtime-instances');
    list.replaceChildren();
    for (const i of instances.slice(0, 5)) {
      const fresh = Date.now() - Date.parse(i.lastSeenAt) < 5 * 60_000;
      const item = element('li');
      item.append(element('span', `dot${fresh ? ' is-live' : ''}`), element('span', '', `${i.label || i.instanceId} · last report ${ago(i.lastSeenAt)}`));
      list.append(item);
    }
  }

  // ── live updates while the page is open ───────────────────────────────────

  function startWatching() {
    stopWatching();
    const r = registryFor(getClient());
    if (!r) return;
    watching = new AbortController();
    r.watch((meta) => { if (meta.reason !== 'connected') refreshSoon(); }, { signal: watching.signal }).catch(() => {});
  }
  function stopWatching() {
    watching?.abort();
    watching = null;
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  // New adapter opens a guide to building one with a coding agent and the
  // toolkit skill in the repository. It shows the two .env lines the skill's
  // helper reads.
  $('ws-new').addEventListener('click', () => {
    const client = getClient();
    if (!client) { status('Sign in before building an adapter.', true); return; }
    const token = getAppToken();
    $('ws-guide-env').textContent = `TOOLKIT_URL=${client.base}\nTOOLKIT_TOKEN=${token || '<your default token from Account & tokens>'}`;
    $('ws-guide-status').textContent = '';
    $('ws-guide').showModal();
  });
  $('ws-guide-done').addEventListener('click', () => $('ws-guide').close());
  // Chrome blocks links to chrome:// pages from web pages, so this copies it.
  $('ws-copy-extensions').addEventListener('click', () => run(async () => {
    await navigator.clipboard.writeText('chrome://extensions');
    status('Copied chrome://extensions. Paste it into Chrome’s address bar.');
  }));
  // The page's status line sits behind the modal, so the guide has its own.
  $('ws-guide-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${$('ws-guide-env').textContent}\n`);
      $('ws-guide-status').textContent = 'Copied. Paste it into .env at the top of the toolkit repository.';
    } catch (error) {
      $('ws-guide-status').textContent = `Could not copy: ${error.message}. Select the two lines and copy them instead.`;
    }
  });
  $('ws-cancel').addEventListener('click', closeEditor);
  $('ws-form').addEventListener('submit', (event) => { event.preventDefault(); run(save); });
  let lintTimer = null;
  $('ws-code').addEventListener('input', () => { clearTimeout(lintTimer); lintTimer = setTimeout(renderLint, 250); });
  $('ws-search').addEventListener('input', render);
  for (const t of document.querySelectorAll('[data-ws-tab]')) t.addEventListener('click', () => { tab = t.dataset.wsTab; render(); });

  return {
    refresh,
    setActive(on) {
      active = on;
      if (on) {
        window.postMessage({ source: 'ai4a11y-console', type: 'ping' }, location.origin);
        startWatching();
      } else stopWatching();
    },
    reset() { stopWatching(); registry = null; uid = null; if (active) startWatching(); },
  };
}
