// JSON Schemas for the gateway tools' arguments and results (adapter-mcp.md
// §5–§8). These are what a provider advertises in `tools/list`, so a general
// MCP client can build a valid call without reading this repository. The
// gateway's `parameters` stays an open object: the provider additionally
// validates it against the pinned descriptor's own `inputSchema`.

import { MUTATION_STATUSES, QUERY_STATUSES, VERIFICATION, PROFILE_VERSION } from './descriptor.js';

const S = 'https://json-schema.org/draft/2020-12/schema';

export const ADAPTER_REF_SCHEMA = Object.freeze({
  type: 'object',
  description: 'The exact adapter a client checked: app, id, version and descriptor digest (from adapter_list or adapter_describe).',
  properties: {
    appId: { type: 'string' },
    id: { type: 'string' },
    version: { type: 'string' },
    descriptorDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
  },
  required: ['appId', 'id', 'version', 'descriptorDigest'],
  additionalProperties: false,
});

// describe accepts a partial reference, so a client can learn the digest.
const LOOSE_REF_SCHEMA = Object.freeze({
  type: 'object',
  properties: { appId: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' }, descriptorDigest: { type: 'string' } },
  required: ['appId', 'id'],
  additionalProperties: false,
});

export const TARGET_SCHEMA = Object.freeze({
  type: 'object',
  description: 'One concrete target: exactly one of a native application id or a web URL. ref is adapter-defined (see the adapter\'s targetRefSchema).',
  properties: {
    platform: { type: 'string', description: 'Target operating system, e.g. macos. Required for a native application.' },
    application: { type: 'string', description: 'Native application id (bundle id or package name).' },
    url: { type: 'string', description: 'Absolute http(s) URL of the web resource.' },
    ref: { type: 'object', description: 'Adapter-defined reference within the application or URL.' },
  },
  additionalProperties: false,
});

const REASONS_SCHEMA = { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, key: { type: 'string' } }, required: ['code', 'message'] } };

