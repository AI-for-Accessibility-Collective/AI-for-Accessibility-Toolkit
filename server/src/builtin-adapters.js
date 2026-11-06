// The toolkit's own adapters, built in: the core set (tools/core-adapters/,
// one per major barrier, built on toolkit/blocks; briefs in
// scripts/verify-adapters/core-adapters.json), published in the registry at
// start under the reserved owner `toolkit` (app "Toolkit"), shared with every
// account. Search, install and the browser runtime then treat them like any
// shared adapter. Publishing the same code again is not a new revision, so a
// restart changes nothing unless an adapter's file did.
//
// No account can be named `toolkit` (accounts.js RESERVED_USERNAMES), so
// nobody signs in as their owner. Like every adapter, they are unvalidated.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_MODULE } from '../../toolkit/protocol/adapter/index.js';

export const BUILTIN_OWNER = 'toolkit';
export const BUILTIN_APP = { appId: 'toolkit', appName: 'Toolkit' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRIEFS = path.join(ROOT, 'scripts/verify-adapters/core-adapters.json');
const CODE_DIR = path.join(ROOT, 'tools/core-adapters');

/** One sentence about an adapter: its file's opening comment, up to "Barrier:". */
export function summaryOf(code) {
  const lines = [];
  for (const [i, line] of code.split('\n').entries()) {
    const m = /^\/\/ ?(.*)$/.exec(line);
    if (!m || !m[1].trim() || /^Barrier:/.test(m[1])) break;
    lines.push(i === 0 ? m[1].replace(/^\S+\.js\s+—\s+/, '') : m[1].trim());
  }
  return lines.join(' ').trim();
}

/** The built-in adapters as publish arguments: [{descriptor, package, appName, shared}]. */
export function loadBuiltinAdapters({ briefs = BRIEFS, dir = CODE_DIR } = {}) {
  const { adapters } = JSON.parse(readFileSync(briefs, 'utf8'));
  return adapters.map((b) => {
    const code = readFileSync(path.join(dir, `${b.id}.js`), 'utf8');
    return {
      descriptor: {
        appId: BUILTIN_APP.appId, id: b.id, name: b.name, description: summaryOf(code).slice(0, 500), version: '1.0.0',
        // Every web page, as the assistant's "All websites" is.
        targets: [{ platforms: ['*'], urls: ['*://*/*'] }],
        supportAreas: b.suggestedFor || [],
        ...(b.needs?.length ? { needs: b.needs } : {}),
      },
      package: { format: WEB_MODULE, code },
      appName: BUILTIN_APP.appName,
      shared: true,
    };
  });
}

/** The needs the built-ins meet, for the profile agent: [{from: {appId, adapter}, needs}]. */
export function builtinNeeds(adapters = loadBuiltinAdapters()) {
  return adapters.filter(a => a.descriptor.needs?.length).map(a => ({
    from: { appId: a.descriptor.appId, adapter: `${BUILTIN_OWNER}/${a.descriptor.appId}/${a.descriptor.id}` },
    needs: a.descriptor.needs,
  }));
}

/**
 * Publish the built-ins (once at start). One that fails is logged and the
 * rest still go in. Resolves to {published, unchanged, failed}.
 */
export async function seedBuiltinAdapters(registry, { log, adapters = loadBuiltinAdapters() } = {}) {
  const out = { published: 0, unchanged: 0, failed: 0 };
  for (const args of adapters) {
    try {
      const r = await registry.call(BUILTIN_OWNER, 'adapter_publish', args);
      out[r.unchanged ? 'unchanged' : 'published']++;
    } catch (e) {
      out.failed++;
      log?.warn?.('builtin.publish-failed', { id: args.descriptor.id, error: e.message });
    }
  }
  log?.info?.('builtin.seeded', out);
  return out;
}
