// Adapter descriptors and application advertisements (adapter-mcp.md §3–§4).
//
// A descriptor is the one registration that feeds validation, the MCP tool
// schemas, and the developer console's generated controls, so the three
// cannot drift apart. `checkDescriptor` returns every problem at once, as
// `{path, message}` pairs, so a developer fixes a descriptor in one pass.

import { checkSchema } from './schema.js';
import { checkTargetRules, checkPlatformRecords } from './match.js';

export const PROFILE_NAME = 'ai4a11y.adapter-mcp';
export const PROFILE_VERSION = '0.1.0';
/** The MCP revision this binding is written against. */
export const MCP_PROTOCOL_VERSION = '2025-11-25';
/** During 0.x a client and provider must agree on the exact profile version. */
export const SUPPORTED_PROFILE_VERSIONS = Object.freeze([PROFILE_VERSION]);

export const MODES = Object.freeze(['stateful', 'action']);
export const EXPOSURES = Object.freeze(['internal', 'mcp']);
export const REACHES = Object.freeze(['self', 'external']);
export const SURFACES = Object.freeze(['web', 'xr', 'native']);
export const REVERSIBILITY = Object.freeze(['full', 'partial', 'none']);
/** Per-adapter domain operations. `apply` is required; the rest are optional. */
export const OPERATIONS = Object.freeze(['query', 'check', 'apply', 'revert', 'targets']);
export const VERIFICATION = Object.freeze(['adapter-reported', 'host-observed', 'user-confirmed']);
export const MUTATION_STATUSES = Object.freeze(['applied', 'partial', 'noop', 'unavailable', 'failed', 'cancelled']);
export const QUERY_STATUSES = Object.freeze(['ok', 'partial', 'unavailable', 'unsupported']);
export const SUPPORT_AREAS = Object.freeze(['vision', 'motor', 'hearing', 'cognitive', 'sensory', 'reading']);
/** Who can read what an app or adapter gives the toolkit (access.js). */
export const VISIBILITY = Object.freeze(['user', 'app', 'adapter']);
/** An app declares user or app; adapter-level is for an adapter's own data. */
export const APP_VISIBILITY = Object.freeze(['user', 'app']);
export const REASON_CODES = Object.freeze([
  'invalid-parameters', 'permission-required', 'permission-denied', 'missing-provider',
  'target-unavailable', 'target-ambiguous', 'invalid-target-ref', 'target-out-of-scope',
  'stale-target', 'stale-revision', 'precondition-unsupported', 'descriptor-changed',
  'unsupported-setting', 'out-of-range', 'write-conflict', 'operation-unsupported',
  'undo-expired', 'instance-active', 'internal-error', 'profile-version-unsupported',
  'unknown-adapter',
]);

/** App ids and adapter ids are path segments and document-name fragments. */
export const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CAPABILITY_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+@[1-9][0-9]*$/;
const MAX_TEXT = 2000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const stringList = (v) => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0);

/**
 * Check an application advertisement: identity, platforms and reachable
 * surfaces, declared once for all of the application's adapters.
 * @returns {{path: string, message: string}[]}
 */
export function checkApplication(app) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObject(app)) return [{ path: '/application', message: 'must be an object' }];
  if (typeof app.appId !== 'string' || !SLUG.test(app.appId)) err('/application/appId', `must match ${SLUG} (lowercase letters, digits, dot, dash, underscore)`);
  if (typeof app.name !== 'string' || !app.name.trim() || app.name.length > 120) err('/application/name', 'must be a display name of 1–120 characters');
  if (typeof app.version !== 'string' || !app.version.trim() || app.version.length > 64) err('/application/version', 'must be the exact application version');
  errors.push(...checkPlatformRecords(app.supportedPlatforms, '/application/supportedPlatforms', { required: true }));
  if (app.platform !== undefined && !isObject(app.platform)) err('/application/platform', 'must be an object describing the running platform');
  if (!stringList(app.surfaces) || !app.surfaces.length || app.surfaces.some(s => !SURFACES.includes(s))) err('/application/surfaces', `must be a non-empty list of ${SURFACES.join(', ')}`);
  if (app.description !== undefined && (typeof app.description !== 'string' || app.description.length > MAX_TEXT)) err('/application/description', `must be text of at most ${MAX_TEXT} characters`);
  if (app.visibility !== undefined && !APP_VISIBILITY.includes(app.visibility)) err('/application/visibility', `must be ${APP_VISIBILITY.join(' or ')}`);
  return errors;
}

