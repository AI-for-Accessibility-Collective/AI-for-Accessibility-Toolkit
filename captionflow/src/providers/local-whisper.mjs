import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateTranscript } from '../contracts.mjs';
import { resolveCaptionFlowPython } from '../runtime-config.mjs';

const execFile = promisify(nodeExecFile);
const pythonScript = fileURLToPath(new URL('../../local_transcriber/transcribe_whisper.py', import.meta.url));

/** An adapter to the already installed local faster-whisper model.
 * Uses argv (not a shell), and JSON stdout as the only machine interface.
 */
export function createLocalWhisperTranscriber({
  python = resolveCaptionFlowPython(),
  model = process.env.CAPTIONFLOW_WHISPER_MODEL || 'base',
  timeoutMs = 12 * 60_000,
  runner = execFile,
} = {}) {
  return {
    async transcribe({ videoId, media }) {
      if (media?.kind !== 'local-file' || typeof media.path !== 'string') {
        throw new Error('Local Whisper requires media.kind="local-file" and a server-side media path');
      }
      const language = media.language || 'auto';
      if (!['en', 'sw', 'auto'].includes(language)) throw new Error('Unsupported speech language');
      let stdout;
      try {
        ({ stdout } = await runner(python, [pythonScript, media.path, videoId, language, model], {
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        }));
      } catch (error) {
        const detail = (error.stderr || error.message || String(error)).trim().slice(0, 450);
        const help = error.code === 'ENOENT' || /No module named ['\"]faster_whisper|ModuleNotFoundError/.test(detail)
          ? ' Activate the virtual environment containing faster-whisper, or set CAPTIONFLOW_PYTHON in captionflow/.env to its Python interpreter.' : '';
        throw new Error(`Local Whisper failed (${python}): ${detail}.${help}`);
      }
      let transcript;
      try { transcript = JSON.parse(stdout); }
      catch { throw new Error('Local Whisper did not return valid transcript JSON'); }
      return validateTranscript(transcript);
    },
  };
}