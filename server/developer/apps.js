// The Apps page: every app that connected with this account's tokens through
// the Adapter MCP SDK, grouped by app, live or last seen. From here a
// developer can hide an app, forget one, and try any adapter on a live
// instance — the page is an MCP client of the toolkit's relay, exactly like a
// coding agent would be.

import { createMcpClient, adapterClient } from '/sdk/adapter-mcp.js';

const $ = id => document.getElementById(id);
const REDBIRD_KEY = 'ai4a11y.developer.redbird-url';
const POLL_ACTIVE_MS = 4000;
const POLL_IDLE_MS = 15000;

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
  const t = Date.parse(iso);
  if (!t) return 'never';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

const toBase64Url = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Plain-language line for an outcome, for the status region.
function outcomeSentence(name, r) {
  if (r.isError && r.reasons?.length) return `${name}: ${r.status || 'failed'}. ${r.reasons.map(x => x.message).join(' ')}`;
  if (typeof r.compatible === 'boolean') return r.compatible ? `${name} can run with these settings.` : `${name} cannot run: ${(r.reasons || []).map(x => x.message).join(' ')}`;
  if (r.state) return `${name} is ${r.state.enabled === true ? 'on' : r.state.enabled === false ? 'off' : 'in an unknown state'}${r.status === 'partial' ? ' (some state could not be read)' : ''}.`;
  if (r.operation === 'revert') return r.status === 'applied' ? `Undid the last change to ${name}.` : `${name}: undo ${r.status}.`;
  if (r.status === 'noop') return `${name} was already like that; nothing changed.`;
  if (r.status === 'applied') return `${name}: done (${r.verification || 'adapter-reported'}).`;
  return `${name}: ${r.status}.`;
}

