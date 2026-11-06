/** CaptionFlow runtime configuration. No third-party dotenv dependency required.
 * We load captionflow/.env only when starting an app/CLI, never while importing a library.
 * Existing OS environment variables take precedence over values in the file.
 */
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const captionflowDirectory = fileURLToPath(new URL('../', import.meta.url));
export const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));

export function loadCaptionFlowEnv({
  file = process.env.CAPTIONFLOW_ENV_FILE || join(captionflowDirectory, '.env'),
  exists = existsSync,
} = {}) {
  const absoluteFile = resolve(file);
  if (!exists(absoluteFile)) return { loaded: false, file: absoluteFile };
  loadEnvFile(absoluteFile);
  return { loaded: true, file: absoluteFile };
}

/** Choose interpreter without locking teammates into one virtualenv name/location.
 * 1) explicit CAPTIONFLOW_PYTHON (command or path, relative to repo root)
 * 2) activated VIRTUAL_ENV / CONDA_PREFIX (any name or location)
 * 3) conventional repo-local venv folders
 * 4) python3 / python on PATH (requires faster-whisper installed there)
 */
export function resolveCaptionFlowPython({
  env = process.env,
  exists = existsSync,
  platform = process.platform,
  projectDir = captionflowDirectory,
  repoDir = repositoryDirectory,
} = {}) {
  const explicit = env.CAPTIONFLOW_PYTHON?.trim();
  if (explicit) {
    // Bare command names ('python', 'python3', 'py') are resolved by PATH.
    const isPath = isAbsolute(explicit) || explicit.includes('/') || explicit.includes('\\') || explicit.startsWith('.');
    return isPath ? resolve(repoDir, explicit) : explicit;
  }
  const pythonName = platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python');
  for (const prefix of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) {
    if (prefix) {
      const candidate = join(prefix, pythonName);
      if (exists(candidate)) return candidate;
    }
  }
  for (const root of [projectDir, repoDir]) {
    for (const folder of ['.venv', 'venv', 'env']) {
      const candidate = join(root, folder, pythonName);
      if (exists(candidate)) return candidate;
    }
  }
  return platform === 'win32' ? 'python' : 'python3';
}