/**
 * Check an executable adapter descriptor.
 * @param {object} d
 * @param {{application?: object}} [context] the owning application, to check
 *   inherited surfaces
 * @returns {{path: string, message: string}[]}
 */
export function checkDescriptor(d, { application } = {}) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObject(d)) return [{ path: '', message: 'a descriptor must be an object' }];

  if (typeof d.appId !== 'string' || !SLUG.test(d.appId)) err('/appId', `must match ${SLUG}`);
  if (application && d.appId !== application.appId) err('/appId', `must equal the application's appId "${application.appId}"`);
  if (typeof d.id !== 'string' || !SLUG.test(d.id)) err('/id', `must match ${SLUG}`);
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 120) err('/name', 'must be a display name of 1–120 characters');
  if (typeof d.description !== 'string' || d.description.length > MAX_TEXT) err('/description', `must be plain text of at most ${MAX_TEXT} characters`);
  if (typeof d.version !== 'string' || !d.version.trim() || d.version.length > 64) err('/version', 'must be the exact implementation version');

  const proto = d.adapterProtocol;
  if (!isObject(proto) || proto.name !== PROFILE_NAME) err('/adapterProtocol/name', `must be "${PROFILE_NAME}"`);
  else if (!SUPPORTED_PROFILE_VERSIONS.includes(proto.version)) err('/adapterProtocol/version', `must be one of ${SUPPORTED_PROFILE_VERSIONS.join(', ')} (0.x versions must match exactly)`);

  if (!EXPOSURES.includes(d.exposure)) err('/exposure', `must be ${EXPOSURES.join(' or ')}`);
  if (!REACHES.includes(d.reach)) err('/reach', `must be ${REACHES.join(' or ')}`);
  if (!MODES.includes(d.mode)) err('/mode', `must be ${MODES.join(' or ')}`);

  if (!Array.isArray(d.capabilities)) err('/capabilities', 'must be a list (it may be empty)');
  else d.capabilities.forEach((c, i) => {
    if (!isObject(c) || typeof c.id !== 'string' || !CAPABILITY_ID.test(c.id)) err(`/capabilities/${i}/id`, 'must be a versioned capability id such as "a11y.text.scale@1"');
    if (isObject(c) && c.parameterBindings !== undefined && (!isObject(c.parameterBindings) || Object.values(c.parameterBindings).some(v => typeof v !== 'string'))) {
      err(`/capabilities/${i}/parameterBindings`, 'must map capability parameters to implementation parameter names');
    }
  });

  if (d.platformConstraints !== undefined) errors.push(...checkPlatformRecords(d.platformConstraints, '/platformConstraints', { required: true }));

  if (!stringList(d.surfaces) || !d.surfaces.length || d.surfaces.some(s => !SURFACES.includes(s))) err('/surfaces', `must be a non-empty list of ${SURFACES.join(', ')}`);
  else if (application && Array.isArray(application.surfaces)) {
    for (const s of d.surfaces) if (!application.surfaces.includes(s)) err('/surfaces', `"${s}" is not a surface the application declares it can reach`);
  }

  if (d.targets !== undefined || d.exposure === 'mcp') errors.push(...checkTargetRules(d.targets));

  for (const key of ['targetRefSchema', 'inputSchema', 'outputSchema', 'stateSchema']) {
    if (d[key] === undefined) continue;
    errors.push(...checkSchema(d[key], `/${key}`));
    if (isObject(d[key]) && d[key].type !== 'object') err(`/${key}/type`, 'must be "object"');
  }
  if (d.inputSchema === undefined) err('/inputSchema', 'is required (use {"type":"object","properties":{},"additionalProperties":false} for no parameters)');

  if (!Array.isArray(d.operations) || !d.operations.includes('apply')) err('/operations', 'must be a list that includes "apply"');
  else {
    for (const op of d.operations) if (!OPERATIONS.includes(op)) err('/operations', `unknown operation "${op}" (one of ${OPERATIONS.join(', ')})`);
    if (new Set(d.operations).size !== d.operations.length) err('/operations', 'must not repeat an operation');
    if (d.operations.includes('query') && d.stateSchema === undefined) err('/stateSchema', 'is required when "query" is supported');
    if (d.operations.includes('revert') && d.effects?.reversibility === 'none') err('/operations', '"revert" cannot be offered when effects.reversibility is "none"');
  }

  const req = d.requires;
  if (!isObject(req)) err('/requires', 'must be an object with host, profileScopes and dependencies lists');
  else {
    if (!stringList(req.host ?? [])) err('/requires/host', 'must be a list of host privilege names');
    if (!stringList(req.profileScopes ?? [])) err('/requires/profileScopes', 'must be a list of existing Librarian grant scopes');
    const deps = req.dependencies ?? [];
    if (!Array.isArray(deps) || deps.some(x => !(typeof x === 'string' && x) && !(isObject(x) && typeof x.name === 'string' && x.name))) {
      err('/requires/dependencies', 'must be a list of dependency names or {name, optional, fallback} objects');
    }
  }

  const eff = d.effects;
  if (!isObject(eff)) err('/effects', 'must be an object with writes, idempotent and reversibility');
  else {
    if (!Array.isArray(eff.writes) || eff.writes.some(w => typeof w !== 'string' || !w)) err('/effects/writes', 'must be a list of owned resources or settings (it may be empty)');
    if (typeof eff.idempotent !== 'boolean') err('/effects/idempotent', 'must be true or false');
    if (!REVERSIBILITY.includes(eff.reversibility)) err('/effects/reversibility', `must be ${REVERSIBILITY.join(', ')}`);
  }

  if (d.supportAreas !== undefined && (!Array.isArray(d.supportAreas) || d.supportAreas.some(a => !SUPPORT_AREAS.includes(a)))) {
    err('/supportAreas', `must be a list of ${SUPPORT_AREAS.join(', ')}`);
  }
  if (d.visibility !== undefined && !VISIBILITY.includes(d.visibility)) err('/visibility', `must be ${VISIBILITY.join(', ')}`);
  return errors;
}