export function createAppsPage({ getClient, getAppToken, status, run, onLiveCount = () => {} }) {
  let apps = [];
  let hiddenApps = [];
  let signature = '';
  let timer = null;
  let active = false;
  let setupOpenedForEmpty = false;
  const tryState = new Map(); // `${appId}/${id}` -> { open, node, lastReceipt }
  const mcpClients = new Map(); // endpoint -> adapterClient

  function adapterApi(endpoint) {
    const client = getClient();
    const key = `${client.base}${endpoint}|${client.token}`;
    if (!mcpClients.has(key)) {
      mcpClients.set(key, adapterClient(createMcpClient({ url: client.base + endpoint, token: client.token, clientInfo: { name: 'toolkit-developer-console', version: '0.1.0' } })));
    }
    return mcpClients.get(key);
  }

  // ── data ─────────────────────────────────────────────────────────────────

  async function refresh({ quiet = false } = {}) {
    const client = getClient();
    if (!client) {
      apps = []; hiddenApps = []; signature = '';
      onLiveCount(0);
      render();
      return;
    }
    try {
      const result = await client.apps.list();
      apps = result.apps;
      hiddenApps = result.hiddenApps;
      onLiveCount(apps.filter(a => a.live && !a.hidden).length);
      const next = JSON.stringify(apps.map(a => [a.appId, a.hidden, a.live, a.connections.map(c => [c.providerId, c.live]), a.adapters.map(d => d.descriptorDigest)]));
      if (next !== signature || !quiet) { signature = next; render(); }
      else updateLiveDetails();
    } catch (error) {
      if (!quiet) status(error.message, true);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!getClient()) return;
    timer = setTimeout(async () => {
      if (!document.hidden) await refresh({ quiet: true });
      schedule();
    }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
  }

  function setActive(on) {
    active = on;
    if (on) refresh();
    schedule();
  }

  // ── rendering ────────────────────────────────────────────────────────────

  function render() {
    const groups = $('app-groups');
    groups.replaceChildren();
    $('apps-refresh').disabled = !getClient();
    renderSnippets();
    const hiddenCount = apps.filter(a => a.hidden).length;
    $('apps-hidden-count').textContent = hiddenCount ? `(${hiddenCount})` : '';
    $('apps-count').textContent = String(apps.filter(a => !a.hidden).length);
    if (!getClient()) {
      groups.append(element('p', 'empty', 'Sign in to see the apps connected with your token.'));
      return;
    }
    const showHidden = $('apps-show-hidden').checked;
    const shown = apps.filter(a => showHidden || !a.hidden);
    if (!apps.length) {
      if ($('connect-app').hidden) { showConnect(true); setupOpenedForEmpty = true; }
      groups.append(element('p', 'empty', 'No apps have connected with your token yet. Open the Redbird demo above, or connect your own app with the SDK — it appears here as soon as it connects.'));
      return;
    }
    if (!shown.length) {
      groups.append(element('p', 'empty', `All ${hiddenCount} app${hiddenCount === 1 ? ' is' : 's are'} hidden. Turn on Show hidden to see them.`));
      return;
    }
    // The setup opened only because there were no apps: the first app closes it.
    if (setupOpenedForEmpty) { setupOpenedForEmpty = false; showConnect(false); }
    for (const app of shown) groups.append(appGroup(app));
  }

  function updateLiveDetails() {
    for (const app of apps) {
      const seen = document.querySelector(`[data-last-seen="${CSS.escape(app.appId)}"]`);
      if (seen) seen.textContent = app.live ? 'connected now' : `last seen ${ago(app.lastSeenAt)}`;
      const list = document.querySelector(`[data-activity="${CSS.escape(app.appId)}"]`);
      if (list) fillActivity(list, app);
    }
  }

  function fillActivity(list, app) {
    // recentCalls is stored by the toolkit (it survives a restart); older
    // services only send each connection's in-memory activity.
    const items = (app.recentCalls || app.connections.flatMap(c => c.activity || []).sort((a, b) => b.at.localeCompare(a.at))).slice(0, 8);
    list.replaceChildren(...(items.length ? items.map(a => element('li', '', `${new Date(a.at).toLocaleTimeString()} · ${a.tool || a.method}${a.adapter ? ` · ${a.adapter}` : ''} · ${a.outcome} · ${a.client}`)) : [element('li', '', 'No calls yet.')]));
  }

  // One app: a group like the Marketplace's, with its connections and recent
  // calls under the heading and its adapters as cards.
  function appGroup(app) {
    const group = element('section', `adapter-group app-group${app.hidden ? ' is-hidden' : ''}`);
    group.setAttribute('aria-labelledby', `app-${app.appId}`);
    const heading = element('div', 'section-heading');
    // The heading is the app's name alone; its state sits beside it.
    const titleRow = element('div', 'app-title');
    const h3 = element('h3', '', app.name);
    h3.id = `app-${app.appId}`;
    const liveCount = app.connections.filter(c => c.live).length;
    titleRow.append(h3);
    titleRow.append(element('span', `badge ${app.live ? 'live' : 'offline'}`, app.live ? `Live${liveCount > 1 ? ` · ${liveCount} instances` : ''}` : 'Offline'));
    if (app.hidden) titleRow.append(element('span', 'badge', 'Hidden'));
    const actions = element('div', 'card-actions');
    actions.append(button('secondary', 'Copy MCP endpoint', () => run(async () => {
      await navigator.clipboard.writeText(getClient().base + app.endpoint);
      status(`Copied the MCP endpoint for ${app.name}. MCP clients authenticate with your default token.`);
    }), `Copy the MCP endpoint for ${app.name}`));
    actions.append(button('secondary', app.hidden ? 'Show' : 'Hide', () => run(async () => {
      await getClient().apps.setHidden(app.appId, !app.hidden);
      await refresh();
      status(app.hidden ? `${app.name} is shown again.` : `${app.name} is hidden. Turn on Show hidden apps to see it.`);
    }), `${app.hidden ? 'Show' : 'Hide'} ${app.name}`));
    if (!app.live) actions.append(button('delete', 'Forget', () => run(async () => {
      await getClient().apps.forget(app.appId);
      await refresh();
      status(`Forgot ${app.name}. It comes back the next time it connects.`);
    }), `Forget ${app.name}`));
    heading.append(titleRow, actions);
    group.append(heading);

    const meta = element('p', 'adapter-group-id');
    meta.append(`app id: ${app.appId}${app.version ? ` · v${app.version}` : ''} · ${app.adapters.length} adapter${app.adapters.length === 1 ? '' : 's'} · `);
    const seen = element('span', '', app.live ? 'connected now' : `last seen ${ago(app.lastSeenAt)}`);
    seen.dataset.lastSeen = app.appId;
    meta.append(seen);
    group.append(meta);
    if (app.description) group.append(element('p', 'adapter-description app-description', app.description));

    if (app.connections.length || app.recentCalls?.length) {
      const conns = element('div', 'app-connections');
      if (app.connections.length) {
        const ul = element('ul', 'connection-list');
        for (const c of app.connections) {
          const where = [c.label || c.providerId, c.platform ? Object.values(c.platform).join(' · ') : ''].filter(Boolean).join(' — ');
          const li = element('li');
          li.append(element('span', `dot${c.live ? ' is-live' : ''}`), element('span', '', `${where}${c.live ? '' : ` (disconnected ${ago(new Date(c.lastSeenAt).toISOString())})`}`));
          ul.append(li);
        }
        conns.append(ul);
      }
      const activity = element('details', 'recent-calls');
      activity.append(element('summary', '', 'Recent calls'));
      const list = element('ul', 'activity');
      list.dataset.activity = app.appId;
      fillActivity(list, app);
      activity.append(list);
      conns.append(activity);
      group.append(conns);
    }

    const grid = element('div', 'adapter-grid');
    for (const d of app.adapters) grid.append(adapterCard(app, d));
    group.append(grid);
    if (!app.adapters.length) group.append(element('p', 'empty', 'This app exports no adapters.'));
    return group;
  }

  // One adapter, as a card in the Marketplace's style. Trying it widens the
  // card to the whole row, so the form has room.
  function adapterCard(app, d) {
    const key = `${app.appId}/${d.id}`;
    const state = tryState.get(key) || { open: false, node: null, lastReceipt: null };
    tryState.set(key, state);
    const card = element('article', `adapter-card${state.open && app.live ? ' is-trying' : ''}`);
    const title = element('div', 'adapter-title');
    title.append(element('h4', '', d.name));
    title.append(element('span', 'badge', d.mode === 'action' ? 'One-shot' : 'On / off'));
    if ((d.requires?.dependencies || []).length) title.append(element('span', 'badge', 'AI'));
    card.append(title);
    const id = element('p', 'adapter-id');
    id.append(`${d.appId}/${d.id} · ${/^\d/.test(d.version) ? `v${d.version}` : d.version} · `);
    const digest = element('span', '', `digest ${String(d.descriptorDigest).slice(7, 15)}`);
    digest.title = d.descriptorDigest;
    id.append(digest);
    card.append(id);
    if (d.description) card.append(element('p', 'adapter-description', d.description));
    const pills = element('div', 'pills');
    pills.append(element('span', 'pill', d.reach === 'self' ? 'affects this app' : 'affects other apps'));
    pills.append(element('span', 'pill', d.effects?.reversibility === 'full' ? 'undoable' : d.effects?.reversibility === 'partial' ? 'partly undoable' : 'no undo'));
    for (const dep of d.requires?.dependencies || []) pills.append(element('span', 'pill', `${dep.optional ? 'can use' : 'needs'} ${dep.name}`));
    for (const area of d.supportAreas || []) pills.append(element('span', 'pill area', area));
    card.append(pills);

    const actions = element('div', 'card-actions');
    const toggle = button(state.open ? 'secondary' : 'primary', state.open ? 'Close' : 'Try it', () => {
      state.open = !state.open;
      toggle.textContent = state.open ? 'Close' : 'Try it';
      toggle.className = state.open ? 'secondary' : 'primary';
      toggle.setAttribute('aria-expanded', String(state.open));
      card.classList.toggle('is-trying', state.open);
      if (state.open) { state.node = tryPanel(app, d, state); card.append(state.node); state.node.querySelector('input, select, textarea, button')?.focus(); }
      else { state.node?.remove(); state.node = null; }
    }, `Try ${d.name}`);
    toggle.setAttribute('aria-expanded', String(state.open));
    toggle.disabled = !app.live;
    actions.append(toggle);
    if (!app.live) actions.append(element('span', 'hint', 'Open the app to try it.'));
    card.append(actions);
    if (state.open && app.live) { state.node = tryPanel(app, d, state); card.append(state.node); }
    return card;
  }

  // ── try an adapter ───────────────────────────────────────────────────────

  function parameterControls(d) {
    const props = d.inputSchema?.properties || {};
    const required = new Set(d.inputSchema?.required || []);
    const controls = [];
    for (const [name, schema] of Object.entries(props)) {
      const id = `p-${d.appId}-${d.id}-${name}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const label = `${name}${schema.description ? ` — ${schema.description}` : ''}${required.has(name) ? '' : ' (optional)'}`;
      const group = element('div', 'input-group');
      let read;
      if (schema.type === 'boolean') {
        const wrap = element('label', 'toggle-control param-toggle');
        const input = element('input'); input.type = 'checkbox'; input.id = id; input.checked = schema.default === true;
        wrap.append(input, element('span', '', label));
        group.append(wrap);
        read = () => input.checked;
      } else if (Array.isArray(schema.enum)) {
        const l = element('label', '', label); l.htmlFor = id;
        const select = element('select'); select.id = id;
        if (!required.has(name)) select.append(new Option('(not set)', ''));
        for (const v of schema.enum) select.append(new Option(String(v), JSON.stringify(v)));
        if (schema.default !== undefined) select.value = JSON.stringify(schema.default);
        group.append(l, select);
        read = () => (select.value === '' ? undefined : JSON.parse(select.value));
      } else if (schema.type === 'number' || schema.type === 'integer') {
        const l = element('label', '', label + (schema.minimum !== undefined || schema.maximum !== undefined ? ` [${schema.minimum ?? '…'}–${schema.maximum ?? '…'}]` : '')); l.htmlFor = id;
        const input = element('input'); input.type = 'number'; input.id = id;
        if (schema.minimum !== undefined) input.min = schema.minimum;
        if (schema.maximum !== undefined) input.max = schema.maximum;
        input.step = schema.type === 'integer' ? '1' : 'any';
        if (schema.default !== undefined) input.value = schema.default;
        group.append(l, input);
        read = () => (input.value === '' ? undefined : Number(input.value));
      } else if (schema.type === 'string') {
        const l = element('label', '', label); l.htmlFor = id;
        const input = element('input'); input.id = id;
        if (schema.default !== undefined) input.value = schema.default;
        group.append(l, input);
        read = () => (input.value === '' && !required.has(name) ? undefined : input.value);
      } else {
        const l = element('label', '', `${label} (JSON)`); l.htmlFor = id;
        const area = element('textarea'); area.id = id; area.rows = 2; area.spellcheck = false;
        if (schema.default !== undefined) area.value = JSON.stringify(schema.default);
        group.append(l, area);
        read = () => { if (!area.value.trim()) return undefined; try { return JSON.parse(area.value); } catch { throw new Error(`${name} is not valid JSON.`); } };
      }
      controls.push({ name, group, read });
    }
    return controls;
  }

  function tryPanel(app, d, state) {
    const panel = element('div', 'try-panel');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Try ${d.name}`);
    const live = app.connections.filter(c => c.live);
    const grid = element('div', 'try-grid');

    const instanceGroup = element('div', 'input-group');
    const instanceId = `inst-${app.appId}-${d.id}`;
    const instanceLabel = element('label', '', 'Instance'); instanceLabel.htmlFor = instanceId;
    const instance = element('select'); instance.id = instanceId;
    for (const c of live) instance.append(new Option(c.label || c.providerId, c.providerId));
    instanceGroup.append(instanceLabel, instance);
    grid.append(instanceGroup);

    const targetGroup = element('div', 'input-group');
    const targetId = `target-${app.appId}-${d.id}`;
    const targetLabel = element('label', '', d.targets?.some(t => t.applications) ? 'Target (URL or native app id)' : 'Target URL'); targetLabel.htmlFor = targetId;
    const target = element('input'); target.id = targetId; target.placeholder = 'https://…';
    targetGroup.append(targetLabel, target);
    grid.append(targetGroup);
    panel.append(grid);

    const controls = parameterControls(d);
    if (controls.length) {
      const params = element('div', 'try-grid');
      for (const c of controls) params.append(c.group);
      panel.append(params);
    } else {
      panel.append(element('p', 'hint', 'This adapter takes no parameters.'));
    }

    const result = element('div', 'try-result');
    result.hidden = true;
    result.setAttribute('aria-live', 'polite');

    const api = () => adapterApi(`/v1/mcp/providers/${encodeURIComponent(instance.value)}`);
    const targetValue = () => {
      const v = target.value.trim();
      if (!v) throw new Error('Enter a target first, or use “Find targets”.');
      return /^https?:\/\//i.test(v) ? { url: v } : { application: v, platform: app.connections.find(c => c.providerId === instance.value)?.platform?.os || 'unknown' };
    };
    const parameters = () => {
      const out = {};
      for (const c of controls) { const v = c.read(); if (v !== undefined) out[c.name] = v; }
      return out;
    };
    function show(r) {
      result.hidden = false;
      result.className = `try-result ${r.isError || r.compatible === false ? 'bad' : 'ok'}`;
      const sentence = outcomeSentence(d.name, r);
      result.replaceChildren(element('strong', '', sentence));
      const details = element('details');
      details.append(element('summary', '', 'Full result'));
      const { text, ...rest } = r;
      details.append(element('pre', '', JSON.stringify(rest, null, 2)));
      result.append(details);
      status(sentence, !!r.isError);
      if (r.reasons?.some(x => x.code === 'descriptor-changed')) refresh();
    }
    async function findTargets(quiet) {
      if (!d.operations.includes('targets')) return;
      const r = await api().targets(d);
      if (r.candidates?.length) target.value = r.candidates[0].target.url || r.candidates[0].target.application || '';
      if (!quiet) show(r);
    }

    const actions = element('div', 'try-actions');
    const act = (label, fn, cls = 'secondary small') => actions.append(button(cls, label, () => run(async () => show(await fn()))));
    if (d.mode === 'stateful') {
      act('Turn on / update', async () => {
        const r = await api().apply(d, targetValue(), { enabled: true, parameters: parameters() });
        if (r.undo?.receiptId) state.lastReceipt = r.undo.receiptId;
        return r;
      }, 'primary small');
      act('Turn off', async () => {
        const r = await api().apply(d, targetValue(), { enabled: false });
        if (r.undo?.receiptId) state.lastReceipt = r.undo.receiptId;
        return r;
      });
    } else {
      act('Run', async () => api().apply(d, targetValue(), { parameters: parameters() }), 'primary small');
    }
    act('Check', async () => api().check(d, targetValue(), d.mode === 'stateful' ? { enabled: true, parameters: parameters() } : { parameters: parameters() }));
    if (d.operations.includes('query')) act('Read state', async () => api().query(d, targetValue()));
    if (d.operations.includes('revert')) act('Undo last change', async () => {
      if (!state.lastReceipt) throw new Error('Nothing to undo yet: turn it on or off from here first.');
      return api().revert(state.lastReceipt);
    });
    if (d.operations.includes('targets')) actions.append(button('text-button small', 'Find targets', () => run(() => findTargets(false))));
    panel.append(actions, result);
    if (live.length) findTargets(true).catch(() => {});
    return panel;
  }

  // ── connect-an-app helpers ───────────────────────────────────────────────

  function renderSnippets() {
    const client = getClient();
    const base = client?.base || location.origin;
    const token = getAppToken() || 'aat_…your default token…';
    $('snippet-web').textContent = `import { createAdapterProvider, connectToToolkit, defineDescriptor, fromToggleAdapter, detectBrowserPlatform }
  from '${base}/sdk/adapter-mcp.js';

const provider = createAdapterProvider({
  application: { appId: 'my-app', name: 'My app', version: '0.1.0',
    supportedPlatforms: [{ environment: 'web-page' }], platform: detectBrowserPlatform(), surfaces: ['web'] },
  adapters: [fromToggleAdapter({
    adapter: MyAdapter, // any object with enabled, enable(options), disable()
    descriptor: defineDescriptor({ appId: 'my-app', id: 'my-adapter', name: 'My adapter',
      version: '0.1.0', targets: [{ platforms: ['*'], urls: [location.origin + '/*'] }] }),
  })],
});
connectToToolkit({ url: '${base}', token: '${token}', provider, label: location.pathname });`;
    $('snippet-mcp').textContent = `claude mcp add --transport http redbird ${base}/v1/mcp/apps/redbird --header "Authorization: Bearer ${token}"`;
  }

  try { $('redbird-url').value = localStorage.getItem(REDBIRD_KEY) || $('redbird-url').value; } catch { /* storage blocked */ }
  $('open-redbird').addEventListener('submit', (event) => {
    event.preventDefault();
    const client = getClient();
    const token = getAppToken();
    if (!client || !token) { status('Sign in first: Redbird connects with your default token.', true); return; }
    let url;
    try { url = new URL($('redbird-url').value); } catch { status('Enter Redbird’s address, for example http://localhost:8000.', true); return; }
    try { localStorage.setItem(REDBIRD_KEY, url.origin); } catch { /* storage blocked */ }
    // The token rides in the fragment, which browsers never send to a server
    // or in a Referer; Redbird stores it and removes it from the address.
    const connect = toBase64Url(JSON.stringify({ url: client.base, token }));
    window.open(`${url.origin}/?profile=toolkit&workshop=on#ai4a11y=${connect}`, '_blank', 'noopener');
    status('Opened Redbird. It appears here as Redbird demo once the page loads.');
    setTimeout(() => refresh({ quiet: true }), 3000);
  });
  for (const copy of document.querySelectorAll('[data-copy]')) {
    copy.addEventListener('click', () => run(async () => {
      await navigator.clipboard.writeText($(copy.dataset.copy).textContent);
      status('Copied. It includes your token, so share it only with your own apps.');
    }));
  }
  function showConnect(open) {
    $('connect-app').hidden = !open;
    $('connect-app-toggle').setAttribute('aria-expanded', String(open));
    $('connect-app-toggle').textContent = open ? 'Hide setup' : '+ Connect an app';
  }
  $('connect-app-toggle').addEventListener('click', () => {
    const open = $('connect-app').hidden;
    setupOpenedForEmpty = false;
    showConnect(open);
    if (open) $('connect-heading').scrollIntoView({ block: 'nearest' });
  });
  // The sidebar's "Connect an app" link lands here with the setup open.
  $('sidebar-connect-app').addEventListener('click', () => { setupOpenedForEmpty = false; showConnect(true); });
  $('apps-show-hidden').addEventListener('change', render);
  $('apps-refresh').addEventListener('click', () => run(() => refresh()));

  return {
    refresh,
    setActive,
    reset() { tryState.clear(); mcpClients.clear(); signature = ''; schedule(); },
    get hiddenApps() { return hiddenApps; },
  };
}
