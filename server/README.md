# Toolkit Service

HTTP wire service over the AI for Accessibility Toolkit core (`../toolkit/`).
The wire contract is fixed and hand-maintained in [`CONTRACT.md`](./CONTRACT.md)
— read that first. Endpoint documentation (`API.md`) is a GENERATED artifact;
see "Docs" below.

This directory owns everything under `server/` except `CONTRACT.md`. It
imports the toolkit only through `../toolkit/index.js` (the barrel),
`../toolkit/platforms/node/*`, and `../toolkit/registry/tools.js` — never a
`toolkit/core/*` or `toolkit/sync/*` file directly — as a live demonstration
that the toolkit is decoupled from any one host. The exact edge list is held
by `scripts/import-boundaries-test.mjs` (`KNOWN_EDGES`). Zero npm
dependencies: plain `node:http`, `node:crypto`, ES modules.

## Layout

- `src/app.js` — the request router (`createApp(config)` -> a plain
  `(req,res)` listener; no `http.createServer`/`.listen()` inside it, so
  tests can boot it on an ephemeral port).
- `src/store.js` — `fileStore(dir)` (dev) / `gcsStore(bucket)` (prod, plain
  `fetch` against the GCS JSON REST v1 API + a Cloud Run/GCE metadata-server
  token — no SDK) behind one `{readJSON,writeJSON}` interface.
- `src/toolkit-host.js` — builds one Toolkit instance per uid (LRU-capped,
  ~50) over a KVStore adapted from `store.js`; wires the Gemini caller.
- `src/gemini.js` — the server-side Gemini REST caller
  (`librarian.setGeminiCaller`'s contract: `async (prompt) => string`).
- `src/auth.js` — bearer-token issue/verify (`aat_` + sha256-hashed storage),
  with token kinds (`app`, `default`, `session`) and expiry.
- `src/accounts.js`, `src/account-routes.js`, `src/admin-accounts.js` —
  developer accounts: scrypt passwords, sign-in, the derived default token,
  and the admin's account routes.
- `src/relay.js`, `src/providers.js` — Adapter MCP apps: apps register and
  hold a server-sent-events channel; MCP requests to `/v1/mcp/…` are relayed
  to them. In memory, one process.
- `src/shared-doc.js` — conditional read-modify-write for shared documents.
- `src/http.js` — small request/response helpers shared by the route files.
- `src/sdk-assets.js` — serves the Adapter MCP SDK at `/sdk/adapter-mcp.js`.
- `src/routes.js` — the 36 `/v1/librarian/{method}` routes, alias-mapped from a host's
  `librarian*` message switch. Single source of truth for both dispatch
  (`app.js`) and docs (`meta.js`).
- `src/meta.js` — builds `/v1/meta` and `API.md` from the live route table +
  a real (throwaway, in-memory) Librarian instance.
- `src/admin-page.js`, `admin/` — the admin console (`/admin`).
- `src/developer-page.js`, `developer/` — the developer console (`/developer`).
- `index.js` — env parsing + boot.

## Run

```bash
cd server
npm test                        # in-process app tests, no network
npm run docs                     # regenerate API.md from the live route table
DATA_DIR=./data ADMIN_PASSWORD=dev PORT=8080 npm start
```

Open **http://localhost:8080/admin** (any username, the admin password) to
make developer accounts, and **http://localhost:8080/developer** to sign in
with one. The developer console has four pages in a left sidebar —
**Profiles**, **Apps**, **Marketplace** and **Account & tokens** — and works on
the signed-in account's profile and apps. Connecting with a bare token (under
**Connect with an access token instead**) still works, for instances without accounts.

## Running a workshop

The toolkit service is pre-alpha research software, a technology probe: run a
workshop on a computer you control, with made-up profiles, not people's real
information.

1. From the repository root: `ADMIN_PASSWORD=<something> npm run dev:workshop`.
   `--workshop` lets any web page call `/v1` with a token, so Redbird and the
   participants' own pages can connect from other ports. It refuses to start
   with `NODE_ENV=production`.
2. Open `/admin`, then **Fill in team-1 … team-10** and **Make accounts**
   (or list your own usernames). Print or copy the sign-in details: passwords
   are shown once; after that you can only reset them.
3. Each team signs in at `/developer`. Their **default token** is in the
   sidebar; every app or adapter they build uses it.
4. Under **Apps**, **Open Redbird** opens the Redbird demo store (run it with
   `python3 tools/serve.py` in a Redbird checkout, on `http://localhost:8000`)
   already connected. Each tab shows up as **Redbird demo**, live, and its
   adapters can be tried from the console. Apps the team builds with the
   Adapter MCP SDK show up the same way, grouped by app; **Hide** keeps one
   out of the way.
