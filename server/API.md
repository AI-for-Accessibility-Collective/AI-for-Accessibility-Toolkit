# Toolkit Service API

_Generated 2026-08-30T15:24:38.428Z by `server/scripts/generate-docs.mjs` from the live route table (`server/src/routes.js`) and the Librarian method list (`toolkit/core/librarian.js`, introspected through the `toolkit/index.js` barrel). Do not hand-edit — re-run `npm run docs`._

Version: `0.1.0`

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | liveness: {ok:true, version} |
| GET | `/v1/meta` | none | generated service+API description |
| POST | `/v1/librarian/{method}` | bearer | invoke a Librarian method for the token's uid |
| GET | `/v1/whoami` | bearer | {uid, label} for the presented token |
| POST | `/admin/tokens` | admin | create token {uid, label?} -> {token, uid} (token shown once) |
| GET | `/admin/tokens` | admin | list {id, uid, label, createdAt, revoked} (no token values) |
| DELETE | `/admin/tokens/{id}` | admin | revoke |
| GET | `/admin` | none (page shell — data calls need the admin token typed into the page) | minimal HTML config interface |

## `/v1/librarian/{method}`

{"args": [...]} — positional arguments exactly as the in-process method takes them. Missing body = {"args": []}.

- Success: `200 {"ok":true, "result": <return value>}`
- Application error: `200 {"ok":false, "error": "<message>"} (application errors are data, not transport failures)`
- Unknown method: `404 {"error":"unknown-method"}`

### Methods (47, 0 unsupported)

`{method}` is the route (`{"method"}` segment in the POST path). `target` is the underlying
Librarian (or, for `shareAudit`, datastore) call it resolves to; `alias` marks the 7 routes
whose wire name differs from the call it makes.

| Route | Target | Alias? | Arity | Kind |
|---|---|---|---|---|
| `getProfile` | `getProfile` |  | 0 | librarian |
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
- Tokens: admin/tokens.json
- Backends: file (DATA_DIR), gcs (TOOLKIT_BUCKET)
