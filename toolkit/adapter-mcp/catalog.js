// Adapter MCP descriptors for the toolkit's own catalog, derived from the
// canonical registry (toolkit/registry/tools.js) instead of written by hand.
//
// This is what lets every host describe the same adapter the same way: the
// browser extension, Redbird and any other web host that runs the catalog
// call `catalogDescriptor(entry, {appId, version})` and get one descriptor
// whose parameters come from the registry's typed settings vocabulary
// (`settingsMeta`), with the registry's ranges as JSON Schema bounds and its
// defaults as defaults. When an entry's first settings key is a boolean set
// to true (darkMode: true), it is the switch the adapter's on/off maps to, so
// it is not a parameter. Everything else is (visual-assist's fontScale,
// color-filter's colorBlindMode, focus-mode's hideDistractions).

import { skillRegistry, settingsMeta } from '../registry/tools.js';
import { defineDescriptor } from '../protocol/adapter/index.js';

function parameterSchema(key, fallback) {
  const meta = /** @type {Record<string, any>} */ (settingsMeta)[key];
  if (!meta) return { description: `Registry setting ${key}.`, default: fallback };
  const schema = /** @type {Record<string, any>} */ ({ description: meta.description, default: fallback });
  if (meta.type === 'enum') schema.enum = meta.options;
  else schema.type = meta.type;
  if (Array.isArray(meta.range)) { schema.minimum = meta.range[0]; schema.maximum = meta.range[1]; }
  return schema;
}

/**
 * One registry entry → one executable descriptor for `appId`.
 * @param {object} entry  a skillRegistry entry
 * @param {{appId: string, version: string, targets?: object[], reach?: 'self'|'external', exposure?: 'internal'|'mcp'}} options
 */
export function catalogDescriptor(entry, { appId, version, targets = [{ platforms: ['*'], urls: ['*'] }], reach = 'external', exposure = 'mcp' }) {
  const keys = Object.keys(entry.settings || {});
  const hasSwitch = keys.length > 0 && entry.settings[keys[0]] === true;
  const properties = {};
  for (const key of keys.slice(hasSwitch ? 1 : 0)) properties[key] = parameterSchema(key, entry.settings[key]);
  return defineDescriptor({
    appId,
    id: entry.id,
    name: entry.name,
    description: entry.description,
    version,
    exposure,
    reach,
    supportAreas: entry.supportAreas,
    surfaces: ['web'],
    targets,
    inputSchema: { type: 'object', properties, additionalProperties: false },
    requires: {
      host: ['web.document'],
      profileScopes: [],
      dependencies: entry.requiresAI ? [{ name: 'ai.provider', optional: false }] : [],
    },
    effects: { writes: keys.length ? keys.map(k => `settings.${k}`) : [`web.${entry.id}`], idempotent: true, reversibility: 'full' },
  });
}

/**
 * Descriptors for several catalog entries (all of them by default).
 * @param {{appId: string, version: string, ids?: string[], targets?: object[], reach?: 'self'|'external'}} options
 */
export function catalogDescriptors({ ids, ...options }) {
  const entries = ids ? ids.map(id => skillRegistry.find(e => e.id === id)).filter(Boolean) : skillRegistry;
  return entries.map(entry => catalogDescriptor(entry, options));
}
