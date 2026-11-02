// What the sidebar shows of the agent's work: its replies without code, and
// one plain-language line per step. Never code, file contents, commands or
// tool output: the person sees what is happening, not how.

const FENCE = /```[\s\S]*?(?:```|$)/g;
const LONG_INLINE = /`[^`\n]{60,}`/g;

/** A reply as the sidebar shows it: code blocks and long inline code left out. */
export function withoutCode(text) {
  return String(text || '')
    .replace(FENCE, '')
    .replace(LONG_INLINE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const READS = new Set(['read', 'list', 'glob', 'grep', 'ls', 'view']);
const WRITES = new Set(['write', 'edit', 'multiedit', 'patch', 'apply_patch']);

function pathOf(input) {
  return String(input?.filePath || input?.path || input?.pattern || input?.file || '');
}

/** The plain line for one tool step, or null for steps the host reports itself (the browser tools). */
export function stepLabel(tool, input = {}) {
  const name = String(tool || '').toLowerCase();
  if (READS.has(name)) return pathOf(input).includes('/toolkit') ? 'Reading the toolkit’s guides and code' : 'Looking over its work';
  if (WRITES.has(name)) return /adapters?\//.test(pathOf(input)) || /\.m?js$/.test(pathOf(input)) ? 'Writing the adapter' : 'Writing notes';
  if (name === 'skill') return 'Opening the toolkit skill';
  if (name === 'bash' || name === 'shell') return 'Running a check';
  if (name === 'todowrite' || name === 'todoread') return 'Planning the next steps';
  if (name === 'webfetch' || name === 'websearch') return 'Looking something up';
  if (name === 'task') return 'Handing part of the work to a helper';
  // Browser tools, directly or through opencode's code mode: the host
  // announces those itself when the call reaches it.
  if (name.startsWith('browser') || name === 'adapter_ready' || name === 'execute') return null;
  return 'Working';
}

/**
 * Turn one line of `opencode run --format json` into what the sidebar shows.
 * @returns {{sessionId?: string, entry?: object}}
 */
export function translate(event) {
  const out = {};
  if (event?.sessionID) out.sessionId = event.sessionID;
  const part = event?.part || {};
  if (event?.type === 'text' && part.type === 'text') {
    const text = withoutCode(part.text);
    if (text) out.entry = { id: part.id, kind: 'agent', text };
  } else if (event?.type === 'tool_use' && part.tool) {
    const label = stepLabel(part.tool, part.state?.input);
    if (label) {
      const failed = part.state?.status === 'error';
      out.entry = { id: part.id || part.callID, kind: 'step', text: failed ? `${label}: that did not work, trying another way` : label, state: failed ? 'failed' : 'done' };
    }
  } else if (event?.type === 'error') {
    const message = event.error?.data?.message || event.error?.message || event.error?.name || 'unknown problem';
    out.entry = { kind: 'error', text: `The assistant hit a problem: ${withoutCode(String(message)).slice(0, 300)}` };
  }
  return out;
}
