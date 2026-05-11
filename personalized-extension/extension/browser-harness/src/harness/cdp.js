// Low-level CDP send wrappers with timeouts. The reattach-on-detach retry
// wrapper lives in lifecycle.js (it needs bhAttach), not here -- this
// module only knows how to issue a single command with a bounded wait.

import { BH_CDP_TIMEOUT_MS } from './constants.js';

// Cancellable timeout. Returning the cancel handle (instead of a one-shot
// timer) lets the success path stop the timer rather than leaving it to
// fire later in the SW event loop. Rejection message is shaped so the
// reattach regex (in lifecycle.js) does NOT match it -- a timeout must
// surface, not silently retry forever.
function _bhTimeout(ms, label) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`CDP ${label} timed out after ${ms}ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

// Wraps chrome.debugger.sendCommand with a timeout. Accepts either a
// {tabId} or {targetId} target so iframe-path callers (bhJs) can reuse the
// same wrapper. Pass timeoutMs <= 0 or non-finite to use the default;
// pass Number.POSITIVE_INFINITY to disable (no timer scheduled).
export function _bhSendCmd(target, method, params, timeoutMs) {
  const ms = (Number.isFinite(timeoutMs) && timeoutMs > 0) ? timeoutMs : BH_CDP_TIMEOUT_MS;
  const send = new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params || {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`${method}: ${err.message}`));
      else resolve(result || {});
    });
  });
  if (!Number.isFinite(ms)) return send;
  const t = _bhTimeout(ms, method);
  return Promise.race([send, t.promise]).finally(() => t.cancel());
}

// One-shot send. Used directly by bhAttach (which can't recurse through the
// retry path) and as the inner of bhCdp's retry-on-detached wrapper.
export function _bhSendRaw(tabId, method, params, timeoutMs) {
  return _bhSendCmd({ tabId }, method, params, timeoutMs);
}
