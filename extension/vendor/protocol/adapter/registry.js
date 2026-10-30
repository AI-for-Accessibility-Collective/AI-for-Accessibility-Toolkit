// The toolkit's adapter registry tools (adapter-mcp.md §14).
//
// A toolkit service is an MCP server at `/v1/mcp` where applications share
// adapters: publish a package, find what others shared, install it into an
// app, and learn when something they installed changed. These schemas are
// what that server advertises in `tools/list`, and what it validates
// arguments against before it reads or writes anything.
//
// An adapter in the registry is named by its owner (the account that
// published it), its application and its id: `{owner, appId, id}`. Several
// workshop participants can each publish `redbird/my-adapter` without
// colliding. Each publish is a new revision (1, 2, 3, …); the descriptor keeps
// its own `version` string, chosen by the author.

import { SLUG } from './descriptor.js';
import { PACKAGE_FORMATS } from './package.js';

const S = 'https://json-schema.org/draft/2020-12/schema';
const SLUG_PATTERN = SLUG.source;
/** An account uid as the service stores it: one path segment. */
export const OWNER_PATTERN = '^(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$';
/** The app a browser runtime installs into. */
export const BROWSER_RUNTIME_APP = 'browser-runtime';
export const REPORT_STATUSES = Object.freeze(['applied', 'failed', 'skipped', 'removed']);

export const REGISTRY_KEY_SCHEMA = Object.freeze({
  type: 'object',
  description: 'Which shared adapter: its owner (account uid; defaults to you), application and id.',
  properties: {
    owner: { type: 'string', pattern: OWNER_PATTERN },
    appId: { type: 'string', pattern: SLUG_PATTERN },
    id: { type: 'string', pattern: SLUG_PATTERN },
  },
  required: ['appId', 'id'],
  additionalProperties: false,
});

const APP = { type: 'string', pattern: SLUG_PATTERN, description: `The app that adopts adapters, e.g. ${BROWSER_RUNTIME_APP} or redbird.` };
const REVISION = { type: 'integer', minimum: 1 };
const SITES = {
  type: 'object',
  description: 'Per-site switches: an origin (https://example.com) mapped to false turns the adapter off there.',
  additionalProperties: { type: 'boolean' },
};

