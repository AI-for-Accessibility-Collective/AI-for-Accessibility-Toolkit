// Who can read what an app or adapter gives the toolkit (adapter-mcp.md §14.5).
//
// Each app and adapter declares a visibility for the data it writes: its
// observations, what the toolkit learns from them, and its own stored data.
//
//   user     every app of the person's account can read it (the default)
//   app      only the app that wrote it
//   adapter  only the adapter it is about, and the apps that run it
//
// The person can narrow a declaration in the developer console, never widen
// it: the narrowest of the declared and the chosen level wins. The account's
// own tools (the console, and the default token) read everything; an app
// token, bound to one app, reads user-level data plus its own.
//
// Pure data, like registry.js and profile.js: the service enforces it.

import { SLUG, VISIBILITY, APP_VISIBILITY } from './descriptor.js';
import { REGISTRY_KEY_SCHEMA } from './registry.js';

export { VISIBILITY, APP_VISIBILITY };

/** The narrowest of some visibility levels (undefined and null are ignored; none is user). */
export function narrowestVisibility(...levels) {
  let rank = 0;
  for (const level of levels) {
    const r = VISIBILITY.indexOf(level);
    if (r > rank) rank = r;
  }
  return VISIBILITY[rank];
}

const S = 'https://json-schema.org/draft/2020-12/schema';
const APP_ID = { type: 'string', pattern: SLUG.source };
const DATA_KEY = { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9._:-]+$', description: 'A name for one value, such as "settings" or "last-run".' };

export const ACCESS_TOOL_SCHEMAS = Object.freeze({
  app_declare: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      appId: { ...APP_ID, description: 'The app. An app token may only declare its own app.' },
      name: { type: 'string', maxLength: 120, description: 'Display name.' },
      visibility: { enum: [...APP_VISIBILITY], description: 'Who can read what this app gives the toolkit: user (every app of the person, the default) or app (only this app).' },
    },
    required: ['appId', 'visibility'],
  },
  access_get: { $schema: S, type: 'object', additionalProperties: false, properties: {} },
  access_restrict: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      app: { ...APP_ID, description: 'Narrow what this app gives the toolkit.' },
      adapter: { ...REGISTRY_KEY_SCHEMA, description: 'Narrow what this adapter gives the toolkit.' },
      visibility: { enum: [...VISIBILITY, null], description: 'app or adapter narrows it; null (or user) goes back to what the app or adapter declared.' },
    },
    required: ['visibility'],
  },
  adapter_data_get: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { adapter: REGISTRY_KEY_SCHEMA, key: { ...DATA_KEY, description: 'One value; every value when left out.' } },
    required: ['adapter'],
  },
  adapter_data_set: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: {
      adapter: REGISTRY_KEY_SCHEMA,
      key: DATA_KEY,
      value: { description: 'Any JSON value. All of an adapter\'s values together stay under 4 MB (4,000,000 characters of JSON).' },
    },
    required: ['adapter', 'key', 'value'],
  },
  adapter_data_delete: {
    $schema: S, type: 'object', additionalProperties: false,
    properties: { adapter: REGISTRY_KEY_SCHEMA, key: { ...DATA_KEY, description: 'One value; all of them when left out.' } },
    required: ['adapter'],
  },
});

export const ACCESS_TOOLS = Object.freeze(Object.keys(ACCESS_TOOL_SCHEMAS));
export const ACCESS_READ_ONLY = Object.freeze(['access_get', 'adapter_data_get']);

export const ACCESS_TOOL_DESCRIPTIONS = Object.freeze({
  app_declare: 'Declare an app and who can read what it gives the toolkit: user (every app of the person) or app (only this app). The person can narrow it in the developer console.',
  access_get: 'Who can read what each app and adapter gives the toolkit: what each declared, what the person chose, and the result. With an app token, only that app and its adapters.',
  access_restrict: 'Narrow who can read what an app or adapter gives the toolkit (the developer console\'s setting). Only the account\'s own tools may, never an app token.',
  adapter_data_get: 'Read an adapter\'s stored data: its settings and anything else it keeps between runs, for this account.',
  adapter_data_set: 'Store one value for an adapter, for this account. Who can read it follows the adapter\'s visibility.',
  adapter_data_delete: 'Delete one of an adapter\'s stored values, or all of them.',
});
