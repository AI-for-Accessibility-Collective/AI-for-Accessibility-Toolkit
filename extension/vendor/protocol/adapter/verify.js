// Verifying what a developer built, as tools on the toolkit's MCP endpoint
// (/v1/mcp): what the toolkit does in the cloud for the assistant sidebar,
// for a coding agent. Each tool says what it is checking as it goes (MCP
// progress notifications, when the client asks for them) and ends with a
// short report: what was built, what was found, and the changes to make.
//
//   adapter_verify  a published web adapter: a summary of what it does, the
//                   check (its runs on test pages and recorded copies of real
//                   sites, in a sandbox) and, unless turned off, the full
//                   review (three reviewers at once). Takes minutes: it waits
//                   up to waitSeconds, then returns its checkId; calling again
//                   with it keeps waiting.
//   app_verify      an app connected with Adapter MCP: each of its adaptations
//                   read, checked, applied, read again and undone through the
//                   app itself, as the console's Try it does.
// Pure data, no imports.

const ID = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' };

export const VERIFY_TOOL_SCHEMAS = Object.freeze({
  adapter_verify: {
    type: 'object', additionalProperties: false,
    properties: {
      adapter: { type: 'string', maxLength: 200, description: 'The published adapter: its id, appId/id, or owner/appId/id. Its latest revision is verified.' },
      review: { type: 'boolean', description: 'Also have three independent reviewers (models) read and try it with WCAG rubrics. Default true; false runs only the check (about a minute).' },
      checkId: { type: 'string', pattern: '^chk_[a-f0-9]{20}$', description: 'Keep waiting for a verification already asked for (the checkId an earlier call returned).' },
      waitSeconds: { type: 'integer', minimum: 5, maximum: 840, description: 'How long to wait before returning what is known so far (default 240). Use less if your client stops tool calls sooner.' },
    },
  },
  app_verify: {
    type: 'object', additionalProperties: false, required: ['app'],
    properties: {
      app: { ...ID, description: 'The app id of an app connected now with Adapter MCP (connectToToolkit).' },
      adapters: { type: 'array', maxItems: 20, items: ID, description: 'Only these of its adaptations (their ids). Default: all.' },
    },
  },
});

export const VERIFY_TOOLS = Object.freeze(Object.keys(VERIFY_TOOL_SCHEMAS));

export const VERIFY_TOOL_DESCRIPTIONS = Object.freeze({
  adapter_verify: 'Verify a published web adapter, as the toolkit does in the cloud: say what it does in a few lines, run its check in a sandbox (test pages and recorded copies of real sites: axe-core, layout, keyboard, the adapter\'s own checks, and that disable() restores the page), and have three reviewers read and try it. Sends progress as it goes, and returns a short report with the changes to make. A full review takes about 15 minutes: if it is not done within waitSeconds, it returns its checkId; call again with { checkId } to keep waiting. Use your default token.',
  app_verify: 'Verify an app connected with Adapter MCP: for each adaptation, read its state, check, apply it with its default parameters, read again and undo it, through the running app (it changes the app for a moment, then puts it back). Returns a short report with the changes to make. The app must be open and connected.',
});
