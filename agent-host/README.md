# Agent host

Runs the assistant behind the browser extension's sidebar
([extension/sidepanel/](../extension/sidepanel/)): one opencode agent per
toolkit account, each in its own sandbox, using Gemini 3.8 Flash. The agent
builds web adapters with the person, previews them on the page beside the
sidebar, reviews the result, and offers the finished adapter to add to the
person's account or export.

**Status:** an active research project, pre-alpha, a technology probe. The
adapters the agent writes are unvalidated, and the assistant is not a
replacement for assistive technology. In practice: what it builds can change
a page in ways nobody has checked with the people it is meant for, so the
person previews and checks each change before keeping it.

## How it fits together

```
sidebar (extension) ──HTTPS──▶ toolkit service /v1/agent/…   checks the person's token
                                     │  shared secret + account id, private network
                                     ▼
                               agent host, API port 8791      chats, events, answers
                                     │  docker exec, per message
                                     ▼
                               sandbox <account>              opencode run, /work, /toolkit (read-only)
                                     │  sandbox token
                                     ▼
                               agent host, sandbox port 8790  model proxy (adds the key) + browser tools (MCP)
```

- **The sidebar** talks only to the toolkit service, with the default token
  the extension already holds. The service forwards `/v1/agent/…` to the host
  ([server/src/agent-proxy.js](../server/src/agent-proxy.js)), signed with
  `AGENT_HOST_SECRET` and naming the account. App-bound tokens are refused.
- **Each account has its own sandbox**, always running: a container under
  gVisor (`runsc`), user 1000, no capabilities, `no-new-privileges`, a
  read-only root with a tmpfs `/tmp`, 2 CPUs, 3 GB and 512 processes at most.
  Its only writable folders are its home (opencode's sessions) and `/work`
  (its adapters). `/toolkit` is the toolkit's code, docs and the
  `ai4a11y-toolkit` skill, read-only in the image.
- **Its network reaches nothing but the host's sandbox port**: no internet,
  no metadata server, no other sandbox ([vm/setup.sh](vm/setup.sh)).
- **The model key never enters a sandbox.** opencode sends its own sandbox
  token as the API key; the host's proxy checks it, pins the model to
  `gemini-3.8-flash` (titles too), limits each account to 60 calls a minute,
  and adds the real key ([src/model-proxy.js](src/model-proxy.js)).
- **The browser tools** ([src/browser-tools.js](src/browser-tools.js)) are an
  MCP server the sandbox's opencode is configured with. A call goes to the
  account's sidebar and waits for the person (up to 15 minutes):
  `browser_page`, `browser_preview`, `browser_remove_preview`, `adapter_ready`.
  The agent's standing instructions, including how to load, preview and
  review an adapter, are [sandbox/AGENTS.md](sandbox/AGENTS.md).
- **What the person sees has no code**: replies with code left out, and one
  plain line per step ([src/updates.js](src/updates.js)).
- **Chats keep their history** on the host (`chats/`), each continuing its
  own opencode session. One chat runs at a time per account.

## What is kept, and where

| What | Where | Logged? |
|---|---|---|
| Chat messages and replies (as the person saw them) | host: `accounts/<uid>/chats/` | messages in the toolkit service's request log, as before |
| Page address, source outline, screenshots the person shared | host: `accounts/<uid>/page-data/<chat>/` | **no**: the service leaves `/v1/agent/requests/…` bodies out of its log; the host logs only sizes |
| Adapters the agent wrote | host: `accounts/<uid>/work/adapters/` | no |
| Model calls | sent to Gemini through the proxy | account, size and time only |

Page data stays on the VM's disk for the research team to deidentify after
the workshop. The sidebar tells people what they share is not used to
identify them.

## Run it locally (development only)

The local runner starts opencode as a plain process: **no sandbox**, so use
it only with your own account.

```bash
AGENT_HOST_SECRET=$(openssl rand -hex 24) AGENT_RUNNER=local \
  GEMINI_API_KEY=… node agent-host/index.js
# then the toolkit service with the same secret:
AGENT_HOST_URL=http://127.0.0.1:8791 AGENT_HOST_SECRET=… npm run dev:workshop
```

Tests: `node agent-host/test/host.test.mjs` (a stand-in for opencode),
`npm run test:assistant:e2e` (the real extension in Chromium, with the
stand-in), and `AGENT_E2E_REAL=1 npm run test:assistant:e2e` (real opencode
and Gemini on your computer, unsandboxed).

## Deploy (Google Cloud)

One VM (`c4-standard-32`, us-central1) with no external IP; the toolkit
service reaches it over the VPC.

```bash
P=agentic-a11y; R=us-central1; Z=us-central1-a; TAG=$(git rev-parse --short HEAD)
# Images
gcloud builds submit --project $P --region $R --config agent-host/cloudbuild.yaml \
  --ignore-file agent-host/.gcloudignore --substitutions SHORT_SHA=$TAG .
# Secrets (the shared secret, and the model key from your .env)
openssl rand -hex 32 | gcloud secrets create agent-host-secret --project $P --data-file=-
grep '^GEMINI_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | gcloud secrets create agent-gemini-key --project $P --data-file=-
# The VM's identity: pull images, read its two secrets
gcloud iam service-accounts create agent-host --project $P
SA=agent-host@$P.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role roles/artifactregistry.reader
for s in agent-host-secret agent-gemini-key; do gcloud secrets add-iam-policy-binding $s --project $P --member serviceAccount:$SA --role roles/secretmanager.secretAccessor; done
# Outbound internet for the VM (packages, Gemini) without an external IP
gcloud compute routers create agent-nat-router --project $P --region $R --network default
gcloud compute routers nats create agent-nat --project $P --region $R --router agent-nat-router --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
# Firewall: the API port from the toolkit service's VPC egress only; SSH through IAP
gcloud compute firewall-rules create agent-host-api --project $P --network default --target-tags agent-host --allow tcp:8791 --source-ranges 10.128.0.0/20
gcloud compute firewall-rules create agent-host-iap-ssh --project $P --network default --target-tags agent-host --allow tcp:22 --source-ranges 35.235.240.0/20
# The VM
gcloud compute instances create agent-host --project $P --zone $Z --machine-type c4-standard-32 \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-type hyperdisk-balanced --boot-disk-size 500GB \
  --no-address --tags agent-host --service-account $SA --scopes cloud-platform --shielded-secure-boot \
  --metadata-from-file startup-script=agent-host/vm/setup.sh \
  --metadata agent-host-image=$R-docker.pkg.dev/$P/toolkit/agent-host:$TAG,agent-sandbox-image=$R-docker.pkg.dev/$P/toolkit/agent-sandbox:$TAG
# The toolkit service: reach the VM over the VPC, and know the secret
IP=$(gcloud compute instances describe agent-host --project $P --zone $Z --format 'value(networkInterfaces[0].networkIP)')
gcloud run services update toolkit-service --project $P --region $R --network default --subnet default --vpc-egress private-ranges-only \
  --update-env-vars AGENT_HOST_URL=http://$IP:8791 --update-secrets AGENT_HOST_SECRET=agent-host-secret:latest
```

To update: build with a new tag, set the two metadata values to it
(`gcloud compute instances add-metadata`), and rerun the startup script
(`sudo google_metadata_script_runner startup` over IAP SSH). Each sandbox is
recreated on the new image the next time it is needed; its home and `/work`
stay. Keep the toolkit service at `--max-instances 1`.
