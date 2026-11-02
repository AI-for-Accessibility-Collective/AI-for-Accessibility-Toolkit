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
//   AGENT_OPENCODE_BIN    opencode for the local runner (default opencode)

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
  opencodeBin: env.AGENT_OPENCODE_BIN || 'opencode',
  repoDir,
  modelsJson: env.AGENT_MODELS_JSON || path.join(os.homedir(), '.cache/opencode/models.json'),
  log,
});

await listen(host.sandboxHandler, sandboxListen);
await listen(host.apiHandler, apiListen);
log.info('host.started', { sandbox: sandboxListen, api: apiListen, runner: env.AGENT_RUNNER || 'docker' });
host.warm();
