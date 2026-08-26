// Intent — the normalized meaning of one utterance, independent of how it was
// produced (deterministic grammar or optional LLM lane) and of the receiver's
// platform. The router dispatches an Intent to ControlPort methods.
//
// Variants:
//   adapt   — change ability settings. `changes` are absolute values; `deltas`
//             are relative numeric nudges the router resolves against the
//             receiver's current context and clamps to the registry range.
//   undo    — revert the last adaptation.
//   query   — ask about state: 'context' (what's set / focused) or
//             'content' (read what's here), with a read `mode`.
//   command — one app action (Stage 2 / M4): performAction(action,target,text).
//   unrecognized — nothing matched; carries example `suggestions`.
//
// `say` is a short human phrase the UI can speak/show as the pre-action echo
// ("Making text bigger"); the dispatch result carries the post-action feedback.

/** @typedef {'adapt'|'undo'|'query'|'command'|'unrecognized'} IntentType */

/**
 * @typedef {Object} Intent
 * @property {IntentType} type
 * @property {string} utterance                  The original text.
 * @property {string} [say]                      Pre-action echo phrase.
 * @property {Object<string,*>} [changes]        adapt: absolute settings.
 * @property {Object<string,number>} [deltas]    adapt: relative numeric nudges (+/-).
 * @property {'context'|'content'} [ask]         query: what is being asked.
 * @property {'outline'|'text'} [mode]           query(content): read mode.
 * @property {string} [action]                   command: performAction id.
 * @property {string} [target]                   command: target hint.
 * @property {string} [text]                     command: text payload.
 * @property {string[]} [suggestions]            unrecognized: example phrases.
 */

/** @returns {Intent} */
export function adapt(utterance, { changes = {}, deltas = {}, say } = {}) {
  return { type: 'adapt', utterance, changes, deltas, say };
}

/** @returns {Intent} */
export function undo(utterance, say = 'Undoing that') {
  return { type: 'undo', utterance, say };
}

/** @returns {Intent} */
export function query(utterance, { ask = 'context', mode = 'outline', say } = {}) {
  return { type: 'query', utterance, ask, mode, say };
}

/** @returns {Intent} */
export function command(utterance, { action, target, text, say } = {}) {
  return { type: 'command', utterance, action, target, text, say };
}

/** @returns {Intent} */
export function unrecognized(utterance, suggestions = []) {
  return { type: 'unrecognized', utterance, suggestions };
}
