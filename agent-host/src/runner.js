// Runs opencode for one account: in that account's own always-running
// sandbox on the VM (docker with gVisor), or as a plain process for local
// development and tests (no isolation; never for real accounts).
//
// Each message is one `opencode run --format json`, continuing the chat's
// opencode session. Its JSON lines come back as an async iterable.

import { spawn, execFile } from 'node:child_process';
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import readline from 'node:readline';

const exec = promisify(execFile);
export const MODEL = 'google/gemini-3.8-flash';

/** The sandbox's opencode settings: model through the host's proxy, the browser tools, the skill. */
export function opencodeConfig({ token, hostUrl, instructions, skills }) {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: MODEL,
    // The real key never enters the sandbox: the proxy adds it.
    provider: { google: { options: { baseURL: `${hostUrl}/model/v1beta`, apiKey: token } } },
    mcp: { browser: { type: 'remote', url: `${hostUrl}/mcp`, headers: { authorization: `Bearer ${token}` }, oauth: false, codemode: false } },
    // The person answers in the sidebar's chat, not in opencode's question form.
    permissions: [{ action: 'question', resource: '*', effect: 'deny' }],
    instructions: [instructions],
    skills: [skills],
  };
}

function argsFor({ sessionId, text, title }) {
  // A message that starts with "-" would read as a flag.
  const message = /^-/.test(text) ? ` ${text}` : text;
  return ['run', '--standalone', '--auto', '--format', 'json',
    ...(sessionId ? ['--session', sessionId] : []), ...(title ? ['--title', title] : []), message];
}

async function* lines(child) {
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* opencode's own non-JSON output */ }
  }
}

function running(child) {
  const done = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  return { events: lines(child), done, stop: () => child.kill('SIGTERM'), stderr: () => stderr };
}

/**
 * Sandboxes on the VM: one container per account, gVisor (runsc), no
 * capabilities, read-only root, its own limits, on a network that reaches
 * only the host's sandbox port.
 */
export function dockerRunner({ accounts, image, network, hostUrl, runtime = 'runsc', cpus = '2', memory = '3g', pids = '512', log }) {
  const name = (uid) => `ai4a11y-sbx-${uid.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`;
  const ready = new Map();

  async function ensure(uid) {
    if (ready.get(uid)) return ready.get(uid);
    const job = (async () => {
      const { dir, token } = accounts.ensure(uid);
      writeFileSync(path.join(dir, 'config', 'opencode.json'), JSON.stringify(opencodeConfig({
        token, hostUrl, instructions: '/opt/agent/AGENTS.md', skills: '/toolkit/.claude/skills',
      }), null, 2));
      const state = await exec('docker', ['inspect', '-f', '{{.State.Running}} {{.Config.Image}}', name(uid)]).then(r => r.stdout.trim(), () => '');
      if (state === `true ${image}`) return;
      if (state) await exec('docker', ['rm', '-f', name(uid)]);
      await exec('docker', ['run', '-d', '--name', name(uid), `--runtime=${runtime}`, '--network', network,
        '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', `--cpus=${cpus}`, `--memory=${memory}`, `--pids-limit=${pids}`,
        '--restart', 'unless-stopped', '--label', 'ai4a11y.sandbox=1', '--label', `ai4a11y.uid=${uid}`,
        '-v', `${path.join(dir, 'home')}:/home/agent`, '-v', `${path.join(dir, 'work')}:/work`,
        '-v', `${path.join(dir, 'config')}:/etc/agent:ro`,
        '-e', 'HOME=/home/agent', '-e', 'OPENCODE_CONFIG=/etc/agent/opencode.json', '-w', '/work', image]);
      log?.info('sandbox.started', { uid });
    })();
    ready.set(uid, job);
    job.catch(() => ready.delete(uid));
    return job;
  }

  async function run(uid, opts) {
    await ensure(uid);
    const child = spawn('docker', ['exec', '-i', '-w', '/work', name(uid), 'opencode', ...argsFor(opts)], { stdio: ['ignore', 'pipe', 'pipe'] });
    return running(child);
  }

  return { ensure, run, workDir: (uid) => path.join(accounts.dirOf(uid), 'work') };
}

/** For development and tests: opencode as a plain process, one home per account. Not a sandbox. */
export function localRunner({ accounts, hostUrl, bin = 'opencode', repoDir, modelsJson }) {
  async function ensure(uid) {
    const { dir, token } = accounts.ensure(uid);
    writeFileSync(path.join(dir, 'config', 'opencode.json'), JSON.stringify(opencodeConfig({
      token, hostUrl, instructions: path.join(repoDir, 'agent-host/sandbox/AGENTS.md'), skills: path.join(repoDir, '.claude/skills'),
    }), null, 2));
    // opencode waits forever without its model catalog; the sandbox cannot download it.
    const cache = path.join(dir, 'home', '.cache', 'opencode');
    if (modelsJson && existsSync(modelsJson) && !existsSync(path.join(cache, 'models.json'))) {
      mkdirSync(cache, { recursive: true });
      copyFileSync(modelsJson, path.join(cache, 'models.json'));
    }
  }

  async function run(uid, opts) {
    await ensure(uid);
    const dir = accounts.dirOf(uid), home = path.join(dir, 'home');
    const { GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, WS_GEMINI_KEY, AGENT_HOST_SECRET, ...env } = process.env;
    const child = spawn(bin, argsFor(opts), {
      cwd: path.join(dir, 'work'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
        XDG_CACHE_HOME: path.join(home, '.cache'), XDG_STATE_HOME: path.join(home, '.local/state'),
        OPENCODE_CONFIG: path.join(dir, 'config', 'opencode.json') },
    });
    return running(child);
  }

  return { ensure, run, workDir: (uid) => path.join(accounts.dirOf(uid), 'work') };
}
