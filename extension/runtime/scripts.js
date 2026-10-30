// The user scripts the runtime registers: one per installed adapter.
//
// Each script runs in Chrome's USER_SCRIPT world at document_idle (top frame
// only). It is the adapter's file turned into a function (moduleFactorySource)
// plus a small preamble that:
//   - turns off whatever an earlier revision of the same adapter switched on
//     in this page, so an update never stacks two copies;
//   - checks the page exactly against the adapter's URL patterns (Chrome's
//     match patterns are only a first, broader filter) and the sites the
//     developer switched it off on;
//   - calls enable(parameters, toolkit) and reports applied / failed /
//     skipped to the service worker, with the page origin only. `toolkit`
//     reaches the toolkit through the service worker, as this adapter:
//     toolkit.data.get(key?) / .set(key, value) / .delete(key?) keep its own
//     values, and toolkit.observe(text or {text, type, data}) tells the
//     toolkit what the person did. Who can read either follows the adapter's
//     visibility.
// All adapters in a page share one USER_SCRIPT world, so a later
// chrome.userScripts.execute can find and disable a running adapter.

import {
  moduleFactorySource, chromeMatchPatterns, urlPatternRegExpSource,
} from '../vendor/protocol/adapter/index.js';

export const SCRIPT_PREFIX = 'rt-';

/** `ada/redbird/big-buttons` -> `rt-ada~redbird~big-buttons` (no "/" in a script id). */
export const scriptId = (key) => SCRIPT_PREFIX + key.replaceAll('/', '~');
export const keyOf = (a) => `${a.adapter.owner}/${a.adapter.appId}/${a.adapter.id}`;

// Shared by every script: the registry of running adapters in this page, and
// the report channel. Inlined, because user scripts cannot import.
const PREAMBLE = String.raw`
  const rt = globalThis.__ai4a11yRuntime || (globalThis.__ai4a11yRuntime = { adapters: {} });
  const report = (status, message) => {
    try { chrome.runtime.sendMessage({ type: 'ai4a11y:report', key: KEY, revision: REVISION, origin: location.origin, status, message: message ? String(message).slice(0, 500) : undefined }); } catch (e) { /* the extension is reloading */ }
  };
  const errorText = (e) => (e && (e.stack || e.message)) ? String(e.message || e) : String(e);
  const turnOff = () => {
    const running = rt.adapters[KEY];
    if (!running) return false;
    delete rt.adapters[KEY];
    try { running.adapter.disable(); } catch (e) { report('failed', 'disable() threw: ' + errorText(e)); }
    return true;
  };`;

/**
 * The script for one installed, available adapter.
 * @param {object} entry one item of adapter_installed (with its package)
 */
export function buildUserScript(entry) {
  const key = keyOf(entry);
  const factory = moduleFactorySource(entry.package.code);
  const scope = (entry.urlPatterns || []).map(urlPatternRegExpSource);
  const off = Object.entries(entry.sites || {}).filter(([, on]) => on === false).map(([origin]) => origin);
  return `(() => {
  const KEY = ${JSON.stringify(key)};
  const REVISION = ${JSON.stringify(entry.revision)};
  const SCOPE = ${JSON.stringify(scope)}.map((s) => new RegExp(s));
  const OFF_ON = ${JSON.stringify(off)};
  const PARAMETERS = ${JSON.stringify(entry.parameters || {})};
  const ENTRY = ${JSON.stringify(entry.package.entry || null)};
${PREAMBLE}
  const ask = (message) => chrome.runtime.sendMessage({ ...message, key: KEY }).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || 'the toolkit did not answer');
    return r.result;
  });
  const TOOLKIT = Object.freeze({
    data: Object.freeze({
      get: (k) => ask({ type: 'ai4a11y:data', op: 'get', k }),
      set: (k, value) => ask({ type: 'ai4a11y:data', op: 'set', k, value }),
      delete: (k) => ask({ type: 'ai4a11y:data', op: 'delete', k }),
    }),
    observe: (o) => ask({ type: 'ai4a11y:observe', text: typeof o === 'string' ? o : o && o.text, kind: o && o.type, data: o && o.data }),
  });
  const wasRunning = turnOff();
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  const here = location.protocol + '//' + location.hostname.toLowerCase() + ':' + port + location.pathname;
  if (!SCOPE.some((r) => r.test(here))) { if (wasRunning) report('removed'); return; }
  if (OFF_ON.includes(location.origin)) { report(wasRunning ? 'removed' : 'skipped', 'switched off on this site'); return; }
  let adapter;
  try {
    const exports = ${factory}();
    const isAdapter = (v) => !!v && typeof v === 'object' && typeof v.enable === 'function' && typeof v.disable === 'function';
    if (ENTRY) adapter = exports[ENTRY];
    else if (isAdapter(exports.default)) adapter = exports.default;
    else { const found = Object.values(exports).filter(isAdapter); adapter = found.length === 1 ? found[0] : null; }
    if (!isAdapter(adapter)) throw new Error(ENTRY ? 'the export "' + ENTRY + '" is not an adapter' : 'the file does not export exactly one adapter (an object with enable and disable)');
  } catch (e) { report('failed', 'Loading the adapter: ' + errorText(e)); return; }
  rt.adapters[KEY] = { adapter, revision: REVISION };
  let result;
  try { result = adapter.enable(PARAMETERS, TOOLKIT); } catch (e) { delete rt.adapters[KEY]; report('failed', 'enable() threw: ' + errorText(e)); return; }
  const settled = (value) => {
    if (value === false) { delete rt.adapters[KEY]; report('skipped', 'enable() returned false: nothing to change on this page'); } else report('applied');
  };
  if (!result || typeof result.then !== 'function') return settled(result);
  // An async enable() reports when it ends, unless this copy was turned off
  // or replaced meanwhile (that already reported).
  const mine = () => rt.adapters[KEY] && rt.adapters[KEY].adapter === adapter;
  result.then(
    (value) => { if (mine()) settled(value); },
    (e) => { if (mine()) { delete rt.adapters[KEY]; report('failed', 'enable() failed: ' + errorText(e)); } });
})();`;
}

/** A script that switches one adapter off in a page where it is running. */
export function teardownScript(key) {
  return `(() => {
  const KEY = ${JSON.stringify(key)};
  const REVISION = null;
${PREAMBLE}
  if (turnOff()) report('removed');
})();`;
}

/** The chrome.userScripts registration for one adapter. */
export function registrationFor(entry) {
  return {
    id: scriptId(keyOf(entry)),
    matches: chromeMatchPatterns(entry.urlPatterns || []),
    js: [{ code: buildUserScript(entry) }],
    runAt: 'document_idle',
    world: 'USER_SCRIPT',
    allFrames: false,
  };
}

/** Which installed adapters should run: available, switched on, and portable web modules. */
export function runnable(adapters) {
  return (adapters || []).filter(a => a.available && a.enabled && a.package?.format === 'web-module@1' && (a.urlPatterns || []).length);
}
