// llm-lane.js — the OPTIONAL natural-language lane. The router runs the
// deterministic grammar first; this lane runs ONLY on a grammar miss, turning
// free-form phrasing ("everything is way too small to read") into an Intent.
//
// It is built from a plain text-completion function the HOST supplies —
// `complete(prompt) -> string` — the same `geminiCaller`-style contract the
// server/onboarding use. No SDK, no key handling here; the host owns the model.
//
// Safety posture:
//   • The lane only ever sees the user's OWN utterance + the receiver's declared
//     capabilities — never page/content text. (Content is untrusted; keeping it
//     out of the prompt removes the injection surface.)
//   • The model's JSON is validated and filtered to real settingsMeta keys and
//     the receiver's supported keys/actions before it becomes an Intent; the
//     router then clamps/filters again on dispatch. The model cannot invent a
//     setting, exceed a range, or trigger an unsupported action.

import { settingsMeta } from '../registry/tools.js';
import { adapt, undo, query, command } from './intent.js';

function vocabularyLines(caps) {
  return (caps.settingKeys || []).map((k) => {
    const m = settingsMeta[k];
    if (!m) return null;
    const kind = m.type === 'enum'
      ? `one of ${m.options.map((o) => `"${o}"`).join(', ')}`
      : m.range ? `number ${m.range[0]}-${m.range[1]}` : m.type;
    return `- ${k} (${kind}): ${m.description}`;
  }).filter(Boolean).join('\n');
}

/** Build the instruction prompt. Offers ONLY what this receiver supports. */
export function buildPrompt(utterance, caps) {
  const actions = (caps.actions || []).length ? caps.actions.join(', ') : '(none)';
  return `You translate one accessibility request into ONE JSON action. Respond with ONLY a JSON object — no prose.

Settings you may change (use these EXACT keys):
${vocabularyLines(caps) || '(none)'}

App actions available: ${actions}

JSON shape:
{"type":"adapt"|"undo"|"query"|"command"|"none","changes":{},"deltas":{},"ask":"context"|"content"|"help","mode":"outline"|"text","action":"","target":"","say":"short spoken confirmation"}

Rules:
- "adapt" changes settings. Use "deltas" for relative requests like bigger/smaller/more/less (e.g. {"fontScale":20} or {"fontScale":-20}); use "changes" for explicit values, booleans, or enums.
- "query" with ask "content" reads the screen aloud, "context" reports current settings, "help" lists commands. Use "mode":"text" to read full text.
- "undo" reverts the last change.
- "command" only with an action from the list above.
- If nothing available fits, return {"type":"none"}.
- Only use setting keys from the list above. "say" is a short phrase like "Making text bigger".

Request: "${String(utterance).replace(/"/g, "'")}"
JSON:`;
}

// Pull the first balanced-looking JSON object out of a model response.
function extractJson(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// Validate the model object into a known Intent, dropping anything unsupported.
function toIntent(obj, utterance, caps) {
  if (!obj || typeof obj !== 'object') return null;
  const type = String(obj.type || '').toLowerCase();
  const supported = new Set(caps.settingKeys || []);

  if (type === 'undo') return undo(utterance, obj.say || 'Undoing that');

  if (type === 'adapt') {
    const changes = {};
    const deltas = {};
    for (const [k, v] of Object.entries(obj.changes || {})) {
      if (supported.has(k) && settingsMeta[k]) changes[k] = v;
    }
    for (const [k, v] of Object.entries(obj.deltas || {})) {
      if (supported.has(k) && settingsMeta[k] && Number.isFinite(Number(v))) deltas[k] = Number(v);
    }
    if (!Object.keys(changes).length && !Object.keys(deltas).length) return null;
    return adapt(utterance, { changes, deltas, say: obj.say });
  }

  if (type === 'query') {
    const ask = ['context', 'content', 'help'].includes(obj.ask) ? obj.ask : 'context';
    const mode = obj.mode === 'text' ? 'text' : 'outline';
    return query(utterance, { ask, mode, say: obj.say });
  }

  if (type === 'command') {
    if (!(caps.actions || []).includes(obj.action)) return null;
    return command(utterance, { action: obj.action, target: obj.target, text: obj.text, say: obj.say });
  }

  return null; // 'none' or anything unknown
}

/**
 * Build an LLM lane the router can use.
 * @param {Object} opts
 * @param {(prompt:string)=>Promise<string>} opts.complete  Host text-completion fn.
 * @returns {{ resolve:(utterance:string, capabilities:object)=>Promise<import('./intent.js').Intent|null> }}
 */
export function createLlmLane({ complete }) {
  if (typeof complete !== 'function') throw new Error('createLlmLane: complete(prompt) function is required');
  return {
    async resolve(utterance, capabilities) {
      const raw = await complete(buildPrompt(utterance, capabilities || {}));
      return toIntent(extractJson(raw), utterance, capabilities || {});
    },
  };
}

export default createLlmLane;
