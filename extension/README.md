# Adapter runtime (browser extension)

Runs the accessibility adapters you write or install in a toolkit's developer
console on the websites they target, and reports back what happened.

**Status:** an active research project, pre-alpha, a technology probe. The
adapters it runs are unvalidated, and it is not a replacement for assistive
technology. In practice: an adapter can change a page in ways nobody has
checked with the people it is meant for, so try it on pages you are testing,
and check what it changes before relying on it.

## Set it up

1. In Chrome 135 or later, open `chrome://extensions`, turn on
   **Developer mode**, choose **Load unpacked** and pick this `extension`
   folder.
2. On the extension's **Details**, turn on **Allow User Scripts**. Adapters
   run as user scripts, and Chrome asks you to allow them for each extension.
3. Sign in to your toolkit's developer console (`/developer`), open the
   extension from the toolbar, and choose **Connect with this console**. (Or
   enter the toolkit's address and your default token by hand.)

The console's **Adapters** page then shows **Connected in this browser**.

A coding agent with the toolkit skill can walk you through these steps:
`node .claude/skills/ai4a11y-toolkit/scripts/adapter.mjs extension` opens
`chrome://extensions` in Chrome, copies this folder's path for **Load
unpacked**, and prints the steps. `… adapter.mjs check` then confirms the
toolkit sees this browser: on connecting, the extension checks in with an
empty report.

## Use it

Build adapters with a coding agent (Claude Code, opencode) in the toolkit
repository. On the console's **Adapters** page, **+ New adapter** shows two
lines to copy into a `.env` file at the top of the repository: the toolkit
address and your default token. Then say what should change on which site.
The agent picks up the `ai4a11y-toolkit` skill, writes the adapter, and
publishes it to the toolkit's registry with the skill's `scripts/adapter.mjs`.
Within a few seconds this extension runs it on matching pages, including ones
that are already open, and each page's result appears on the adapter's card
in the console: running, failed (with the error), or switched off. Each
publish is a new revision, which replaces the running one without a reload.
**Edit** on a card changes an adapter in the console.

The extension's popup lists the installed adapters that target the current
page, what happened when they ran, and a switch to turn one off on this site.

You can also run adapters other developers shared on the same toolkit:
**Shared with you → Run in my browser**. Those stay on the revision you
installed until you choose **Update**.

## How it works

- It follows what your account installed into the app `browser-runtime` on the
  toolkit's adapter registry (`/v1/mcp`, see
  [docs/design/adapter-mcp.md](../docs/design/adapter-mcp.md) §14). Your own
  adapters follow their latest revision.
- Each adapter becomes one `chrome.userScripts` registration in the
  `USER_SCRIPT` world, at `document_idle`, top frame only
  ([runtime/scripts.js](runtime/scripts.js)). The script checks the page
  exactly against the adapter's patterns, turns off any earlier revision
  running in the page, calls `enable(parameters)`, and reports the result.
- The service worker ([background.js](background.js)) syncs on start, every
  30 seconds, on the registry's notifications while it is awake, and right
  after a save in the console. A small script ([bridge.js](bridge.js)) runs on
  the connected toolkit's `/developer` page only, so a save there wakes the
  runtime at once and the console can show whether this browser's runtime is
  connected. The token never reaches the page.
- Results go back to the registry with the page **origin** only, never the
  full address or anything on the page.
- `vendor/` holds copies of the toolkit's protocol modules and registry
  client, because an extension cannot load files from outside its folder.
  Rebuild them with `npm run build:extension` after changing those modules;
  `npm test` fails when they drift.

Shaped after the personalized extension's custom-adapter path (its user
script world and reconcile loop) in the AI-for-Accessibility-Extension
repository, without its built-in adapters, agents, voice or Librarian.

## What it will and will not do

- It runs only the adapters your signed-in account installed, and sends your
  token only to an `https` toolkit or one on this computer (`localhost`).
- The toolkit's lint refuses adapter code that sends data over the network,
  evaluates text as code or reads cookies. **The lint is not a sandbox.**
  Read an adapter's code before running someone else's, as you would any
  third-party software.
- Only connect to a toolkit you trust: it decides what code runs on the pages
  you visit.
- Pages Chrome does not let extensions touch (the Chrome Web Store,
  `chrome://` pages) are skipped.

## Tests

- `node extension/test/runtime.test.mjs` (part of `npm test`): the user
  scripts in a sandbox (scope, parameters, updates, teardown, failures, the
  async race), registrations, the address rule, and the vendored copies.
- `npm run test:runtime:e2e`: real Chromium with this extension loaded, a real
  toolkit service and a test site, from turning on **Allow User Scripts** to
  connecting from the console, running, live edits, per-site switches, a
  shared adapter, a failing one, and writing an adapter in the console that
  runs here and reports back.
