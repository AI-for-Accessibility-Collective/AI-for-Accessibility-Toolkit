# Toolkit Service API

_Generated 2026-10-30T10:42:33.266Z by `server/scripts/generate-docs.mjs` from the live route table (`server/src/routes.js`) and the Librarian method list (`toolkit/core/librarian.js`, introspected through the `toolkit/index.js` barrel). Do not hand-edit — re-run `npm run docs`._

Version: `0.1.0`

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | liveness: {ok:true, version} |
| GET | `/v1/healthz` | none | the same payload; the path deployed probes must use (the bare /healthz is intercepted at the run.app edge) |
| GET | `/v1/meta` | none | generated service+API description |
| GET | `/developer` | none (API calls require bearer) | developer profile manager; static assets under /developer/ |
| POST | `/v1/librarian/{method}` | bearer | invoke a Librarian method for the token's uid |
| GET | `/v1/whoami` | bearer | {uid, label, kind} for the presented token |
| GET | `/v1/adapters` | bearer | list the adapter marketplace, grouped-by-app metadata included; filters ?app= ?kind= ?mine=1 ?installed=1 (mine/installed are per calling uid) |
| POST | `/v1/adapters` | bearer | register an adapter {appId, id, name, ...manifest, code?, appName?} -> 201 {adapter}; code present makes kind "code" |
| POST | `/v1/adapters/sync` | bearer | publish an app catalog in one call {appId, appName?, adapters: [...], full?}; upserts the caller's entries, skips another uid's, full:true also removes the caller's missing ones |
| GET | `/v1/adapters/{appId}/{id}` | bearer | {adapter} for one listing |
| PUT | `/v1/adapters/{appId}/{id}` | bearer (registering uid) or admin | update the manifest; code present replaces/removes the code blob (empty string removes), absent leaves it |
| DELETE | `/v1/adapters/{appId}/{id}` | bearer (registering uid) or admin | remove the listing and its code blob |
| GET | `/v1/adapters/{appId}/{id}/code` | bearer | {code, sha256, size, updatedAt} for a kind "code" listing; 404 for data-only |
| PUT | `/v1/adapters/{appId}/{id}/install` | bearer | mark installed in the calling uid's state -> {ok, installed:true} |
| DELETE | `/v1/adapters/{appId}/{id}/install` | bearer | clear it -> {ok, installed:false} |
| GET | `/sdk/adapter-mcp.js` | none (public code, any origin) | the Adapter MCP SDK entry point for apps; its modules are under /sdk/toolkit/ |
| POST | `/v1/auth/login` | none (rate limited) | developer sign-in {username, password} -> {token (session, expires), expiresAt, account, defaultToken} |
| POST | `/v1/auth/logout` | session | end this sign-in session |
| GET | `/v1/account` | session | {account, defaultToken, tokens, session, liveApps} for the signed-in account |
| PUT | `/v1/account` | session | rename the signed-in account {displayName} -> {account}; the username stays the same |
| POST | `/v1/account/default-token` | session | regenerate the default token -> {defaultToken}; the old one is revoked and its apps disconnect |
| POST | `/v1/account/tokens` | session | make an app token {label?} -> {token, id, label} (shown once) |
| DELETE | `/v1/account/tokens/{id}` | session | revoke one of the account's tokens |
| POST | `/v1/account/password` | session | change password {current, next}; signs out other sessions |
| GET | `/v1/account/presets` | session | {presets} saved profile presets for the developer console |
| PUT | `/v1/account/presets` | session | replace the saved presets {presets: [{id, name, description?, profile}]} |
| POST | `/v1/mcp` | bearer | the adapter registry, an MCP server (POST JSON-RPC): tools adapter_search, adapter_get, adapter_publish, adapter_share, adapter_delete, adapter_install, adapter_uninstall, adapter_installed, adapter_report, adapter_status; resources adapter://owner/appId/id |
| GET | `/v1/mcp` | bearer | server-sent events (Accept: text/event-stream): notifications/resources/list_changed when an adapter the account can see changes, its installs change, or a runtime reports |
| POST | `/v1/providers` | bearer (app or default token) | register an Adapter MCP app instance {providerId?, label?, application, adapters: [descriptor]} -> {providerId, endpoints} |
| DELETE | `/v1/providers/{providerId}` | bearer (the registering token) | sign the instance off |
| GET | `/v1/providers/{providerId}/channel` | bearer (the registering token) | server-sent events: each `request` event is one relayed MCP JSON-RPC message |
| POST | `/v1/providers/{providerId}/channel` | bearer (the registering token) | the instance answers one relayed request with its JSON-RPC response -> 204 |
| POST | `/v1/mcp/providers/{providerId}` | bearer (same account) | MCP Streamable HTTP endpoint (POST JSON-RPC, JSON response) for one connected instance |
| POST | `/v1/mcp/apps/{appId}` | bearer (same account) | MCP endpoint for the app's one live instance; an error names the instance endpoints when several are connected |
| GET | `/v1/profile/selection` | bearer | the preset last loaded with replaceProfile: {revision, selected: {id, name, edited} or null, updatedAt} |
| GET | `/v1/profile/events` | bearer | server-sent events: a `profile` event (the same object as /v1/profile/selection) on connecting and on every profile write, with no profile content; read that with getProfile |
| GET | `/v1/profile/presets` | bearer | the presets an app can choose from, the console's built-in ones then the account's saved ones: {presets: [{id, name, description, builtIn}]} |
| POST | `/v1/profile/select` | bearer | make a preset the active profile, as the console does when it loads one {id} -> {revision, selected, updatedAt, profile} |
| GET | `/v1/apps` | bearer | the account's connected apps grouped by app: {apps: [{appId, name, live, hidden, connections, adapters, endpoint}], hiddenApps} |
| DELETE | `/v1/apps/{appId}` | bearer | forget an app that is not connected (it returns when it connects again) |
| PUT | `/v1/apps/{appId}/hidden` | bearer | hide the app in the developer console (Apps and Listings) |
| DELETE | `/v1/apps/{appId}/hidden` | bearer | show it again |
| GET | `/admin/accounts` | admin | list accounts {accounts: [{uid, displayName, disabled, createdAt, lastLoginAt, passwordSetBy, passwordKept, appTokens, sessions, liveApps, hasData}]}; with ?passwords=1, every account's admin-issued password {passwords: [{uid, displayName, password\|null, reason?}]} (reason: changed-by-account, not-kept or unreadable); with ?format=csv, a download of every account with its password, status and last sign-in |
| POST | `/admin/accounts` | admin | make an account {uid, displayName?, password?} -> 201 {account, password?} (a generated password is returned; GET …/password shows it again) |
| POST | `/admin/accounts/bulk` | admin | make many {accounts: [{uid, displayName?}]} -> {results: [{uid, ok, password?\|error}]} |
| PUT | `/admin/accounts/{uid}` | admin | rename {displayName} |
| GET | `/admin/accounts/{uid}/password` | admin | the password an admin issued {uid, password\|null, reason?}; null once the developer changed it themselves |
| POST | `/admin/accounts/{uid}/password` | admin | reset the password {password?} -> {password?}; signs the account out everywhere |
| POST | `/admin/accounts/{uid}/disable` | admin | turn the account off: revokes every token and disconnects its apps |
| POST | `/admin/accounts/{uid}/enable` | admin | turn it back on (a new default token at the next sign-in) |
| DELETE | `/admin/accounts/{uid}` | admin | delete the account, its data and its tokens |
| GET | `/admin/assets/console.js` | none (public code) | the admin console's script |
| POST | `/admin/tokens` | admin | create token {uid, label?, kind?: "app"\|"default"} -> {token, uid} (token shown once) |
| GET | `/admin/tokens` | admin | list {id, uid, label, kind, createdAt, expiresAt?, revoked} (no token values) |
| DELETE | `/admin/tokens/{id}` | admin | revoke |
| GET | `/admin/users` | admin | list {users: uid[]}, every uid holding stored state |
| DELETE | `/admin/users/{uid}` | admin | delete that uid's partition and revoke its tokens -> {ok, uid, revokedTokens} (a count); 404 when the uid had neither data nor live tokens |
| GET | `/admin` | admin (HTTP Basic. An unauthenticated GET answers 401 + WWW-Authenticate, so the browser prompts, then attaches the cached credential to the page's own fetches; browser POSTs must be same-origin JSON) | admin console: accounts, tokens, stored data |

## `/v1/librarian/{method}`

{"args": [...]} — positional arguments exactly as the in-process method takes them. Missing body = {"args": []}.

- Success: `200 {"ok":true, "result": <return value>}`
- Application error: `200 {"ok":false, "error": "<message>"} (application errors are data, not transport failures)`
- Unknown method: `404 {"error":"unknown-method"}`

### Methods (49, 0 unsupported)

`{method}` is the route (`{"method"}` segment in the POST path). `target` is the underlying
Librarian (or, for `shareAudit`, datastore) call it resolves to; `alias` marks the 7 routes
whose wire name differs from the call it makes.

| Route | Target | Alias? | Arity | Kind |
|---|---|---|---|---|
| `getProfile` | `getProfile` |  | 0 | librarian |
| `replaceProfile` | `replaceProfile` |  | 1 | librarian |
| `getAbilityModel` | `getAbilityModel` |  | 0 | librarian |
| `listProcedural` | `listProcedural` |  | 0 | librarian |
| `setProfileField` | `setProfileField` |  | 2 | librarian |
| `setProfileFields` | `setProfileFields` |  | 1 | librarian |
| `recordScopedSettings` | `recordScopedSettings` |  | 0 | librarian |
| `getSiteCategory` | `getSiteCategory` |  | 1 | librarian |
| `setSiteCategory` | `setSiteCategoryOverride` | yes | 2 | librarian |
| `effectivePreferences` | `getEffectivePreferences` | yes | 1 | librarian |
| `recall` | `recall` |  | 1 | librarian |
| `listMemories` | `listMemories` |  | 0 | librarian |
| `listProposals` | `listProposals` |  | 0 | librarian |
| `logObservation` | `logObservation` |  | 1 | librarian |
| `respondToProposal` | `respondToProposal` |  | 0 | librarian |
| `deleteMemory` | `deleteMemory` |  | 1 | librarian |
| `setPause` | `setMemoryPaused | setOriginPaused (by arg shape)` | yes | — | custom-librarian |
| `extractNow` | `extract` | yes | 0 | librarian |
| `reflectNow` | `reflect` | yes | 0 | librarian |
| `listGrants` | `listGrants` |  | 0 | librarian |
| `revokeGrant` | `revokeGrant` |  | 1 | librarian |
| `setSharingPaused` | `setSharingPaused` |  | 1 | librarian |
| `requestGrant` | `requestGrant` |  | 0 | librarian |
| `importInsight` | `importInsight` |  | 0 | librarian |
| `exportAbilityModel` | `exportAbilityModel` |  | 1 | librarian |
| `shareAudit` | `shareAudit` |  | 0 | datastore |
| `getActingUser` | `getActingUser` |  | 0 | librarian |
| `setActingUser` | `setActingUser` |  | 1 | librarian |
| `exportProfileBlob` | `exportProfileBlob` |  | 0 | librarian |
| `importProfileBlob` | `importProfileBlob` |  | 1 | librarian |
| `importInsightOutbox` | `importInsightOutbox` |  | 1 | librarian |
| `listSkills` | `listSkills` |  | 0 | librarian |
| `retrieveSkill` | `retrieveSkill` |  | 1 | librarian |
| `findSkill` | `findSkillForNeed` | yes | 1 | librarian |
| `buildSkill` | `buildSkill` |  | 1 | librarian |
| `resolveSkill` | `resolveSkill` |  | 1 | librarian |
| `saveSkill` | `saveSkill` |  | 1 | librarian |
| `deleteSkill` | `deleteSkill` |  | 1 | librarian |
| `interpretNeedsPrompt` | `interpretNeedsPrompt` |  | 1 | librarian |
| `hasScopedSetting` | `hasScopedSetting` |  | 2 | librarian |
| `getScopedSetting` | `getScopedSetting` |  | 2 | librarian |
| `removeScopedSetting` | `removeScopedSetting` |  | 2 | librarian |
| `recordExplicitSetting` | `recordExplicitSetting` |  | 3 | librarian |
| `resetToProfile` | `resetToProfile` |  | 0 | librarian |
| `addNote` | `addNote` |  | 1 | librarian |
| `listNotes` | `listNotes` |  | 0 | librarian |
| `updateNote` | `updateNote` |  | 1 | librarian |
| `deleteNote` | `deleteNote` |  | 1 | librarian |
| `findNotes` | `findNotes` |  | 1 | librarian |

## Server-side LLM

Provider: **gemini** (`gemini-3.5-flash`). Wired via librarian.setGeminiCaller(serverGeminiCaller) at boot (server/src/gemini.js).

Free without a client-supplied key: `extract`, `reflect`, `buildSkill`, `interpretNeedsPrompt`.

Server holds GEMINI_API_KEY. Without it, the caller throws 'no-server-key' the moment the slow lane tries to use it — the fast lane (everything else) is unaffected. Applications making their own direct LLM calls keep using their own keys; nothing here proxies arbitrary LLM traffic.

## Storage

- KV: areas local/sync per uid -> users/<uid>/<area>.json
- Tokens: admin/tokens.json (hashes only; kinds app, default, session)
- Accounts: admin/accounts.json (scrypt password hashes)
- Apps: users/<uid>/apps.json (last-known app registrations), users/<uid>/console.json (hidden apps, presets) and users/<uid>/activity.json (the last 200 MCP calls)
- Backends: file (DATA_DIR), gcs (TOOLKIT_BUCKET)
