// A client for a toolkit's adapter registry (adapter-mcp.md §14): the MCP
// server at `<toolkit>/v1/mcp` where applications share adapters.
//
//   const registry = createRegistryClient({ url: 'http://localhost:8080', token });
//   await registry.publish({ appName: 'Redbird demo', descriptor, code });   // private
//   await registry.share({ appId: 'redbird', id: 'big-buttons' });           // now everyone can find it
//   const { adapters } = await registry.search({ url: location.href });
//   await registry.install('my-app', adapters[0].adapter);
//   const running = await loadInstalledAdapters(registry, 'my-app');         // [{entry, adapter}]
//
// Every method returns the tool's structured result. A tool that refuses
// (not found, not shared, invalid) throws a RegistryCallError carrying the
// registry's error code.

import { createMcpClient } from './client.js';
import { WEB_MODULE, instantiateWebModule, matchUrlPattern } from '../protocol/adapter/index.js';

export class RegistryCallError extends Error {
  constructor(tool, result) {
    super(result?.message || `${tool} failed`);
    this.name = 'RegistryCallError';
    this.tool = tool;
    this.code = result?.error || 'error';
    this.result = result;
  }
}

/**
 * @param {Object} options
 * @param {string} options.url    the toolkit's base URL
 * @param {string} options.token  an app or default token
 * @param {typeof fetch} [options.fetch]
 */
export function createRegistryClient({ url, token, fetch: fetcher = globalThis.fetch.bind(globalThis), timeoutMs = 35000 }) {
  const endpoint = `${String(url).replace(/\/+$/, '')}/v1/mcp`;
  const mcp = createMcpClient({ url: endpoint, token, fetch: fetcher, timeoutMs, clientInfo: { name: 'ai4a11y-registry-client', version: '0.1.0' } });

  async function call(name, args) {
    const r = await mcp.callTool(name, args);
    if (r.isError) throw new RegistryCallError(name, r.structuredContent);
    return r.structuredContent;
  }

  return {
    mcp,
    call,
    search: (filters = {}) => call('adapter_search', filters),
    get: (adapter, { revision, includeCode } = {}) => call('adapter_get', { adapter, ...(revision ? { revision } : {}), ...(includeCode !== undefined ? { includeCode } : {}) }),
    /** Publish a new revision. Pass `code` (a web module) for a portable adapter, or `package` in full. */
    publish: ({ descriptor, code, entry, package: pkg, appName, shared }) => call('adapter_publish', {
      descriptor,
      ...(pkg || code ? { package: pkg || { format: WEB_MODULE, code, ...(entry ? { entry } : {}) } } : {}),
      ...(appName ? { appName } : {}),
      ...(shared !== undefined ? { shared } : {}),
    }),
    share: (adapter, shared = true) => call('adapter_share', { adapter, shared }),
    remove: (adapter) => call('adapter_delete', { adapter }),
    install: (app, adapter, options = {}) => call('adapter_install', { app, adapter, ...options }),
    uninstall: (app, adapter) => call('adapter_uninstall', { app, adapter }),
    installed: (app, { includeCode = false, ifEtag } = {}) => call('adapter_installed', { app, includeCode, ...(ifEtag ? { ifEtag } : {}) }),
    report: (app, instanceId, results, label) => call('adapter_report', { app, instanceId, results, ...(label ? { label } : {}) }),
    status: (filters = {}) => call('adapter_status', filters),

    /**
     * Listen for changes (notifications/resources/list_changed) until the
     * signal aborts. Reconnects after a dropped stream, waiting longer each
     * time, up to 30 seconds. `onChange(meta)` gets the registry's reason,
     * e.g. {reason: 'published', adapter: 'ada/redbird/big-buttons'}.
     */
    async watch(onChange, { signal } = {}) {
      let wait = 1000;
      while (!signal?.aborted) {
        try {
          const res = await fetcher(endpoint, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          wait = 1000;
          onChange({ reason: 'connected' });
          const reader = res.body.getReader(), decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
              const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
              if (!data) continue;
              try {
                const message = JSON.parse(data);
                if (message.method === 'notifications/resources/list_changed') onChange(message.params?._meta?.['ai4a11y/registry'] || {});
              } catch { /* not a message */ }
            }
          }
        } catch (e) {
          if (signal?.aborted) return;
        }
        await new Promise(resolve => setTimeout(resolve, wait));
        wait = Math.min(wait * 2, 30000);
      }
    },
  };
}

/**
 * Load what an app has installed and turn each portable adapter into a
 * working adapter object, for a web app that runs shared adapters itself.
 * Needs a page that allows evaluating code (no strict CSP); the browser
 * extension runs them as user scripts instead.
 *
 * @param {ReturnType<typeof createRegistryClient>} registry
 * @param {string} app
 * @param {{url?: string}} [options] only adapters that target this page (default: location.href when there is one)
 * @returns {Promise<{entry: object, adapter?: object, error?: string}[]>}
 */
export async function loadInstalledAdapters(registry, app, { url = globalThis.location?.href } = {}) {
  const { adapters = [] } = await registry.installed(app, { includeCode: true });
  const origin = url ? new URL(url).origin : null;
  return adapters
    .filter(entry => entry.available && entry.enabled && entry.package?.format === WEB_MODULE)
    .filter(entry => !url || ((entry.urlPatterns || []).some(p => matchUrlPattern(p, url)) && entry.sites?.[origin] !== false))
    .map((entry) => {
      try { return { entry, adapter: instantiateWebModule(entry.package.code, entry.package.entry) }; } catch (e) { return { entry, error: e.message }; }
    });
}
