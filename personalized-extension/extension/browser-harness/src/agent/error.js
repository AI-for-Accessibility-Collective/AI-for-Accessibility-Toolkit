// Step-error classification + the outermost per-action timeout. Mirrors
// browser_use/agent/service.py:_handle_step_error -- classify so the loop
// can choose: stop the run (terminal), tag-and-retry (timeout/transient),
// or echo raw response (parse). The terminal regex is deliberately narrow:
// anything unrecognised falls to transient, favoring continuation over
// premature termination.

import { BH_AGENT_ACTION_TIMEOUT_MS } from './constants.js';

// Promise.race against a labeled timeout. On timeout throws an Error whose
// message is shaped so _bhClassifyAgentError can recognise it.
export async function _bhWithActionTimeout(label, ms, fn) {
  if (!Number.isFinite(ms) || ms <= 0) return fn();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`action ${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function _bhClassifyAgentError(err) {
  const msg = (err && err.message) || String(err);
  if (/browser_crashed|browser_unresponsive|debugger detached/i.test(msg)) {
    return { kind: 'terminal', msg };
  }
  if (/timed out after \d+ms/i.test(msg)) {
    return { kind: 'timeout', msg };
  }
  if (err && typeof err === 'object' && 'rawText' in err) {
    return { kind: 'parse', msg };
  }
  return { kind: 'transient', msg };
}

// Re-export the constant so callers can do `import { ACTION_TIMEOUT_MS }`
// rather than reach all the way to constants.js.
export { BH_AGENT_ACTION_TIMEOUT_MS };