/** The short form `adapter_list` returns for one adapter. */
export function summarizeDescriptor(d) {
  const summary = {
    appId: d.appId, id: d.id, name: d.name, description: d.description, version: d.version,
    descriptorDigest: d.descriptorDigest, mode: d.mode, reach: d.reach, surfaces: d.surfaces,
    operations: d.operations, capabilities: (d.capabilities || []).map(c => c.id),
  };
  if (d.supportAreas) summary.supportAreas = d.supportAreas;
  return summary;
}

/** The pinned reference a client sends back: `{appId, id, version, descriptorDigest}`. */
export function adapterRefOf(d) {
  return { appId: d.appId, id: d.id, version: d.version, descriptorDigest: d.descriptorDigest };
}

/**
 * A descriptor with sensible defaults filled in, for the common case of a
 * stateful adapter with no parameters. Every field can be overridden.
 * @param {object} fields at least appId, id, name, description, version
 */
export function defineDescriptor(fields) {
  return {
    description: '',
    adapterProtocol: { name: PROFILE_NAME, version: PROFILE_VERSION },
    exposure: 'mcp',
    reach: 'self',
    mode: 'stateful',
    capabilities: [],
    surfaces: ['web'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, additionalProperties: true },
    // requestedParameters is the last configuration applied through the
    // provider — what was asked for, not observed effective state.
    stateSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Whether the adapter reports itself on.' },
        requestedParameters: { type: 'object', description: 'The last parameters applied through this provider (requested, not observed).' },
      },
      additionalProperties: false,
    },
    requires: { host: [], profileScopes: [], dependencies: [] },
    effects: { writes: [], idempotent: true, reversibility: 'full' },
    operations: ['query', 'check', 'apply', 'revert'],
    ...fields,
  };
}
