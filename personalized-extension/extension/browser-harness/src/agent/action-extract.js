// JSON-action parsing + multi-action batch extraction + the cheap
// page-change probe used between sub-actions.

import { _BH_AGENT_TERMINATES_SEQUENCE } from './constants.js';

// Strip ```json fences if present; throw a parse error carrying the raw
// text so the loop can echo it back to the model on the retry prompt --
// "you said X, here's what's wrong".
export function _bhAgentParseAction(text) {
  let s = (text || '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }
  try {
    return JSON.parse(s);
  } catch (e) {
    const err = new Error(`response was not valid JSON: ${e.message}`);
    err.rawText = text;
    throw err;
  }
}

// Normalise the LLM response into a list of action objects. Supports
// both the legacy single-action shape ({action, ...fields}) and the
// browser_use-style batched shape ({actions: [...]}). Meta fields
// (evaluation_previous_goal, memory, next_goal) are returned alongside
// for caller reuse.
export function _bhAgentExtractBatch(response) {
  const meta = {
    evaluation_previous_goal: response.evaluation_previous_goal,
    memory: response.memory,
    next_goal: response.next_goal,
  };
  if (Array.isArray(response.actions) && response.actions.length) {
    // Each entry should be an action object with at least `action`.
    return { actions: response.actions, meta };
  }
  // Single-action: strip meta fields so the action record is clean.
  const { evaluation_previous_goal, memory, next_goal, actions, ...rest } = response;
  if (rest && typeof rest.action === 'string') {
    return { actions: [rest], meta };
  }
  // Fallback: nothing recognisable -- caller will treat as parse error.
  return { actions: [], meta };
}

// Page-change probe used between sub-actions in a batch. Cheap CDP eval
// to read location.href -- if it changed, abort the batch. Returns null
// on failure so we don't false-positive an abort on transient errors.
export async function _bhAgentCurrentUrlSafe(tabId) {
  if (!tabId) return null;
  try {
    const r = await globalThis.BrowserHarness.cdp(
      tabId,
      'Runtime.evaluate',
      { expression: 'location.href', returnByValue: true },
      { timeoutMs: 1000 },
    );
    return (r && r.result && r.result.value) || null;
  } catch { return null; }
}

// Re-export for callers that already import from this module.
export { _BH_AGENT_TERMINATES_SEQUENCE };
