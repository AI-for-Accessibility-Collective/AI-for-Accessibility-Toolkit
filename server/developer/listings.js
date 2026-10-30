// The Listings page: browse the descriptions apps listed on this toolkit
// (the adapter marketplace), grouped by app, register new listings (data-only
// or data + code), and keep per-user install state. Sharing adapters other
// apps can run is the Adapters page (adapters.js).
// Talks to /v1/adapters through the shared client; all async work runs
// through the workspace's busy-aware run().

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

function shortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function createListingsPage({ getClient, status, run, getHiddenApps = () => [] }) {
  let adapters = [];
  let apps = [];
  let codeCache = new Map();

  // ── marketplace list ──────────────────────────────────────────────────────

  // A read-only reload: deliberately not wrapped in run(), because it is
  // called from inside the workspace's run() when the connection changes.
  async function refresh() {
    const client = getClient();
    if (!client) {
      adapters = []; apps = [];
      render();
      return;
    }
    try {
      const result = await client.adapters.list();
      adapters = result.adapters;
      apps = result.apps;
      codeCache = new Map();
      render();
    } catch (error) {
      status(error.message, true);
    }
  }

  function visibleAdapters() {
    const search = $('adapter-search').value.trim().toLowerCase();
    const app = $('adapter-app').value;
    const kind = $('adapter-kind').value;
    // Apps hidden on the Apps page stay hidden here too, unless asked for.
    const hidden = new Set($('adapter-show-hidden').checked ? [] : getHiddenApps());
    return adapters
      .filter(a => !hidden.has(a.appId) || a.appId === app)
      .filter(a => (!app || a.appId === app) && (!kind || a.kind === kind))
      .filter(a => !$('adapter-mine').checked || a.mine)
      .filter(a => !$('adapter-installed').checked || a.installed)
      .filter(a => !search || `${a.appId} ${a.id} ${a.name} ${a.description} ${a.settingsKeys.join(' ')}`.toLowerCase().includes(search));
  }

  function render() {
    const shown = visibleAdapters();
    $('adapter-count').textContent = String(shown.length);
    renderAppFilter();
    const groups = $('adapter-groups');
    groups.replaceChildren();
    $('adapter-refresh').disabled = !getClient();
    if (!getClient()) {
      groups.append(element('p', 'empty', 'Sign in (or connect with a token) in the sidebar to browse the listings on this toolkit.'));
      return;
    }
    if (!shown.length) {
      groups.append(element('p', 'empty', adapters.length
        ? 'No adapters match these filters.'
        : 'No adapters registered yet. Apps publish theirs with POST /v1/adapters/sync, or use + Register adapter above.'));
      return;
    }
    const byApp = new Map();
    for (const adapter of shown) {
      if (!byApp.has(adapter.appId)) byApp.set(adapter.appId, []);
      byApp.get(adapter.appId).push(adapter);
    }
    for (const [appId, list] of byApp) {
      const appName = apps.find(a => a.appId === appId)?.name || appId;
      const group = element('section', 'adapter-group');
      const heading = element('div', 'section-heading');
      heading.append(element('h3', '', appName));
      heading.append(element('span', 'count', String(list.length)));
      group.append(heading);
      if (appName !== appId) group.append(element('p', 'adapter-group-id', `app id: ${appId}`));
      const grid = element('div', 'adapter-grid');
      for (const adapter of list) grid.append(adapterCard(adapter));
      group.append(grid);
      groups.append(group);
    }
  }

  function renderAppFilter() {
    const select = $('adapter-app');
    const current = select.value;
    const known = [...new Set([...apps.map(a => a.appId), ...adapters.map(a => a.appId)])].sort();
    select.replaceChildren(new Option('All apps', ''));
    for (const appId of known) {
      const name = apps.find(a => a.appId === appId)?.name || appId;
      select.append(new Option(name === appId ? appId : `${name} (${appId})`, appId));
    }
    if (known.includes(current)) select.value = current;
  }

  function adapterCard(adapter) {
    const card = element('article', 'adapter-card');
    const title = element('h3', 'adapter-title');
    title.append(element('span', '', adapter.name));
    title.append(element('span', `badge kind-${adapter.kind}`, adapter.kind === 'code' ? 'Data + code' : 'Data'));
    if (adapter.requiresAI) title.append(element('span', 'badge', 'AI'));
    // Listings carrying an Adapter MCP descriptor say so; older ones are
    // labelled metadata-only (adapter-mcp.md §10.5).
    if (adapter.descriptor) title.append(element('span', 'badge live', `Adapter MCP ${adapter.descriptor.adapterProtocol?.version || ''}`.trim()));
    else title.append(element('span', 'badge offline', 'Legacy listing'));
    card.append(title);
    const meta = [`${adapter.appId}/${adapter.id}`];
    if (adapter.version) meta.push(`v${adapter.version}`);
    card.append(element('p', 'adapter-id', meta.join(' · ')));
    if (adapter.description) card.append(element('p', 'adapter-description', adapter.description));
    const pills = element('div', 'pills');
    for (const key of adapter.settingsKeys) pills.append(element('span', 'pill', key));
    for (const area of adapter.supportAreas) pills.append(element('span', 'pill area', area));
    if (adapter.mine) pills.append(element('span', 'pill mine', 'mine'));
    if (adapter.installed) pills.append(element('span', 'pill installed', 'installed'));
    if (pills.children.length) card.append(pills);
    const by = [`by ${adapter.registeredBy || 'unknown'}`];
    const updated = shortDate(adapter.updatedAt);
    if (updated) by.push(`updated ${updated}`);
    card.append(element('p', 'adapter-by', by.join(' · ')));

    const actions = element('div', 'card-actions');
    actions.append(button(adapter.installed ? 'secondary' : 'primary', adapter.installed ? 'Uninstall' : 'Install', () => run(async () => {
      await getClient().adapters.setInstalled(adapter.appId, adapter.id, !adapter.installed);
      adapter.installed = !adapter.installed;
      render();
      status(`${adapter.installed ? 'Marked' : 'Cleared'} ${adapter.name} as ${adapter.installed ? 'installed' : 'not installed'} for your user.`);
    }), `${adapter.installed ? 'Uninstall' : 'Install'} ${adapter.name}`));
    if (adapter.kind === 'code') actions.append(button('secondary', 'View code', () => run(async () => {
      const cacheKey = `${adapter.appId}/${adapter.id}`;
      let payload = codeCache.get(cacheKey);
      if (!payload) { payload = await getClient().adapters.code(adapter.appId, adapter.id); codeCache.set(cacheKey, payload); }
      showCode(card, payload);
    }), `View code of ${adapter.name}`));
    if (adapter.sourceUrl) {
      const link = element('a', '', 'Source ↗');
      link.href = adapter.sourceUrl; link.target = '_blank'; link.rel = 'noreferrer';
      link.setAttribute('aria-label', `Source of ${adapter.name} (opens in a new tab)`);
      actions.append(link);
    }
    if (adapter.docsUrl) {
      const link = element('a', '', 'Docs ↗');
      link.href = adapter.docsUrl; link.target = '_blank'; link.rel = 'noreferrer';
      link.setAttribute('aria-label', `Docs for ${adapter.name} (opens in a new tab)`);
      actions.append(link);
    }
    if (adapter.mine) {
      actions.append(button('delete', 'Delete', () => run(async () => {
        await getClient().adapters.remove(adapter.appId, adapter.id);
        adapters = adapters.filter(a => a !== adapter);
        render();
        status(`Removed ${adapter.appId}/${adapter.id} from the marketplace.`);
      }), `Delete ${adapter.name}`));
    }
    card.append(actions);
    return card;
  }

  function showCode(card, payload) {
    card.querySelector('.adapter-code')?.remove();
    const details = element('details', 'adapter-code');
    details.open = true;
    details.append(element('summary', '', `Code · ${payload.size} chars · sha256 ${String(payload.sha256).slice(0, 12)}…`));
    const pre = element('pre', '', payload.code);
    details.append(pre);
    details.append(button('secondary', 'Copy code', () => run(async () => {
      await navigator.clipboard.writeText(payload.code);
      status('Adapter code copied. Review it before running it anywhere — treat it like third-party software.');
    })));
    card.append(details);
  }

  // ── register form ─────────────────────────────────────────────────────────

  function openRegister(prefill) {
    $('register-panel').hidden = false;
    if (prefill) {
      $('reg-app').value = prefill.appId || '';
      $('reg-id').value = prefill.id || '';
    }
    $('reg-app').focus();
  }

  function closeRegister() {
    $('register-panel').hidden = true;
    $('register-form').reset();
    $('reg-code-group').hidden = true;
  }

  $('new-adapter').addEventListener('click', () => {
    if (!getClient()) { status('Connect to an instance before registering an adapter.', true); return; }
    openRegister();
  });
  $('register-cancel').addEventListener('click', closeRegister);
  $('reg-has-code').addEventListener('change', () => { $('reg-code-group').hidden = !$('reg-has-code').checked; });
  $('register-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const areas = [...document.querySelectorAll('#register-form input[name=area]:checked')].map(input => input.value);
      const entry = {
        appId: $('reg-app').value.trim(),
        appName: $('reg-app-name').value.trim(),
        id: $('reg-id').value.trim(),
        name: $('reg-name').value.trim(),
        description: $('reg-description').value.trim(),
        version: $('reg-version').value.trim(),
        settingsKeys: $('reg-keys').value.split(',').map(key => key.trim()).filter(Boolean),
        supportAreas: areas,
        sourceUrl: $('reg-source').value.trim(),
        docsUrl: $('reg-docs').value.trim(),
      };
      if ($('reg-has-code').checked) entry.code = $('reg-code').value;
      const saved = await getClient().adapters.register(entry);
      closeRegister();
      await refresh();
      status(`Registered ${saved.appId}/${saved.id}. It is listed under ${apps.find(a => a.appId === saved.appId)?.name || saved.appId}.`);
    });
  });

  // ── wiring ────────────────────────────────────────────────────────────────

  for (const id of ['adapter-search', 'adapter-app', 'adapter-kind', 'adapter-mine', 'adapter-installed', 'adapter-show-hidden']) {
    $(id).addEventListener(id === 'adapter-search' ? 'input' : 'change', render);
  }
  $('adapter-refresh').addEventListener('click', refresh);

  return { refresh, openRegister };
}
