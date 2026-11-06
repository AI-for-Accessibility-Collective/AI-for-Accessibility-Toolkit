// The Listings page: what apps offer on this toolkit, grouped by app, each
// group folded until opened. Two sources: the listings apps submitted (the
// adapter marketplace, /v1/adapters, data-only or data + code; a coding agent
// submits them with the skill's `adapter.mjs list-app`), and the adapters
// shared through the registry (/v1/mcp), which can run in this browser.
// Building and sharing your own is the Adapters page (adapters.js).
// All async work runs through the workspace's busy-aware run().

import { icon } from './icons.js';
import { createRegistryClient, BROWSER_RUNTIME_APP } from '/sdk/toolkit/adapter-mcp/index.js';

const BUILTIN_OWNER = 'toolkit';

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
  const openGroups = new Set(); // the app groups the person opened, by their key

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
      const registry = createRegistryClient({ url: client.base, token: client.token });
      const [result, shared, inBrowser] = await Promise.all([
        client.adapters.list(),
        registry.search({ scope: 'shared' }).catch(() => ({ adapters: [] })),
        registry.installed(BROWSER_RUNTIME_APP).catch(() => ({ adapters: [] })),
      ]);
      const running = new Set((inBrowser.adapters || []).map(x => keyOf(x.adapter)));
      adapters = [...result.adapters.map(a => ({ ...a, group: a.appId })), ...shared.adapters.map(a => fromRegistry(a, running))];
      apps = result.apps;
      codeCache = new Map();
      render();
    } catch (error) {
      status(error.message, true);
    }
  }

  const keyOf = (k) => `${k.owner}/${k.appId}/${k.id}`;

  // A shared registry adapter, in a listing's shape. Grouped by its owner's app.
  function fromRegistry(a, running) {
    const builtin = a.owner === BUILTIN_OWNER;
    return {
      shared: a, group: `${a.owner}/${a.adapter.appId}`, groupName: builtin ? 'Toolkit' : a.appName || a.adapter.appId,
      groupBy: builtin ? 'built into the toolkit' : `by ${a.owner}`,
      appId: a.adapter.appId, id: a.adapter.id, name: a.name, description: a.description, version: a.version,
      kind: 'shared', settingsKeys: [], supportAreas: a.supportAreas || [], needs: a.needs || [],
      mine: !!a.mine, installed: running.has(keyOf(a.adapter)), portable: a.portable, urlPatterns: a.urlPatterns || [],
      updatedAt: a.updatedAt, revision: a.revision,
    };
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
      .filter(a => !search || `${a.appId} ${a.id} ${a.name} ${a.description} ${a.settingsKeys.join(' ')} ${(a.needs || []).map(n => n.phrase).join(' ')}`.toLowerCase().includes(search));
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
        : 'Nothing listed yet. Apps submit their listings with a coding agent and the toolkit skill (adapter.mjs list-app), and shared adapters show here too.'));
      return;
    }
    const byApp = new Map();
    for (const adapter of shown) {
      if (!byApp.has(adapter.group)) byApp.set(adapter.group, []);
      byApp.get(adapter.group).push(adapter);
    }
    for (const [key, list] of byApp) {
      const first = list[0];
      const appName = first.groupName || apps.find(a => a.appId === first.appId)?.name || first.appId;
      // Folded until the person opens it; it stays open across refreshes.
      const group = element('details', 'adapter-group listing-group');
      group.open = openGroups.has(key);
      group.addEventListener('toggle', () => { if (group.open) openGroups.add(key); else openGroups.delete(key); });
      const summary = element('summary', 'section-heading');
      summary.append(element('h3', '', appName), element('span', 'count', String(list.length)));
      group.append(summary);
      group.append(element('p', 'adapter-group-id', [`app id: ${first.appId}`, first.groupBy].filter(Boolean).join(' · ')));
      const grid = element('div', 'adapter-grid');
      for (const adapter of list) grid.append(adapter.shared ? sharedCard(adapter) : adapterCard(adapter));
      group.append(grid);
      groups.append(group);
    }
  }

  // A shared adapter: what it does and who it is for, and running it in this browser.
  function sharedCard(adapter) {
    const a = adapter.shared;
    const card = element('article', 'adapter-card');
    const title = element('h3', 'adapter-title');
    title.append(element('span', '', adapter.name));
    title.append(element('span', 'badge live', 'Shared'));
    if (!adapter.portable) title.append(element('span', 'badge offline', 'Description only'));
    card.append(title);
    card.append(element('p', 'adapter-id', [`${adapter.appId}/${adapter.id}`, `revision ${adapter.revision}`].join(' · ')));
    if (adapter.description) card.append(element('p', 'adapter-description', adapter.description));
    const pills = element('div', 'pills');
    for (const n of adapter.needs) pills.append(element('span', 'pill', n.phrase));
    for (const area of adapter.supportAreas) pills.append(element('span', 'pill area', area));
    if (adapter.mine) pills.append(element('span', 'pill mine', 'mine'));
    if (adapter.installed) pills.append(element('span', 'pill installed', 'in your browser'));
    if (pills.children.length) card.append(pills);
    const by = [adapter.groupBy];
    const updated = shortDate(adapter.updatedAt);
    if (updated) by.push(`updated ${updated}`);
    if (adapter.urlPatterns.length) by.push(`runs on ${adapter.urlPatterns.join(', ')}`);
    card.append(element('p', 'adapter-by', by.join(' · ')));
    const actions = element('div', 'card-actions');
    if (adapter.portable) actions.append(button(adapter.installed ? 'secondary' : 'primary', adapter.installed ? 'Stop running in my browser' : 'Run in my browser', () => run(async () => {
      const client = getClient();
      const registry = createRegistryClient({ url: client.base, token: client.token });
      if (adapter.installed) await registry.uninstall(BROWSER_RUNTIME_APP, a.adapter);
      else await registry.install(BROWSER_RUNTIME_APP, a.adapter);
      window.postMessage({ source: 'ai4a11y-console', type: 'adapters-changed' }, location.origin);
      adapter.installed = !adapter.installed;
      render();
      status(adapter.installed ? `${adapter.name} runs in your browser runtime on ${adapter.urlPatterns.join(', ')}.` : `${adapter.name} stopped. Your browser runtime turns it off in open pages.`);
    }), `${adapter.installed ? 'Stop running' : 'Run'} ${adapter.name} in my browser`));
    const more = element('a', '', 'On the Adapters page');
    more.href = '#/adapters';
    actions.append(more);
    card.append(actions);
    return card;
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
      const link = element('a', 'external', 'Source');
      link.append(icon('external'));
      link.href = adapter.sourceUrl; link.target = '_blank'; link.rel = 'noreferrer';
      link.setAttribute('aria-label', `Source of ${adapter.name} (opens in a new tab)`);
      actions.append(link);
    }
    if (adapter.docsUrl) {
      const link = element('a', 'external', 'Docs');
      link.append(icon('external'));
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

  // ── wiring ────────────────────────────────────────────────────────────────

  for (const id of ['adapter-search', 'adapter-app', 'adapter-kind', 'adapter-mine', 'adapter-installed', 'adapter-show-hidden']) {
    $(id).addEventListener(id === 'adapter-search' ? 'input' : 'change', render);
  }
  $('adapter-refresh').addEventListener('click', refresh);

  return { refresh };
}
