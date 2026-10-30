// The Adapter MCP SDK, served by every toolkit instance so an app can import
// it straight from the toolkit it connects to:
//
//   import { createAdapterProvider, connectToToolkit } from 'http://localhost:8080/sdk/adapter-mcp.js';
//
// The files are the toolkit's own modules, served at their repository paths
// under /sdk/ so their relative imports resolve unchanged. An explicit list
// only: a request path never becomes a filesystem path. They are public code
// with no data in them, so any origin may load them (module scripts need
// CORS to load cross-origin).

import { readFileSync } from 'node:fs';

const TOOLKIT_FILES = [
  'protocol/adapter/index.js',
  'protocol/adapter/descriptor.js',
  'protocol/adapter/schema.js',
  'protocol/adapter/canonical.js',
  'protocol/adapter/match.js',
  'protocol/adapter/wire.js',
  'protocol/adapter/package.js',
  'protocol/adapter/registry.js',
  'adapter-mcp/index.js',
  'adapter-mcp/provider.js',
  'adapter-mcp/wrap.js',
  'adapter-mcp/connect.js',
  'adapter-mcp/client.js',
  'adapter-mcp/registry.js',
  'adapter-mcp/catalog.js',
  'registry/tools.js',
];

const JS = 'text/javascript; charset=utf-8';

export const SDK_ASSETS = new Map(TOOLKIT_FILES.map((file) => [`/sdk/toolkit/${file}`, {
  body: readFileSync(new URL(`../../toolkit/${file}`, import.meta.url)),
  type: JS,
}]));

// One short, stable entry point.
SDK_ASSETS.set('/sdk/adapter-mcp.js', {
  body: Buffer.from("// Adapter MCP SDK — see docs/design/adapter-mcp.md in the toolkit repository.\nexport * from './toolkit/adapter-mcp/index.js';\n"),
  type: JS,
});

// The toolkit's skill for coding agents (Claude Code, opencode), so a
// developer can add it to a project with one command (the Adapters page's
// New adapter guide). A build without the skill folder leaves these out.
const SKILL_DIR = new URL('../../.claude/skills/ai4a11y-toolkit/', import.meta.url);
for (const [file, type] of [['SKILL.md', 'text/markdown; charset=utf-8'], ['scripts/adapter.mjs', JS]]) {
  try {
    SDK_ASSETS.set(`/skill/ai4a11y-toolkit/${file}`, { body: readFileSync(new URL(file, SKILL_DIR)), type });
  } catch { /* not in this build */ }
}

export function serveSdkAsset(res, asset, req) {
  const headers = {
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
  };
  if (!asset) {
    res.writeHead(204, {
      ...headers,
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      ...(req?.headers['access-control-request-private-network'] ? { 'access-control-allow-private-network': 'true' } : {}),
    });
    return res.end();
  }
  res.writeHead(200, { ...headers, 'content-type': asset.type, 'cache-control': 'no-cache' });
  res.end(req?.method === 'HEAD' ? undefined : asset.body);
}