export const REGISTRY_TOOL_SCHEMAS = Object.freeze({
  adapter_search: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      query: { type: 'string', maxLength: 200, description: 'Words to find in the name or description.' },
      scope: { enum: ['all', 'mine', 'shared'], description: 'all (default): yours plus those shared with you.' },
      appId: { type: 'string', pattern: SLUG_PATTERN, description: 'Only adapters published by this application.' },
      url: { type: 'string', description: 'Only adapters whose URL targets include this page.' },
      supportArea: { enum: ['vision', 'motor', 'hearing', 'cognitive', 'sensory', 'reading'] },
      portable: { type: 'boolean', description: 'true: only adapters with a package another app can run.' },
    },
  },
  adapter_get: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      adapter: REGISTRY_KEY_SCHEMA,
      revision: { ...REVISION, description: 'A past revision; the latest when left out.' },
      includeCode: { type: 'boolean', description: 'Include the package code (default true).' },
    },
    required: ['adapter'],
  },
  adapter_publish: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      appName: { type: 'string', maxLength: 120, description: 'Display name of the publishing application.' },
      descriptor: { type: 'object', description: 'The Adapter MCP descriptor. Its appId and id name the adapter; descriptorDigest and executionArtifactDigest are computed by the registry. A short one is enough for an on/off web adapter: {appId, id, name, description, targets: [{platforms: ["*"], urls: ["https://example.com/*"]}], supportAreas}; the rest takes the defaults.' },
      package: {
        type: 'object',
        description: 'Code another application can run. Leave out to share a description only.',
        properties: {
          format: { enum: [...PACKAGE_FORMATS] },
          code: { type: 'string' },
          entry: { type: 'string', description: 'The export that is the adapter, when the file exports several.' },
        },
        required: ['format', 'code'],
        additionalProperties: false,
      },
      shared: { type: 'boolean', description: 'Share it with everyone on this toolkit. New adapters are private until shared.' },
    },
    required: ['descriptor'],
  },
  adapter_share: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { adapter: REGISTRY_KEY_SCHEMA, shared: { type: 'boolean' } },
    required: ['adapter', 'shared'],
  },
  adapter_delete: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { adapter: REGISTRY_KEY_SCHEMA },
    required: ['adapter'],
  },
  adapter_install: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      app: APP,
      adapter: REGISTRY_KEY_SCHEMA,
      revision: { anyOf: [REVISION, { const: 'latest' }], description: '"latest" follows new revisions (the default for your own adapters); a number pins one (the default for someone else\'s).' },
      enabled: { type: 'boolean' },
      sites: SITES,
      parameters: { type: 'object', description: 'Arguments for enable(options), checked against the descriptor\'s inputSchema.' },
    },
    required: ['app', 'adapter'],
  },
  adapter_uninstall: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { app: APP, adapter: REGISTRY_KEY_SCHEMA },
    required: ['app', 'adapter'],
  },
  adapter_installed: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      app: APP,
      includeCode: { type: 'boolean', description: 'Include each package (default false).' },
      ifEtag: { type: 'string', description: 'The etag from the last answer; when nothing changed the answer is {unchanged: true}.' },
    },
    required: ['app'],
  },
  adapter_report: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      app: APP,
      instanceId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$', description: 'This running copy of the app (one browser, one tab).' },
      label: { type: 'string', maxLength: 120 },
      results: {
        type: 'array', maxItems: 200,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            adapter: REGISTRY_KEY_SCHEMA,
            revision: REVISION,
            origin: { type: 'string', maxLength: 300, description: 'Where it ran: the page origin only, never the full URL.' },
            status: { enum: [...REPORT_STATUSES] },
            message: { type: 'string', maxLength: 500 },
            at: { type: 'string', maxLength: 40 },
          },
          required: ['adapter', 'status'],
        },
      },
    },
    required: ['app', 'instanceId', 'results'],
  },
  adapter_status: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { app: APP, adapter: REGISTRY_KEY_SCHEMA },
  },
});

export const REGISTRY_TOOLS = Object.freeze(Object.keys(REGISTRY_TOOL_SCHEMAS));
export const REGISTRY_READ_ONLY = Object.freeze(['adapter_search', 'adapter_get', 'adapter_installed', 'adapter_status']);

export const REGISTRY_TOOL_DESCRIPTIONS = Object.freeze({
  adapter_search: 'Find adapters to adopt: your own and those other accounts shared on this toolkit. Returns summaries with each adapter\'s key, latest revision and where it runs.',
  adapter_get: 'Read one adapter: its descriptor and, for a portable adapter, its package code, at the latest or a given revision.',
  adapter_publish: 'Publish an adapter from your application as a new revision. With a package (web-module@1 code) other applications can run it; without one it is a description only. Private until shared.',
  adapter_share: 'Share one of your adapters with everyone on this toolkit, or stop sharing it.',
  adapter_delete: 'Delete one of your adapters and all its revisions. Apps that installed it stop receiving it.',
  adapter_install: 'Install an adapter into one of your apps (for example browser-runtime), or change an installation: pin a revision, switch it off, turn it off on a site, set its parameters.',
  adapter_uninstall: 'Remove an adapter from one of your apps.',
  adapter_installed: 'What an app has installed, resolved to revisions, with packages when asked. A runtime calls this to stay in step.',
  adapter_report: 'A runtime reports what happened when it ran adapters: applied, failed (with the error), skipped or removed, per page origin.',
  adapter_status: 'The latest reports from your runtimes, per adapter and app.',
});

/** The key as one string, `owner/appId/id`. */
export const registryKey = (k) => `${k.owner}/${k.appId}/${k.id}`;
