// The toolkit's profile and learning tools, served on the same MCP endpoint as
// the adapter registry (/v1/mcp). The toolkit learns about the person from what
// they do with their adapters and apps: each app reports what happened with
// profile_observe, the toolkit turns observations into memories and suggested
// profile changes (proposals), and the person answers each suggestion. Nothing
// changes the profile without their answer. Pure data, like registry.js.

import { SLUG } from './descriptor.js';
import { REGISTRY_KEY_SCHEMA } from './registry.js';

const ID = { type: 'string', minLength: 1, maxLength: 120 };

export const PROFILE_TOOL_SCHEMAS = Object.freeze({
  profile_get: { type: 'object', additionalProperties: false, properties: {} },
  profile_observe: {
    type: 'object', additionalProperties: false, required: ['text'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 400, description: 'What the person did, in one plain sentence, e.g. "Turned off Bigger buttons on https://example.com." Never page content or anything they typed.' },
      origin: { type: 'string', maxLength: 200, description: 'The site it happened on: an origin such as https://example.com, or its hostname.' },
      type: { type: 'string', enum: ['setting-change', 'adapter-installed', 'adapter-removed', 'observation'], description: 'setting-change for a deliberate choice (weighs most), observation for anything else.' },
      data: { type: 'object', description: 'Small structured details, e.g. {adapter: "bigger-buttons", supportAreas: ["motor"], on: false}.' },
      images: {
        type: 'array', maxItems: 4,
        description: 'Up to 4 images of what the person saw or did, such as a screenshot, kept with the observation and shown to the model when it learns. Each at most 2,000,000 base64 characters.',
        items: {
          type: 'object', additionalProperties: false, required: ['mimeType', 'data'],
          properties: { mimeType: { enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }, data: { type: 'string', maxLength: 2000000, description: 'The image, base64.' } },
        },
      },
      app: { type: 'string', pattern: SLUG.source, description: 'The app it happened in. An app token is always its own app.' },
      adapter: { ...REGISTRY_KEY_SCHEMA, description: 'The adapter it is about, when it is about one: its visibility then applies.' },
    },
  },
  profile_learned: { type: 'object', additionalProperties: false, properties: {} },
  profile_learn_now: { type: 'object', additionalProperties: false, properties: {} },
  profile_proposal_respond: {
    type: 'object', additionalProperties: false, required: ['id', 'response'],
    properties: {
      id: ID,
      response: { type: 'string', enum: ['accept', 'declineOnce', 'suppress'], description: 'accept changes the profile; declineOnce says not now; suppress stops suggesting this.' },
    },
  },
  profile_memory_delete: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } },
  profile_learning_pause: { type: 'object', additionalProperties: false, required: ['paused'], properties: { paused: { type: 'boolean' } } },
  profile_learning_reset: {
    type: 'object', additionalProperties: false,
    properties: {
      memories: { type: 'boolean', description: 'Also forget the memories and the observations not learned from yet. The person\'s own notes stay.' },
    },
  },
});

export const PROFILE_TOOLS = Object.freeze(Object.keys(PROFILE_TOOL_SCHEMAS));
export const PROFILE_READ_ONLY = Object.freeze(['profile_get', 'profile_learned']);

export const PROFILE_TOOL_DESCRIPTIONS = Object.freeze({
  profile_get: 'Read the person\'s profile: their needs and settings, which every app renders.',
  profile_observe: 'Tell the toolkit what the person did with an adapter or app, so it can learn: one plain sentence, the site, small details, and up to 4 images. Who can read it follows the visibility of the app or adapter it comes from. Skipped while learning is paused.',
  profile_learned: 'What the toolkit learned: the memories it keeps, the suggested profile changes waiting for an answer, how many it suggested this week against its weekly limit, and whether learning is paused.',
  profile_learn_now: 'Learn from the observations so far now, instead of waiting a little after the last one. Uses the toolkit\'s language model.',
  profile_proposal_respond: 'Answer a suggested profile change: accept (the profile changes and apps follow it), declineOnce, or suppress.',
  profile_memory_delete: 'Forget one memory.',
  profile_learning_pause: 'Pause or resume learning. While paused, observations are not kept.',
  profile_learning_reset: 'Start learning over: clear the suggested changes (the weekly count starts again at zero) and the "stop suggesting" list; with memories, also the memories and pending observations. The profile itself stays as it is.',
});
