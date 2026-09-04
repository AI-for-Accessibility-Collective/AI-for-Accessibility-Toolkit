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
| GET | `/v1/meta` | generated service+API description (no auth) |
| POST | `/v1/librarian/{method}` | invoke a Librarian method for the token's uid |
| GET | `/v1/whoami` | `{uid, label}` for the presented token |
| POST | `/admin/tokens` | create token `{uid, label?}` → `{token, uid}` (token shown once) |
| GET | `/admin/tokens` | list `{uid, label, createdAt, revoked}` (no token values) |
| DELETE | `/admin/tokens/{id}` | revoke |
| GET | `/admin` | config interface (token management) — browser login popup |

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
- 48 routes total.

## Health path caveat

`GET /healthz` works locally but is intercepted at the `*.run.app` edge before
reaching the container; the canonical deployed liveness path is
`GET /v1/healthz` (same payload, no auth). Deployed probes must use the
/v1-prefixed form.

## Server-side LLM

The server holds `GEMINI_API_KEY` and calls
`librarian.setGeminiCaller(serverGeminiCaller)` at boot. Clients therefore get
`extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt` without any key.
Applications making their own direct LLM calls keep using their own keys —
nothing here proxies arbitrary LLM traffic (`/v1/librarian/*` only).

## Storage

KVStore port per uid: areas `local`/`sync` → backend documents
`users/<uid>/<area>.json`. Backends: `file` (dev, under `--data-dir`) and
`gcs` (prod, bucket from `TOOLKIT_BUCKET`). Same interface as
`toolkit/ports/index.js` KVStore.

## Tokens

- Format: `aat_` + 32 bytes base64url randomness. Stored **hashed** (sha256).
- Record: `{id, uid, label, hash, createdAt, revoked}` in the storage backend
  under `admin/tokens.json`.
- A uid may hold multiple tokens; revocation is per-token.
- Every change to `admin/tokens.json` is a conditional write: the file
  backend checks a content hash under a lock file, the GCS backend passes the
  object generation as `ifGenerationMatch`. A change that loses the race is
  reloaded and retried, so two service instances sharing one bucket cannot
  overwrite each other's revocations.

## Extension remote mode

- Config lives in `chrome.storage.sync` keys `toolkitServerUrl`,
  `toolkitServerToken` (set via the extension's options UI).
- When both are set, background.js routes every `librarian*` message through
  `RemoteLibrarian` (fetch to `/v1/librarian/{method}`) instead of the local
  `globalThis.Librarian`. Empty/unset config = local mode (unchanged behavior).
- `respondToProposal`, `requestGrant` etc. keep identical response shapes so
  popup/onboarding/voice code is unchanged either way.