export const TOOL_SCHEMAS = Object.freeze({
  adapter_list: {
    input: {
      $schema: S, type: 'object', additionalProperties: false,
      properties: {
        surface: { type: 'string', description: 'Only adapters that can affect this surface (web, xr, native).' },
        capability: { type: 'string', description: 'Only adapters declaring this capability id, e.g. a11y.text.scale@1.' },
        target: TARGET_SCHEMA,
        cursor: { type: 'string' },
      },
    },
    output: {
      type: 'object',
      properties: {
        profileVersion: { type: 'string' }, application: { type: 'object' },
        adapters: { type: 'array', items: { type: 'object' } }, nextCursor: { type: ['string', 'null'] }, guarantees: { type: 'object' },
      },
      required: ['profileVersion', 'application', 'adapters'],
    },
  },
  adapter_describe: {
    input: { $schema: S, type: 'object', additionalProperties: false, properties: { adapterRef: LOOSE_REF_SCHEMA }, required: ['adapterRef'] },
    output: { type: 'object', properties: { status: { type: 'string' }, descriptor: { type: 'object' }, availability: { type: 'object' }, reasons: REASONS_SCHEMA }, required: ['status'] },
  },
  adapter_targets: {
    input: { $schema: S, type: 'object', additionalProperties: false, properties: { adapterRef: ADAPTER_REF_SCHEMA, cursor: { type: 'string' } }, required: ['adapterRef'] },
    output: { type: 'object', properties: { status: { type: 'string' }, candidates: { type: 'array' }, nextCursor: { type: ['string', 'null'] }, coverage: { enum: ['complete', 'partial', 'unknown'] }, reasons: REASONS_SCHEMA }, required: ['status'] },
  },
  adapter_query: {
    input: {
      $schema: S, type: 'object', additionalProperties: false,
      properties: { adapterRef: ADAPTER_REF_SCHEMA, target: TARGET_SCHEMA, fields: { type: 'array', items: { type: 'string' } } },
      required: ['adapterRef', 'target'],
    },
    output: {
      type: 'object',
      properties: {
        status: { enum: [...QUERY_STATUSES, 'unavailable'] }, target: { type: 'object' }, state: { type: 'object' },
        observedAt: { type: 'string' }, cached: { type: 'boolean' }, consistency: { enum: ['atomic', 'best-effort'] },
        verification: { enum: VERIFICATION }, unavailableFields: { type: 'array' }, reasons: REASONS_SCHEMA,
      },
      required: ['status'],
    },
  },
  adapter_check: {
    input: {
      $schema: S, type: 'object', additionalProperties: false,
      properties: { adapterRef: ADAPTER_REF_SCHEMA, target: TARGET_SCHEMA, desired: { type: 'object' } },
      required: ['adapterRef', 'target', 'desired'],
    },
    output: { type: 'object', properties: { status: { type: 'string' }, compatible: { type: 'boolean' }, reasons: REASONS_SCHEMA, degradation: { type: 'array' } }, required: ['status', 'compatible'] },
  },
  adapter_apply: {
    input: {
      $schema: S, type: 'object', additionalProperties: false,
      properties: {
        profileVersion: { type: 'string', description: `The Adapter MCP profile version the client implements; this provider speaks ${PROFILE_VERSION}.` },
        adapterRef: ADAPTER_REF_SCHEMA,
        target: TARGET_SCHEMA,
        desired: {
          type: 'object',
          description: 'Stateful adapters: the complete desired configuration {enabled, parameters} (parameters required when enabled, omitted when disabled). Action adapters: {parameters} only.',
          properties: { enabled: { type: 'boolean' }, parameters: { type: 'object' } },
          additionalProperties: false,
        },
        requestKey: { type: 'string', maxLength: 200, description: 'Unique per intent; a retry with the same key and arguments returns the same execution.' },
        expectedRevision: { type: 'string' },
      },
      required: ['profileVersion', 'adapterRef', 'target', 'desired'],
    },
    output: {
      type: 'object',
      properties: {
        executionId: { type: 'string' }, operation: { type: 'string' }, status: { enum: MUTATION_STATUSES },
        adapterRef: { type: 'object' }, target: { type: 'object' }, effectsKnown: { type: 'boolean' },
        requested: {}, applied: {}, unmet: { type: 'array' }, degradedTo: { type: 'object' }, data: {},
        verification: { enum: VERIFICATION }, undo: { type: 'object' }, reasons: REASONS_SCHEMA,
      },
      required: ['status', 'reasons'],
    },
  },
  adapter_revert: {
    input: {
      $schema: S, type: 'object', additionalProperties: false,
      properties: { receiptId: { type: 'string' }, requestKey: { type: 'string', maxLength: 200 } },
      required: ['receiptId'],
    },
    output: { type: 'object', properties: { operation: { const: 'revert' }, status: { enum: MUTATION_STATUSES }, reasons: REASONS_SCHEMA }, required: ['status', 'reasons'] },
  },
});

export const GATEWAY_TOOLS = Object.freeze(Object.keys(TOOL_SCHEMAS));

export const TOOL_DESCRIPTIONS = Object.freeze({
  adapter_list: 'List the accessibility adapters this application exposes, with its platform and the guarantees it supports. Read-only.',
  adapter_describe: 'Get one adapter\'s full descriptor (parameters, targets, effects) and whether it is available now. Read-only.',
  adapter_targets: 'List concrete targets (pages, documents, apps) this adapter can address right now. Read-only.',
  adapter_query: 'Read an adapter\'s current state on a target without changing anything. Read-only.',
  adapter_check: 'Check whether a desired configuration could run on a target now, without applying it or calling AI. Read-only.',
  adapter_apply: 'Apply, update, or turn off an adapter on one target. Stateful adapters take the complete desired configuration.',
  adapter_revert: 'Undo an earlier apply using its receipt, if the adapter offered undo and nothing changed since.',
});