5. A coding agent can call the same adapters over MCP: **Copy MCP endpoint**
   on an app, or the `claude mcp add` command under **Connect an app**.

Turning an account off in `/admin` revokes all its tokens and disconnects its
apps at once. Connected apps are kept in memory: after a restart they
reconnect by themselves.

## The Apps page

**Apps** lists every app that has connected with this account's tokens,
grouped by `appId`, with a **Live** or **Offline** badge, each connection, and
its recent calls. **Try it** builds a form from an adapter's parameter schema
and can turn it on or update it, turn it off, check whether it can run without
changing anything, read its state, undo the last change, and find targets.
**Hide** is saved in the account and also hides the app in the Marketplace;
**Show hidden** brings hidden apps back, and **Forget** removes an offline app.
The page refreshes every few seconds while it is open.

Programmatic access: `GET /v1/apps`, `PUT/DELETE /v1/apps/{appId}/hidden`,
and the MCP endpoints `POST /v1/mcp/apps/{appId}` and
`POST /v1/mcp/providers/{providerId}` — see CONTRACT.md, "Adapter MCP apps".

## The Marketplace page

**Marketplace** is the developer view of the adapter marketplace
(CONTRACT.md's "Adapter marketplace" section): adapters registered on this
instance, grouped by the app that registered them (the browser extension
publishes its catalog automatically in remote mode;
`node ../examples/register-xr-adapters.mjs` publishes the XR app's). Each
listing is **data-only** (a manifest: what the adapter does, the settings
keys it applies, links) or **data + code** (the source is stored on the
instance for hosts to download, lint, and install behind their own consent —
the server never runs it). The page filters by app, kind, search, `Mine`, and
`Installed`, shows the stored code with its hash, and registers new listings
with **+ Register adapter**. Install state is per user; delete is offered
only for listings your token's uid registered (admin can moderate anything
through the API).

Programmatic access: `GET/POST /v1/adapters`, `POST /v1/adapters/sync`,
`GET/PUT/DELETE /v1/adapters/{appId}/{id}[/code|/install]` — see API.md.

The page supports adding, editing, and removing nested keys with typed controls:
support areas and string lists use removable pills; needs use property cards
with dimension suggestions, value controls, strength and unit dropdowns,
confidence, and source; consent boundaries, language, vision kind, and sharing
use dropdowns; booleans use switches; numbers use numeric inputs; text is
editable without JSON quotes. Custom values and optional properties are
preserved. Full JSON editing remains available under **Edit full JSON**.
Each need starts as a single collapsed row showing its dimension and value;
expand the row to edit its properties. New needs open for editing, and a need
with a validation error opens automatically. Predefined profile choices and
need strength/unit dropdowns include an **Other** option and button that
reveal a custom text field. Existing custom values appear there automatically
and are preserved when saving or applying.
The page also supports creating, updating and deleting saved presets. **Load profile** immediately replaces the active
toolkit profile; **Apply to toolkit** applies editor changes in one write.
Omitted keys are removed. Schema version and timestamps are service-managed.
**Read from toolkit** and loading a preset replace the editor draft.

Nine built-in presets use `Profile 1` through `Profile 9` in the order of
[W3C WAI Stories of Web Users](https://www.w3.org/WAI/people-use-web/user-stories/),
with descriptive text retained in parentheses and links to each story.
Their summaries and structured settings are illustrative adaptations by this
project, not W3C-authored settings or universal disability defaults. Numeric
values are adjustable test starting points. `fields.needs` feeds the
toolkit's AbilityModel and surface renderers; additional fields (such as
`transcripts`, `largeTargets`, and `nonColorIndicators`) document needs for
hosts to implement. Existing scoped preferences can override a surface's
derived settings. Loading replaces the profile record, not memories,
grants, or skills.

Signed in, custom presets are saved in the account, so they follow the
developer to another browser; the first sign-in moves any presets saved in
this browser into the account. Connected with a bare token, presets stay in
this browser's localStorage. The sign-in session (24 hours) is kept in this
browser's localStorage until it expires or the developer signs out, so a
reload stays signed in; a bare token is kept in memory only. Built-in presets stay immutable; saving an edited built-in
creates a custom preset.

For another instance, enter its base URL (an optional trailing `/v1` is
accepted). On that instance set `CORS_ORIGINS` to the exact origin hosting
the interface, for example `CORS_ORIGINS=http://localhost:8080`. Use HTTPS
when connecting from an HTTPS page. No proxy is involved.

Profile manager checks: `node test/developer.test.mjs`; browser workflow:
`npm run test:developer:e2e` from the repository root (requires Playwright
Chromium, install with `npx playwright install chromium`). Adapter
marketplace checks: `node test/adapters.test.mjs`; Marketplace-page browser
workflow: `npm run test:adapters:e2e`; real-extension adoption workflow
(needs the extension repo checked out beside this one):
`npm run test:extension:e2e`. Accounts and apps: `node test/accounts.test.mjs`
and `node test/apps.test.mjs`; the admin-to-Apps browser workflow:
`npm run test:console:e2e`; Redbird connecting for real (needs a Redbird
checkout beside this one, or `REDBIRD_DIR`): `npm run test:redbird:e2e`.

## Env

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | |
| `ADMIN_PASSWORD` | **yes** in `NODE_ENV=production` | insecure dev default otherwise (logged loudly) | Bearer token for `/admin/*` |
| `GEMINI_API_KEY` | no | unset | Without it, `extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt` throw `no-server-key` when actually invoked; every other route is unaffected |
| `TOOLKIT_BUCKET` | no | unset | Set -> GCS backend; unset -> file backend |
| `DATA_DIR` | no | `./data` | Only used when `TOOLKIT_BUCKET` is unset |
| `CORS_ORIGINS` | no | unset | Comma-separated exact browser origins allowed on `/v1/*`, or `*` for any; same-origin developer UI needs no setting. The `--workshop` flag sets `*` (refused in production) |
| `LOG_FORMAT` | no | `json` on Cloud Run, else `text` | `json` writes one Cloud Logging entry per line |
| `LOG_LEVEL` | no | `info` | `debug` also logs successful static-file requests |
| `TOKEN_SECRET` | no | the admin password | Key that derives each account's default token. When it changes, each account gets a new default token at its next sign-in |

## Logs

The service writes one entry per request (method, path without the query
string, status, duration, the authenticated uid) and one per notable event:
`auth.signin` and `auth.signin.failed`, `account.*`, `token.issued`,
`token.revoked`, `token.default.rotated`, `user.deleted`, `app.registered`,
`app.connected`, `app.disconnected`, `mcp.call` (tool, adapter, client,
outcome, duration), `librarian.call.failed` (method and error code), and
`http.error` with the stack. On Cloud Run each entry is structured JSON, so
Cloud Logging filters on `jsonPayload.event` and `jsonPayload.uid` and Error
Reporting picks up stacks. Passwords, tokens, Authorization headers, request
and response bodies and profile content are never logged.
`node test/logging.test.mjs` checks both.

## Storage layout

`users/<uid>/local.json`, `users/<uid>/sync.json` (the KVStore's two areas,
per CONTRACT.md), `users/<uid>/apps.json` (apps seen, for the Apps page),
`users/<uid>/console.json` (hidden apps, saved presets),
`users/<uid>/activity.json` (the account's last 200 MCP calls, for **Recent
calls**), `admin/tokens.json`,
`admin/accounts.json`. Under `fileStore`, these are literal
files under `DATA_DIR`; under `gcsStore`, object names in `TOOLKIT_BUCKET`.
`admin/tokens.json` and `admin/accounts.json` are written by every instance,
so their writes are conditional (content hash under a lock file, or the GCS object generation)
and retried on conflict; see CONTRACT.md, Tokens.

## Docker

Build context is the **repo root** (the image needs both `toolkit/` and
`server/`):

```bash
docker build -f server/Dockerfile -t toolkit-service .
docker run -p 8080:8080 -e ADMIN_PASSWORD=... -e GEMINI_API_KEY=... toolkit-service
```

`server/.dockerignore` only applies automatically if you either build with
`docker build -f server/Dockerfile --ignore-file server/.dockerignore .` (newer
Docker) or set the build context to `server/` itself; with a plain
`-f server/Dockerfile .` invocation Docker looks for `.dockerignore` at the
context root. It's kept alongside the Dockerfile for discoverability and for
tooling that does support the per-Dockerfile convention
(`server/Dockerfile.dockerignore`); a repo-root `.dockerignore` would need its
own entries for `server/data`, `server/node_modules` etc. if you rely on that
path instead.

## Docs

`API.md` is generated, not hand-written — `node scripts/generate-docs.mjs`
(or `npm run docs`) rebuilds it from `src/routes.js` + a live Librarian
instance. Re-run it whenever `src/routes.js` or the Librarian's public method
set changes. Do not hand-edit `API.md`.
