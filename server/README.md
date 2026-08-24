# Toolkit Service

HTTP wire service over the AI for Accessibility Toolkit core (`../toolkit/`).
The wire contract is fixed and hand-maintained in [`CONTRACT.md`](./CONTRACT.md)
— read that first. Endpoint documentation (`API.md`) is a GENERATED artifact;
see "Docs" below.

This directory owns everything under `server/` except `CONTRACT.md`. It
imports the toolkit only through `../toolkit/index.js` (the barrel) and
`../toolkit/platforms/node/*` — never a `toolkit/core/*` or `toolkit/sync/*`
file directly — as a live demonstration that the toolkit is decoupled from
any one host. Zero npm dependencies: plain `node:http`, `node:crypto`, ES
modules.

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
- `src/auth.js` — bearer-token issue/verify (`aat_` + sha256-hashed storage).
- `src/routes.js` — the 36 `/v1/librarian/{method}` routes, alias-mapped from a host's
  `librarian*` message switch. Single source of truth for both dispatch
  (`app.js`) and docs (`meta.js`).
- `src/meta.js` — builds `/v1/meta` and `API.md` from the live route table +
  a real (throwaway, in-memory) Librarian instance.
- `src/admin-page.js` — the `GET /admin` HTML shell.
- `index.js` — env parsing + boot.

## Run

```bash
cd server
npm test                        # in-process app tests, no network
npm run docs                     # regenerate API.md from the live route table
DATA_DIR=./data ADMIN_PASSWORD=dev PORT=8080 npm start
```

## Env

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | |
| `ADMIN_PASSWORD` | **yes** in `NODE_ENV=production` | insecure dev default otherwise (logged loudly) | Bearer token for `/admin/*` |
| `GEMINI_API_KEY` | no | unset | Without it, `extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt` throw `no-server-key` when actually invoked; every other route is unaffected |
| `TOOLKIT_BUCKET` | no | unset | Set -> GCS backend; unset -> file backend |
| `DATA_DIR` | no | `./data` | Only used when `TOOLKIT_BUCKET` is unset |

## Storage layout

`users/<uid>/local.json`, `users/<uid>/sync.json` (the KVStore's two areas,
per CONTRACT.md), `admin/tokens.json`. Under `fileStore`, these are literal
files under `DATA_DIR`; under `gcsStore`, object names in `TOOLKIT_BUCKET`.

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
