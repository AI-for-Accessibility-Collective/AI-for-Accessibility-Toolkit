# Toolkit Service — wire contract (build input)

> This file is the **fixed contract** the server (`server/`) and the extension's
> remote mode build against. It is a build input, hand-maintained; the
> user-facing endpoint docs are GENERATED from the server's route table and must
> stay consistent with this contract (a test enforces it).

## Base

- Transport: HTTPS JSON. All requests/responses `content-type: application/json`.
- Base path: `/v1`.
- Auth: `Authorization: Bearer <token>` on every `/v1/*` route except `/healthz`
  and `/v1/meta`. A token maps server-side to a `uid`; all state is partitioned
  by that uid. Invalid/missing token → `401 {"error":"unauthorized"}`.
- Admin auth: a generated 16-character password (env `ADMIN_PASSWORD`, Secret
  Manager `toolkit-admin-password`); there is no separate admin token. The
  `/admin` page sits behind the browser's native login popup (HTTP `Basic`,
  any username — 401 + `WWW-Authenticate` challenge; the browser remembers the
  session by default). `/admin/*` API routes accept the same `Basic` credential
  or `Authorization: Bearer <ADMIN_PASSWORD>` for scripts/curl.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness: `{ok:true, version}` (no auth) |
| GET | `/v1/healthz` | the same payload; deployed probes must use this path, because bare `/healthz` is intercepted at the run.app edge |
| GET | `/v1/meta` | generated service+API description (no auth) |
| GET | `/developer` | developer console (profiles, adapters, apps, listings, account); static assets under `/developer/` (API calls require bearer) |
| POST, GET | `/v1/mcp` | the adapter registry, an MCP server (CONTRACT.md, "Adapter registry") |
| POST | `/v1/librarian/{method}` | invoke a Librarian method for the token's uid |
| GET | `/v1/whoami` | `{uid, label, kind}` for the presented token |
| GET | `/sdk/adapter-mcp.js` | the Adapter MCP SDK for apps (public code, any origin); its modules are under `/sdk/toolkit/` |
| POST | `/v1/auth/login` | developer sign-in `{username, password}` → `{token, expiresAt, account, defaultToken}`; `token` is a session |
| POST | `/v1/auth/logout` | end this session (session token) |
| GET | `/v1/account` | `{account, defaultToken, tokens, session, liveApps}` (session token) |
| PUT | `/v1/account` | rename the account `{displayName}` → `{account}`; the username stays (session token) |
| POST | `/v1/account/default-token` | regenerate the default token → `{defaultToken}` (session token) |
| POST | `/v1/account/tokens` | make an app token `{label?}` → `{token, id, label}`, shown once (session token) |
| DELETE | `/v1/account/tokens/{id}` | revoke one of the account's tokens (session token) |
| POST | `/v1/account/password` | change password `{current, next}` (session token) |
| GET | `/v1/account/presets` | `{presets}` saved profile presets (session token) |
| PUT | `/v1/account/presets` | replace saved presets `{presets}` (session token) |
| GET | `/v1/profile/selection` | `{revision, selected, updatedAt}`: the preset last loaded with `replaceProfile`, `selected` is `{id, name, edited}` or null (any token) |
| GET | `/v1/profile/events` | server-sent events: a `profile` event with that same object on connecting and on every profile write, so an app follows the profile without a refresh. It carries no profile content; read that with `getProfile` (any token) |
| GET | `/v1/profile/presets` | `{presets: [{id, name, description, builtIn}]}`: the console's built-in presets, then the account's saved ones (any token) |
| POST | `/v1/profile/select` | `{id}` makes that preset the active profile, as the console's Load profile does → `{revision, selected, updatedAt, profile}` (any token) |
| POST | `/v1/providers` | register an Adapter MCP app instance → `{providerId, endpoints}` (app or default token) |
| DELETE | `/v1/providers/{providerId}` | sign the instance off |
| GET | `/v1/providers/{providerId}/channel` | server-sent events: relayed MCP requests for the instance |
| POST | `/v1/providers/{providerId}/channel` | the instance's JSON-RPC response to one relayed request |
| POST | `/v1/mcp/providers/{providerId}` | MCP endpoint for one connected instance (same account) |
| POST | `/v1/mcp/apps/{appId}` | MCP endpoint for the app's single live instance (same account) |
| GET | `/v1/apps` | the account's connected apps, grouped by app, with `hiddenApps` |
| DELETE | `/v1/apps/{appId}` | forget an app that is not connected |
| PUT | `/v1/apps/{appId}/hidden` | hide the app in the developer console |
| DELETE | `/v1/apps/{appId}/hidden` | show it again |
| GET | `/v1/adapters` | list the adapter marketplace `{adapters, apps}`; filters `?app=` `?kind=` `?mine=1` `?installed=1` |
| POST | `/v1/adapters` | register an adapter `{appId, id, name, …}` → 201 `{adapter}`; `code` present makes kind `code` |
| POST | `/v1/adapters/sync` | publish an app's whole catalog `{appId, appName?, adapters[], full?}` |
| GET | `/v1/adapters/{appId}/{id}` | `{adapter}` |
| PUT | `/v1/adapters/{appId}/{id}` | update (registering uid or admin) |
| DELETE | `/v1/adapters/{appId}/{id}` | remove (registering uid or admin) |
| GET | `/v1/adapters/{appId}/{id}/code` | `{code, sha256, size, updatedAt}` for a kind-`code` listing |
| PUT | `/v1/adapters/{appId}/{id}/install` | mark installed for the calling uid |
| DELETE | `/v1/adapters/{appId}/{id}/install` | clear installed for the calling uid |
| GET | `/admin/accounts` | list developer accounts with token and live-app counts; `?passwords=1` → `{passwords: [{uid, displayName, password\|null, reason?}]}`, every admin-issued password; `?format=csv` → the same as a CSV download (username, name, password, password_note, status, last_sign_in, created, app_tokens, has_data) |
| POST | `/admin/accounts` | make an account `{uid, displayName?, password?}` → 201 `{account, password?}` |
| POST | `/admin/accounts/bulk` | make many `{accounts: [{uid, displayName?}]}` → `{results}` |
| PUT | `/admin/accounts/{uid}` | rename `{displayName}` |
| GET | `/admin/accounts/{uid}/password` | the password an admin issued `{password\|null, reason?}`; `null` once the developer changed it themselves |
| POST | `/admin/accounts/{uid}/password` | reset the password `{password?}` → `{password?}` |
| POST | `/admin/accounts/{uid}/disable` | turn off: revoke every token, disconnect its apps |
| POST | `/admin/accounts/{uid}/enable` | turn back on |
| DELETE | `/admin/accounts/{uid}` | delete the account, its data and its tokens |
| GET | `/admin/assets/console.js` | the admin console's script (public code) |
| POST | `/admin/tokens` | create token `{uid, label?, kind?}` → `{token, uid}` (token shown once) |
| GET | `/admin/tokens` | list `{id, uid, label, kind, createdAt, expiresAt?, revoked}` (no token values; `id` is what DELETE takes) |
| DELETE | `/admin/tokens/{id}` | revoke |
| GET | `/admin/users` | list `{users: uid[]}`, every uid holding stored state |
| DELETE | `/admin/users/{uid}` | delete that uid's partition and revoke its tokens; returns `{ok, uid, revokedTokens}` (a count), or 404 when the uid had neither data nor live tokens |
| GET | `/admin` | admin console (accounts, tokens, stored data) — browser login popup |

