# Toolkit Service — deployment guide (Cloud Run)

> Generic runbook with placeholders — fill in your own project/bucket/URL.
> The API reference is **generated**: see [API.md](./API.md) (`npm run docs`)
> and `GET /v1/meta` on a live instance; the wire contract is
> [CONTRACT.md](./CONTRACT.md). Team-internal notes for our shared instance
> (real URL, token etiquette) are intentionally **not in this repo** — see
> [MAINTAINERS.md](../MAINTAINERS.md) for the current contact route.

> **Continuity note.** Any shared research instance is operated for the
> duration of the research phase only and may be retired without this
> repository changing. This runbook exists so that anyone can stand up
> their own instance; treat self-hosting as the durable path. Long-term
> operation of a shared instance (owner, budget, data retention) is to be
> defined — see [MAINTAINERS.md](../MAINTAINERS.md).

## One-time setup

```bash
PROJECT=<your-gcp-project>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com --project $PROJECT
gcloud artifacts repositories create toolkit --repository-format=docker --location=<region>

# secrets: a Gemini API key + a generated 16-char admin password
printf '%s' "<gemini-key>"   | gcloud secrets create toolkit-gemini-key      --data-file=-
printf '%s' "<16-char-pass>" | gcloud secrets create toolkit-admin-password  --data-file=-

# per-uid storage bucket
gcloud storage buckets create gs://<your-bucket> --location=<region> --uniform-bucket-level-access

# let the Cloud Run runtime SA read the secrets + bucket
PN=$(gcloud projects describe $PROJECT --format="value(projectNumber)")
SA="${PN}-compute@developer.gserviceaccount.com"
for s in toolkit-gemini-key toolkit-admin-password; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
gcloud storage buckets add-iam-policy-binding gs://<your-bucket> --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
```

## Build & deploy

```bash
# image (context = repo root; Dockerfile copies toolkit/ + server/)
gcloud builds submit --config cloudbuild.yaml --substitutions SHORT_SHA=$(git rev-parse --short HEAD) .

# small instance, scale-to-zero, ONE instance at most (see below)
gcloud run deploy toolkit-service \
  --image <region>-docker.pkg.dev/$PROJECT/toolkit/toolkit-service:$(git rev-parse --short HEAD) \
  --region <region> --allow-unauthenticated \
  --memory 512Mi --cpu 1 --cpu-boost --min-instances 0 --max-instances 1 --concurrency 250 --timeout 3600 \
  --set-secrets "ADMIN_PASSWORD=toolkit-admin-password:latest,GEMINI_API_KEY=toolkit-gemini-key:latest" \
  --set-env-vars "TOOLKIT_BUCKET=<your-bucket>,CORS_ORIGINS=*"
```

Why these settings:

- `--max-instances 1`: apps connected through Adapter MCP are held in the
  process's memory (`src/relay.js`). With two instances, an app could connect
  to one while the console or an MCP client asks the other, which reports it
  offline. Everything else is in the bucket, so a restart loses nothing but
  the live connections, and apps reconnect by themselves.
- `--timeout 3600`: each connected app holds one long request open (its
  server-sent-event channel). The 300-second default cuts it every five
  minutes; the app reconnects, but the console flickers.
- `--concurrency 250`: every open app tab is one long request, and a
  workshop room has many.
- `CORS_ORIGINS=*`: lets the Redbird demo store and participants' own pages,
  on any address, call `/v1` with their token. `/v1` only accepts bearer
  tokens, never cookies, so this exposes nothing a page did not already
  hold. List exact origins instead when you know them.
- Optional: `TOKEN_SECRET` (a secret, like the others). Without it, each
  account's default token is derived from the admin password, so changing
  the admin password gives every account a new default token at its next
  sign-in, and their apps need the new one.

## Logs

The service writes structured JSON, one entry per request and one per event
(sign-ins, account and token changes, apps connecting, MCP calls, errors with
their stack); see [README.md](./README.md#logs). Cloud Logging keeps them 30
days by default. To keep them longer, route them to their own log bucket:

```bash
gcloud logging buckets create toolkit-service-logs --location=global --retention-days=365
gcloud logging sinks create toolkit-service-logs \
  logging.googleapis.com/projects/$PROJECT/locations/global/buckets/toolkit-service-logs \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="toolkit-service"'
# read them back:
gcloud logging read 'jsonPayload.event="auth.signin.failed"' \
  --bucket=toolkit-service-logs --location=global --view=_AllLogs --freshness=7d
```

Logs carry uids and client addresses but never passwords, tokens or profile
content. They are still records of who used the service and when: say so to
the people whose accounts are on it, and delete the log bucket at teardown.

Liveness: `GET /v1/healthz` (the bare `/healthz` is intercepted at the
`*.run.app` edge — see CONTRACT.md). The server holds the Gemini key, so
`extract` / `reflect` / `buildSkill` / `interpretNeedsPrompt` run server-side
and clients never need an LLM key.

## Access tokens (UID-bound)

Every `/v1/*` call needs `Authorization: Bearer <token>`; each token maps to a
`uid` that partitions all state; tokens are stored hashed.

- **Admin console**: `GET /admin` — the browser shows its native login
  popup (any username + the admin password) and remembers the session; the
  page makes developer accounts (one at a time or a whole workshop at once),
  resets passwords, turns accounts off, and lists / creates / revokes tokens.
  Developers then sign in at `/developer` and get their default token there.
- **CLI**:
  ```bash
  AT=$(gcloud secrets versions access latest --secret toolkit-admin-password)
  curl -s -X POST $BASE/admin/tokens -H "Authorization: Bearer $AT" \
       -H "content-type: application/json" -d '{"uid":"<uid>","label":"<label>"}'
  ```

## Pointing a host client at a server

A host that uses the toolkit in "remote mode" points its Librarian facade at
the Server URL with an access token; clearing them returns to fully-local mode.
When configured, all librarian wire routes — including the natural-language
note methods — go to the server instead of an embedded core. Remember what
this means for the people whose profiles it holds: whoever operates the
server can read them, and a host that ships remote mode owes its users that
disclosure.

## Verification

- `node server/test/server-test.mjs` — in-process, file store.
- A host's remote-facade integration test can run the real facade ↔ real app
  over HTTP (locally, and against a live deployment with throwaway uids and
  tokens revoked afterward).

## Cost / teardown

Small instance, scale-to-zero: idle cost ≈ storage + registry only. Teardown:
`gcloud run services delete toolkit-service --region <region>`, delete the two
secrets, the bucket, and the `toolkit-service-logs` sink and log bucket. If real people's profiles were on the instance,
teardown includes deleting the bucket's contents — a profile is
disability-related information, not just state.
