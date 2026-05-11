// Polling helpers: wait for load / wait for element / wait for network idle.

import { bhAttach, bhCdp } from './lifecycle.js';
import { bhDrainEvents } from './state.js';
import { bhJs } from './runtime.js';

export function bhWait(ms = 1000) {
  return new Promise(r => setTimeout(r, ms));
}

export async function bhWaitForLoad(tabId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await bhJs(tabId, 'document.readyState')) === 'complete') return true;
    } catch {}
    await bhWait(300);
  }
  return false;
}

// Poll until querySelector(selector) finds something. wait_for_load misses
// SPAs because the document is 'complete' before the framework renders;
// use this after route changes / data fetches. visible:true also requires
// the element to be in-layout (checkVisibility, falling back to a
// per-element CSS check on older Chrome).
export async function bhWaitForElement(tabId, selector, { timeoutMs = 10000, visible = false } = {}) {
  await bhAttach(tabId);
  const sel = JSON.stringify(selector);
  const check = visible
    ? `(()=>{const e=document.querySelector(${sel});if(!e)return false;`
      + `if(typeof e.checkVisibility==='function')`
      + `return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});`
      + `const s=getComputedStyle(e);`
      + `return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'})()`
    : `!!document.querySelector(${sel})`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await bhJs(tabId, check)) return true; } catch {}
    await bhWait(300);
  }
  return false;
}

// Quiescence detector: drains the buffered Network.* events and returns
// true once all in-flight requests finish AND no new Network event fires
// for `idleMs`. Useful after form submits and SPA route transitions where
// there's no DOM change to wait_for_element on.
export async function bhWaitForNetworkIdle(tabId, { timeoutMs = 10000, idleMs = 500 } = {}) {
  await bhAttach(tabId);
  // Reset the buffer so prior traffic doesn't poison the idle window.
  bhDrainEvents(tabId);
  const deadline = Date.now() + timeoutMs;
  let lastActivity = Date.now();
  const inflight = new Set();
  while (Date.now() < deadline) {
    for (const e of bhDrainEvents(tabId)) {
      if (e.method === 'Network.requestWillBeSent') {
        inflight.add(e.params && e.params.requestId);
        lastActivity = Date.now();
      } else if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') {
        inflight.delete(e.params && e.params.requestId);
        lastActivity = Date.now();
      } else if (e.method.startsWith('Network.')) {
        lastActivity = Date.now();
      }
    }
    if (inflight.size === 0 && Date.now() - lastActivity >= idleMs) return true;
    await bhWait(100);
  }
  return false;
}