## `/v1/librarian/{method}`

- `{method}` is the camelCase Librarian method name (e.g. `getAbilityModel`,
  `recall`, `respondToProposal`) — the SAME names as the extension's
  `librarian*` message types with the `librarian` prefix dropped and the first
  letter lower-cased. `librarianEffectivePreferences` → `effectivePreferences`
  maps to `getEffectivePreferences` (alias table in the server route map).
- Body: `{"args": [...]}` — positional arguments exactly as the in-process
  method takes them. Missing body = `{"args": []}`.
- Success: `200 {"ok":true, "result": <return value>}`.
- Method threw: `200 {"ok":false, "error": "<message>"}` (application errors
  are data, not transport failures).
- Unknown method: `404 {"error":"unknown-method"}`.
- Methods that don't exist server-side by design (none today) must be listed in
  `/v1/meta` as `unsupported`.
- In addition to the 36 extension-message aliases, the following DIRECT-surface
  methods (called by the voice side panel on the Librarian object rather than
  via `librarian*` messages) are first-class routes under their own names:
  `interpretNeedsPrompt`, `hasScopedSetting`, `getScopedSetting`,
  `removeScopedSetting`, `recordExplicitSetting`, `resetToProfile`
  ("back to my profile": the bulk inverse of `recordScopedSettings`. Without a
  wire route a remote host's reset reaches nothing and reports success anyway).
- `setProfileFields` is a first-class route under its own name for the same
  reason, with no extension message behind it. Every profile field lives in one
  stored record, so a caller that writes four fields in four requests writes
  that record four times and a failure between any two of them leaves a profile
  that contradicts itself. Fields belonging to one form go over the wire
  together.
- The natural-language note methods — `addNote`, `listNotes`, `updateNote`,
  `deleteNote`, `findNotes` — are routes under their own names too. Notes are
  the free-form text the person wrote about their own needs; a hosted instance
  partitions them by uid like every other record, and they remain outside
  `GRANT_SCOPES`, so no other app can read one.
- `replaceProfile(profile)` replaces the entire active profile in one record
  write, removing omitted keys. It rejects non-JSON values, unsafe object keys,
  and malformed structured fields. The service manages `schemaVersion`,
  `createdAt`, and `updatedAt`. Memories, grants, and skills remain separate.
  An optional second argument `{id, name}` names the preset being loaded; the
  service keeps it as the selected profile (stored with the console's
  preferences). `{id, name, edited: true}` says the profile is that preset with
  changes (the console's temporary profile). A later `setProfileField`, `setProfileFields` or
  `respondToProposal` marks it `edited`, and a `replaceProfile` with no
  preset clears it. Every one of those writes also announces itself on
  `/v1/profile/events`.
- 49 routes total.

## Developer interface and CORS

`/developer` and its static assets are public; reading and writing toolkit
data requires a bearer token. A developer signs in with an account (below):
the console keeps the session token in localStorage until it expires, and
saves custom presets in the account. Connecting with a bare access token
instead keeps that token in memory and presets in browser localStorage.
Loading a preset calls `replaceProfile` immediately; editing a draft requires
**Apply to toolkit**.

For an interface or app hosted on a different origin, set `CORS_ORIGINS` on
the target instance to a comma-separated list of exact allowed origins, such
as `http://localhost:8080`, or to `*` for any origin (a workshop setting;
`npm run dev:workshop` sets it). Allowed origins receive CORS headers on
`/v1/*` responses and `OPTIONS` preflights; other preflights receive 403.
`*` is safe only because every `/v1/*` route authenticates with a bearer
token the page must hold itself, never a cookie. Admin APIs never enable
CORS. A browser POST to `/admin/*` carrying the cached Basic credential must
be same-origin `application/json`, so a foreign page cannot forge one.

## Accounts and sign-in

- An account is `{uid, displayName, passwordHash, issuedPassword?,
  passwordSetBy, createdAt, updatedAt, lastLoginAt, disabled,
  defaultTokenGeneration}` in `admin/accounts.json`. The username **is** the
  uid, so an account reaches the same profile partition an admin-minted token
  for that uid does. Passwords are scrypt hashes. The password an admin
  issued (made or typed) is also kept in `issuedPassword`, AES-256-GCM under a
  key derived from `TOKEN_SECRET` or the admin password, so the admin console
  can show it again. When the developer changes their password, that copy is
  deleted and `passwordSetBy` becomes `account`: a password they chose may be
  one they use elsewhere. Changing the secret makes kept copies unreadable;
  resetting the password keeps a new one.
- `POST /v1/auth/login` returns two credentials. `token` is a **session**
  (kind `session`, 24 hours) for the developer console; only a session may
  call `/v1/account/*`. `defaultToken` is the account's **default token**
  (kind `default`), the one its apps and adapters use. It is the same after
  every sign-in until regenerated, and it is never stored raw: it is derived
  as HMAC-SHA256(`TOKEN_SECRET` or the admin password, uid + generation), and
  only its hash is in `admin/tokens.json`. Changing that secret makes the next
  sign-in issue a new default token.
- Sign-in is rate limited per username and per client address (10 failures in
  15 minutes, in memory). A disabled account cannot sign in, and disabling
  revokes all its tokens.

## Adapter registry

The service is an MCP server at `/v1/mcp` where apps built with the toolkit
share adapters ([docs/design/adapter-mcp.md](../docs/design/adapter-mcp.md)
§14). Any token of an account works (session, default or app).

- `POST /v1/mcp`: JSON-RPC `initialize`, `ping`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`; notifications answer 202; no batches.
  Tools: `adapter_search`, `adapter_get`, `adapter_publish`, `adapter_share`,
  `adapter_delete`, `adapter_install`, `adapter_uninstall`,
  `adapter_installed`, `adapter_report`, `adapter_status`. Their input
  schemas are `toolkit/protocol/adapter/registry.js`; arguments that do not
  fit are a tool error (`isError`, `structuredContent.error =
  "invalid-arguments"`), as are refusals (`not-found`, `forbidden`,
  `invalid-adapter`, `revision-gone`, `invalid-site`, `invalid-parameters`).
- `GET /v1/mcp` with `Accept: text/event-stream`: `notifications/resources/list_changed`
  whenever an adapter the account can see changes, its installs change, or
  one of its runtimes reports; the reason is in `params._meta["ai4a11y/registry"]`.
  A comment line every 25 seconds keeps the stream open.
- `adapter_publish` takes a short descriptor too: without `adapterProtocol`,
  `{appId, id, name, description, targets, supportAreas}` is enough, and the
  rest takes `defineDescriptor`'s defaults (an on/off web adapter with no
  settings, version 1.0.0). The skill's `scripts/adapter.mjs` publishes this way.
- An adapter is `{owner, appId, id}`. It is private to its owner until
  shared; a shared adapter is visible to every account on this instance.
  Publishing checks the descriptor and any `web-module@1` package (including
  its lint) and computes both digests; an unchanged publish is not a new
  revision. The newest 20 revisions are kept.
- Installing your own adapter follows `"latest"`; installing someone else's
  pins the current revision. Sites are origins; only sites switched off are
  stored.
- Reports carry an origin, a status and at most 500 characters of message;
  the newest 500 per account are kept, and runtimes not heard from for a week
  are forgotten.
- Storage: `users/<uid>/registry.json`,
  `users/<uid>/registry/<appId>/<id>/<revision>.json`,
  `users/<uid>/installs.json` and `users/<uid>/runtime-status.json` (deleted
  with the account), and `registry/shared.json`, an index of shared adapters
  from which a deleted account's entries are removed.

### Profile and learning tools

The same endpoint serves the person's profile and what the toolkit learns
about them over time (`server/src/learning.js`; schemas in
`toolkit/protocol/adapter/profile.js`; the SDK's `createRegistryClient(…).profile`):
`profile_get`, `profile_observe`, `profile_learned`, `profile_learn_now`,
`profile_proposal_respond`, `profile_memory_delete`, `profile_learning_pause`,
`profile_learning_reset`.

- Observations come from apps (`profile_observe`, or `logObservation` on
  `/v1/librarian`) and from the registry: installing an adapter into
  `browser-runtime`, removing it, switching it off or on, and switching it
  off or on for a site. Installs into other apps are a developer setting an
  app up and are not observed. An observation is one plain sentence, a site
  (kept as its hostname) and at most 1000 characters of data: never page
  content. The Librarian's privacy floor applies (paused, per-site pauses,
  no-memory zones).
- The service's Librarians have no scheduler, so the service runs `extract`
  30 seconds after an account's last observation (`profile_learn_now` runs it
  at once). Extraction sends the observations to the server-side LLM and
  turns them into memories and suggested profile changes, within the
  profile's weekly limit (`metaPreferences.maxProposalsPerWeek`).
- A suggestion changes the profile only when the person accepts it
  (`profile_proposal_respond`); the change is announced to the apps following
  the profile, like any profile write.
- `profile_learning_reset` clears the suggestions (the weekly count starts
  again) and the "stop suggesting" list; with `memories: true` also the
  memories (the person's own notes stay) and the observations not learned from
  yet. The profile itself is left as it is. The developer console's Memory
  page shows all of this under "What your toolkit learned".
- An observation may carry up to 4 images (`images: [{mimeType, data}]`,
  PNG, JPEG, WebP or GIF, base64, at most 2,000,000 characters each), on
  `profile_observe` and on `logObservation` (whose body may then be up to
  12 MB). Each image is kept in its own document beside the observation
  (`…/media/<id>.json`) and goes away with it; the newest 8 images of the
  observations being learned from are sent to the model with the prompt.

### Who can read what an app or adapter gives

Tools `app_declare`, `access_get`, `access_restrict`, `adapter_data_get`,
`adapter_data_set`, `adapter_data_delete`; schemas in
`toolkit/protocol/adapter/access.js`.

- Levels: `user` (every app of the account; the default), `app` (only that
  app), `adapter` (only that adapter, its own app and the apps that installed
  it). An app declares one with `app_declare`, or `application.visibility`
  when it registers for live control (registering also records the app's
  name, for the console); an adapter with `visibility` in its
  descriptor. `access_restrict` (the console's setting) narrows either and
  never widens it: the narrowest level wins. An app token may declare only its
  own app and may not restrict.
- Callers: a console session, the default token and an app token without an
  `appId` are the account's own tools and read everything; what they write
  is the account's unless it names an `app` (or `adapter`) to apply that
  one's visibility, so an app that writes with the default token names
  itself in every observation, or the console's narrowing cannot reach what
  it writes. An app token with
  an `appId` writes as that app (naming another is `forbidden`), reads
  user-level data, its own app's, and the adapter-level data of adapters of
  its app or installed into it.
- Observations at `app` or `adapter` level go to a partition with its own
  Librarian (`users/<uid>/scoped/app~<appId>/…` or
  `…/scoped/adapter~<owner>~<appId>~<id>/…`, listed in
  `users/<uid>/access.json`). The account's pauses hold for them, the toolkit
  learns from them there, and they never become suggested profile changes.
  `profile_learned`, `listMemories` and `recall` add the memories of the
  partitions the caller may read, tagged `visibility`, `app` and `adapter`;
  `profile_memory_delete`, `profile_learn_now` and `profile_learning_reset`
  reach the same partitions.
- Registry events in `browser-runtime` follow the adapter's level.
- Adapter data: values per account and adapter
  (`users/<uid>/adapter-data/<owner>/<appId>/<id>.json`), at most 4,000,000
  characters of JSON in all. At `user` level any token of the account reads
  and writes them; narrower, the account's own tools and the apps named
  above. In the browser runtime an adapter reaches its data and
  `profile_observe` through `enable(parameters, toolkit)` (`toolkit.data`,
  `toolkit.observe`); the extension calls the tools as that adapter.

## Adapter MCP apps

Apps built with the Adapter MCP SDK (`toolkit/adapter-mcp/`, served at
`/sdk/adapter-mcp.js`) can also connect for **live control** while they are
open, to the account whose token they hold; see
[docs/design/adapter-mcp.md](../docs/design/adapter-mcp.md) §5–§8.

- `POST /v1/providers` registers one running instance:
  `{providerId?, label?, application, adapters: [descriptor]}`. The service
  re-validates the application and every descriptor and recomputes each
  `descriptorDigest`; a mismatch is a 400 listing `errors`. Only adapters with
  `exposure: "mcp"` are accepted. A session token is refused (403): apps use
  an app or default token. An app token bound to another app is refused (403).
- The instance then holds `GET …/channel` open (server-sent events). Each
  `request` event carries one MCP JSON-RPC message from a client, with a
  relay-local `id`; the instance answers with `POST …/channel`. The service
  relays framing only. It never runs adapter code or rewrites results.
- MCP clients of the **same uid** call `POST /v1/mcp/providers/{providerId}`
  or, when the app has exactly one live instance, `POST /v1/mcp/apps/{appId}`
  (Streamable HTTP, JSON responses, no server-initiated stream, no batches).
  An offline instance answers 503 and a 30-second timeout 504, each with a
  JSON-RPC error. Bearer tokens here are this service's tokens, not the MCP
  authorization specification's OAuth flow.
- `GET /v1/apps` merges live instances (in memory, per process) with the
  last registration per app (`users/<uid>/apps.json`). Hidden apps are a
  per-account list in `users/<uid>/console.json`, which also holds presets.
  Each app's `recentCalls` (newest first) come from the account's stored
  activity, `users/<uid>/activity.json`: the last 200 MCP calls, each with
  its tool, adapter, client, outcome and duration but never its arguments or
  results. They survive a restart and are deleted with the account.
  Revoking a token, disabling or deleting the account disconnects its apps.
- Live connections are per process: run one instance, or route a provider
  and its clients to the same one.

## Adapter marketplace

Listings of adapters published by host applications, so a developer
interface or another host can discover what each app offers, grouped by app
(the console's **Listings** page). It predates the registry above, which is
where apps share adapters other apps can run.

- An entry is `{appId, id, name, description, version, settingsKeys[],
  supportAreas[], requiresAI, sourceUrl, docsUrl, kind, codeSize, codeSha256,
  registeredBy, registeredByLabel, createdAt, updatedAt}`. `appId` and `id`
  are lowercase slugs (`[a-z0-9][a-z0-9._-]{0,63}`); `sync` is a reserved
  `appId`. `supportAreas` is a subset of `vision, motor, hearing, cognitive,
  sensory, reading`. The entry's key is `appId/id`, so two apps may each have
  an adapter with the same `id`.
- Two kinds. `data` is a manifest only — the adapter's code lives in the
  app's own repo. `code` additionally stores a JavaScript source blob
  (≤ 256 KB) served verbatim by `GET …/code`. The server never runs, lints,
  or vouches for code; a host that executes it (the extension installs such
  adapters as Chrome user scripts) lints it first and gates it behind its own
  consent. Treat downloaded code with the care of any third-party software —
  see the extension's SECURITY.md.
- Auth: every route needs a user bearer token. Any valid token may register
  and may update/delete/sync only entries its uid registered; the admin
  password (Basic or Bearer) may update or delete anything (moderation).
  `registeredBy` (the publishing uid) is public in listings.
- `POST /v1/adapters/sync` is the host-side bulk publish: upsert every listed
  adapter under one `appId` (creating new entries, updating the caller's own,
  skipping entries another uid registered), and with `full: true` also remove
  the caller's entries missing from the payload. Response:
  `{appId, created, updated, removed[], skipped[{id, reason}]}`.
- Install state is per user: `PUT`/`DELETE …/install` write
  `users/<uid>/adapters.json`, and listings carry `mine` (registered by the
  calling uid) and `installed` (in that uid's state). Deleting the user wipes
  it with the rest of the partition; catalog entries they registered stay and
  remain admin-editable.
- Storage: shared `adapters/catalog.json` (conditional write with retry, like
  `admin/tokens.json`), one `adapters/code/<appId>/<id>.json` per code entry,
  and `users/<uid>/adapters.json`.
- An entry may carry an optional Adapter MCP `descriptor`. It must be valid
  and describe the same `appId/id`; the service stores it with the
  `descriptorDigest` it computed. Entries without one are legacy,
  metadata-only listings (the developer console labels them so).

## Health path caveat

`GET /healthz` works locally but is intercepted at the `*.run.app` edge before
reaching the container; the canonical deployed liveness path is
`GET /v1/healthz` (same payload, no auth). Deployed probes must use the
/v1-prefixed form.

## Server-side LLM

The server holds `WS_GEMINI_KEY` (or, when that is unset, `GEMINI_API_KEY`)
and calls `librarian.setGeminiCaller(serverGeminiCaller)` at boot, with
`gemini-3.8-flash` unless `GEMINI_MODEL` says otherwise. Clients therefore get
`extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt`, and the learning loop
(CONTRACT's "Profile and learning tools"), without any key.
Applications making their own direct LLM calls keep using their own keys —
nothing here proxies arbitrary LLM traffic (`/v1/librarian/*` only).

## Storage

KVStore port per uid: areas `local`/`sync` → backend documents
`users/<uid>/<area>.json`. Backends: `file` (dev, under `--data-dir`) and
`gcs` (prod, bucket from `TOOLKIT_BUCKET`). Same interface as
`toolkit/ports/index.js` KVStore.

## Tokens

- Format: `aat_` + 32 bytes base64url randomness. Stored **hashed** (sha256).
- Record: `{id, uid, label, kind, appId?, hash, createdAt, expiresAt?, revoked}` in
  the storage backend under `admin/tokens.json`. `kind` is `app` (admin- or
  account-minted; records without a kind read as `app`; `appId`, when given at
  minting, binds it to one app: see "Who can read what an app or adapter
  gives"), `default` (an
  account's default token) or `session` (a console sign-in, with
  `expiresAt`; expired and revoked sessions are pruned on the next issue).
- A uid may hold multiple tokens; revocation is per-token.
- Every change to `admin/tokens.json` is a conditional write: the file
  backend checks a content hash under a lock file, the GCS backend passes the
  object generation as `ifGenerationMatch`. A change that loses the race is
  reloaded and retried, so two service instances sharing one bucket cannot
  overwrite each other's revocations. A change that still loses after five
  attempts, or a lock file that never frees, answers `503` with
  `Retry-After: 1`; the request was fine and can be repeated as is.

## Extension remote mode

- Config lives in `chrome.storage.sync` keys `toolkitServerUrl`,
  `toolkitServerToken` (set via the extension's options UI).
- When both are set, background.js routes every `librarian*` message through
  `RemoteLibrarian` (fetch to `/v1/librarian/{method}`) instead of the local
  `globalThis.Librarian`. Empty/unset config = local mode (unchanged behavior).
- `respondToProposal`, `requestGrant` etc. keep identical response shapes so
  popup/onboarding/voice code is unchanged either way.
- In remote mode the extension also adopts the adapter marketplace: on
  startup and whenever the config changes it publishes its adapter catalog
  (`POST /v1/adapters/sync`, `appId: "browser-extension"`, `full: true`) —
  the built-in tools registry plus the person's custom skills as metadata;
  no adapter code is uploaded. The popup's marketplace section lists
  kind-`code` adapters registered for this app; installing one downloads the
  source, runs it through the Adapter Builder's lint, and saves it as a
  custom skill (the existing user-scripts reconcile installs it). Lint-
  rejected code is never installed.
