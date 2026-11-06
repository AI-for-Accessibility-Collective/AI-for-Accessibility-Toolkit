// Start the agent host. Settings come from the environment:
//
//   AGENT_HOST_SECRET     shared with the toolkit service (required)
//   AGENT_GEMINI_KEY      the model key (or GEMINI_API_KEY)
//   AGENT_DATA_DIR        accounts' folders (default ./data/agent-host)
//   AGENT_RUNNER          docker (the VM) or local (development only)
//   AGENT_SANDBOX_IMAGE   the sandbox image (docker)
//   AGENT_SANDBOX_NETWORK the sandboxes' docker network (default ai4a11y-sbx)
//   AGENT_SANDBOX_LISTEN  the sandbox port (default 127.0.0.1:8790; on the VM the network's gateway, 172.30.0.1:8790)
//   AGENT_API_LISTEN      the API port (default 127.0.0.1:8791; on the VM 0.0.0.0:8791, firewalled to the toolkit service)
//   AGENT_SANDBOX_DNS     resolvers for the sandboxes (default 8.8.8.8,1.1.1.1)
//   AGENT_OPENCODE_BIN    opencode for the local runner (default opencode)
//
// Checks of published adapters (src/checks.js):
//   AGENT_CHECK_IMAGE     the verify image's check target (docker; without it, the VM serves no checks)
//   AGENT_CHECK_NETWORK   the reviewers' docker network, which reaches only the model proxy (default ai4a11y-chk)
//   AGENT_CHECK_SITES     the recorded copies of real sites (default <data>/verify-sites; local: .verify-cache/sites)
//   AGENT_CHECK_MODEL_URL how a reviewer reaches the model proxy (default the sandbox URL + /model/v1beta)
//   AGENT_CHECK_MINUTES   a check's time limit (default 20); AGENT_REVIEW_MINUTES a review's (default 45)
//   AGENT_CHECK_CPUS      this host's CPUs for checks (default 72 of the VM's 96; a check takes 24)
//   AGENT_CHECK_PARALLEL  without AGENT_CHECK_CPUS, checks at once here (default 3)
//   AGENT_REVIEW_PARALLEL reviews at once (default 8)
//
// Checks beyond this host's CPUs, on Cloud Run (src/burst.js; without AGENT_BURST_JOB they wait):
//   AGENT_BURST_JOB       the Cloud Run job (vm/burst-setup.sh); AGENT_BURST_PROJECT, AGENT_BURST_REGION
//   AGENT_BURST_HOST_URL  how a job reaches this host's API port (http://<internal IP>:8791)
//   AGENT_BURST_MAX       executions at once (default 20); AGENT_BURST_CPUS each one's CPUs (default 8)

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHost, listen, createLogger } from './src/host.js';

const env = process.env;
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandboxListen = env.AGENT_SANDBOX_LISTEN || '127.0.0.1:8790';
const apiListen = env.AGENT_API_LISTEN || '127.0.0.1:8791';
const log = createLogger();

const host = createHost({
  dataDir: path.resolve(env.AGENT_DATA_DIR || path.join(repoDir, 'data/agent-host')),
  secret: env.AGENT_HOST_SECRET,
  apiKey: env.AGENT_GEMINI_KEY || env.GEMINI_API_KEY,
  sandboxUrl: env.AGENT_SANDBOX_URL || `http://${sandboxListen}`,
  runnerKind: env.AGENT_RUNNER || 'docker',
  image: env.AGENT_SANDBOX_IMAGE,
  network: env.AGENT_SANDBOX_NETWORK || 'ai4a11y-sbx',
  dns: env.AGENT_SANDBOX_DNS ? env.AGENT_SANDBOX_DNS.split(',').map(s => s.trim()).filter(Boolean) : undefined,
  opencodeBin: env.AGENT_OPENCODE_BIN || 'opencode',
  repoDir,
  modelsJson: env.AGENT_MODELS_JSON || path.join(os.homedir(), '.cache/opencode/models.json'),
  // Local runner only: more skill directories, comma-separated (the sandbox image has its own).
  skillDirs: (env.AGENT_SKILL_DIRS || '').split(',').map(s => s.trim()).filter(Boolean).map(d => path.resolve(d)),
  checkImage: env.AGENT_CHECK_IMAGE || undefined,
  checkNetwork: env.AGENT_CHECK_NETWORK || 'ai4a11y-chk',
  sitesDir: env.AGENT_CHECK_SITES ? path.resolve(env.AGENT_CHECK_SITES) : undefined,
  checkModelUrl: env.AGENT_CHECK_MODEL_URL || undefined,
  checkTimeoutMs: (Number(env.AGENT_CHECK_MINUTES) || 20) * 60_000,
  reviewTimeoutMs: (Number(env.AGENT_REVIEW_MINUTES) || 45) * 60_000,
  checkParallel: Number(env.AGENT_CHECK_PARALLEL) || 3,
  checkCpus: Number(env.AGENT_CHECK_CPUS) || undefined,
  reviewParallel: Number(env.AGENT_REVIEW_PARALLEL) || 8,
  burst: env.AGENT_BURST_JOB ? {
    project: env.AGENT_BURST_PROJECT, region: env.AGENT_BURST_REGION || 'us-central1', job: env.AGENT_BURST_JOB,
    hostUrl: env.AGENT_BURST_HOST_URL, max: Number(env.AGENT_BURST_MAX) || 20, cpus: Number(env.AGENT_BURST_CPUS) || 8,
  } : null,
  log,
});

await listen(host.sandboxHandler, sandboxListen);
await listen(host.apiHandler, apiListen);
log.info('host.started', { sandbox: sandboxListen, api: apiListen, runner: env.AGENT_RUNNER || 'docker' });
host.warm();
