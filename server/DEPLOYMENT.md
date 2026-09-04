# Toolkit Service — deployment guide (Cloud Run)

> Generic runbook with placeholders — fill in your own project/bucket/URL.
> The API reference is **generated**: see [API.md](./API.md) (`npm run docs`)
> and `GET /v1/meta` on a live instance; the wire contract is
> [CONTRACT.md](./CONTRACT.md). Team-internal notes for our shared instance
> (real URL, token etiquette) are intentionally **not in this repo** — ask a
> maintainer.

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

# small instance, scale-to-zero
gcloud run deploy toolkit-service \
  --image <region>-docker.pkg.dev/$PROJECT/toolkit/toolkit-service:$(git rev-parse --short HEAD) \
  --region <region> --allow-unauthenticated \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 2 --concurrency 40 \
  --set-secrets "ADMIN_PASSWORD=toolkit-admin-password:latest,GEMINI_API_KEY=toolkit-gemini-key:latest" \
  --set-env-vars "TOOLKIT_BUCKET=<your-bucket>"
```

Liveness: `GET /v1/healthz` (the bare `/healthz` is intercepted at the
`*.run.app` edge — see CONTRACT.md). The server holds the Gemini key, so
`extract` / `reflect` / `buildSkill` / `interpretNeedsPrompt` run server-side
and clients never need an LLM key.

## Access tokens (UID-bound)

Every `/v1/*` call needs `Authorization: Bearer <token>`; each token maps to a
`uid` that partitions all state; tokens are stored hashed.

- **Config interface**: `GET /admin` — the browser shows its native login
  popup (any username + the admin password) and remembers the session; the
  page lists / creates / revokes tokens, and has a Sign out button.
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
note methods — go to the server instead of an embedded core.

## Verification

- `node server/test/server-test.mjs` — in-process, file store.
- A host's remote-facade integration test can run the real facade ↔ real app
  over HTTP (locally, and against a live deployment with throwaway uids and
  tokens revoked afterward).

## Cost / teardown

Small instance, scale-to-zero: idle cost ≈ storage + registry only. Teardown:
`gcloud run services delete toolkit-service --region <region>`, delete the two
secrets and the bucket.
