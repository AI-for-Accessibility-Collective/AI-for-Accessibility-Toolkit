// Module hooks for onboard-contract.test.mjs, local mode only.
//
// In local mode onboard() builds its Librarian inside server.js: localBits()
// creates the toolkit host, host.getInstance(uid) hands back the librarian,
// and neither is exported. The remote branch is observable from outside (its
// writes are fetch() calls), the local branch is not. To record the local
// branch's librarian calls the same way, these hooks swap the toolkit host
// module that server.js imports for a thin wrapper that returns a recording
// librarian. Nothing in server/ or toolkit/ changes; the swap lives in the
// test process only.
//
// How: `resolve` tags the toolkit-host import made BY server.js with a query
// marker, and `load` answers that tagged URL with the wrapper source below,
// which imports the real module (untagged, so the hooks pass it through) and
// re-exports createToolkitHost with getInstance wrapped. The wrapper hands
// each librarian to globalThis.__onboardContractRecord, which the test sets
// up on the main thread before importing server.js.
//
// Registered with `module.register()` from node:module, available since
// Node 20.6 and inside the package's engines range.
//
// FLAG(review): a one-line export of localBits() from server.js would replace
// this whole file; R1 scopes the change to the test harness, so it stays here.

const MARKER = '?onboard-contract-recorder';

export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  if (r.url.endsWith('/server/src/toolkit-host.js') && (context.parentURL || '').endsWith('/onboarding/server.js')) {
    return { ...r, url: r.url + MARKER };
  }
  return r;
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(MARKER)) return nextLoad(url, context);
  const real = url.slice(0, -MARKER.length);
  const source = `
import { createToolkitHost as realCreateToolkitHost } from ${JSON.stringify(real)};
export function createToolkitHost(opts) {
  const host = realCreateToolkitHost(opts);
  const getInstance = host.getInstance;
  host.getInstance = async (uid) => {
    const instance = await getInstance(uid);
    const record = globalThis.__onboardContractRecord;
    if (typeof record !== 'function') throw new Error('onboard-contract hooks: no recorder installed on globalThis');
    return { ...instance, librarian: record(instance.librarian, uid) };
  };
  return host;
}
`;
  return { format: 'module', shortCircuit: true, source };
}
