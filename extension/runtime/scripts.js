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

// ── previews from the assistant sidebar ──────────────────────────────────────
// One preview at a time per page, under its own key: never installed, never
// reported to the toolkit. Its toolkit.data lives in the page only. The
// script's value is a promise of {status, message, changes, checks}, which
// chrome.userScripts.execute hands back to the sidebar.
//
// The agent's checks say whether the adapter works: each is the body of an
// async function (the agent host has already compiled it on its own, so it
// cannot reach outside its function) that returns true when the page is as it
// should be. Each runs before enable() and again after it, and only whether it
// passed comes back, with a short error. `changes` counts what enable() changed
// in the page (mutation records), where the page has a MutationObserver, and
// `shift` how far it moved what was on screen (the sum of the layout shifts
// in that time, as Core Web Vitals scores them: 0 is steady, 0.1 is a lot).
//
// With `audit`, axe-core (injected before this script, AXE_FILE) checks the
// page against WCAG 2.0-2.2 A and AA rules before enable() and again after
// it; `axe` says which problems the adapter added and which it fixed, by rule
// and element. The sidebar decides how much of that the agent sees.

export const PREVIEW_KEY = 'preview';
export const AXE_FILE = 'vendor/axe-core.min.js';
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CHECK_MS = 5000;
const SETTLE_MS = 400;
const AXE_MS = 30000;

/** @param {{code: string, urlPatterns: string[], parameters?: object, checks?: {name: string, code: string}[], audit?: boolean}} preview */
export function buildPreviewScript({ code, urlPatterns, parameters = {}, checks = [], audit = false }) {
  const factory = moduleFactorySource(code);
  const scope = (urlPatterns || []).map(urlPatternRegExpSource);
  const checkList = (checks || []).map(c => `async function () {\n${c.code}\n}`).join(',\n');
  return `(() => {
  const KEY = ${JSON.stringify(PREVIEW_KEY)};
  const SCOPE = ${JSON.stringify(scope)}.map((s) => new RegExp(s));
  const rt = globalThis.__ai4a11yRuntime || (globalThis.__ai4a11yRuntime = { adapters: {} });
  const errorText = (e) => String((e && e.message) || e);
  const running = rt.adapters[KEY];
  if (running) { delete rt.adapters[KEY]; try { running.adapter.disable(); } catch (e) { /* the old preview's problem */ } }
  const store = new Map();
  const TOOLKIT = Object.freeze({
    data: Object.freeze({
      get: async (k) => (k === undefined ? Object.fromEntries(store) : store.get(k)),
      set: async (k, v) => { store.set(k, v); },
      delete: async (k) => { if (k === undefined) store.clear(); else store.delete(k); },
    }),
    observe: async () => {},
  });
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  const here = location.protocol + '//' + location.hostname.toLowerCase() + ':' + port + location.pathname;
  if (!SCOPE.some((r) => r.test(here))) return Promise.resolve({ status: 'skipped', message: 'its runs_on patterns do not match this page' });
  let adapter;
  try {
    const exports = ${factory}();
    const isAdapter = (v) => !!v && typeof v === 'object' && typeof v.enable === 'function' && typeof v.disable === 'function';
    if (isAdapter(exports.default)) adapter = exports.default;
    else { const found = Object.values(exports).filter(isAdapter); adapter = found.length === 1 ? found[0] : null; }
    if (!adapter) throw new Error('the file does not export exactly one adapter (an object with enable and disable)');
  } catch (e) { return Promise.resolve({ status: 'failed', message: 'Loading the adapter: ' + errorText(e) }); }
  const CHECKS = [${checkList}];
  const runChecks = async () => {
    const out = [];
    for (const check of CHECKS) {
      let timer;
      try {
        const value = await Promise.race([check(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('took over ${CHECK_MS / 1000} seconds')), ${CHECK_MS}); })]);
        out.push({ ok: !!value });
      } catch (e) { out.push({ ok: false, error: errorText(e).slice(0, 160) }); }
      clearTimeout(timer);
    }
    return out;
  };
  // axe-core's WCAG A and AA problems in the page, one entry per rule and element.
  // Matched by the element itself, not axe's selector for it: the selector can
  // name the adapter's own marks, which would count an old problem as new.
  const AUDIT = ${audit ? 'true' : 'false'};
  const elementIds = new WeakMap();
  let nextElementId = 0;
  const elementKey = (el, target) => {
    if (!el || typeof el !== 'object') return target;
    if (!elementIds.has(el)) elementIds.set(el, '#' + (nextElementId++));
    return elementIds.get(el);
  };
  const runAxe = async () => {
    if (!AUDIT) return null;
    const axe = globalThis.axe;
    if (!axe || typeof axe.run !== 'function') return { error: 'axe-core is not loaded in this page' };
    let timer;
    try {
      const r = await Promise.race([
        axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'], elementRef: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('took over ${AXE_MS / 1000} seconds')), ${AXE_MS}); })]);
      const found = new Map();
      for (const v of r.violations) for (const n of v.nodes) {
        const target = (n.target || []).map((t) => (Array.isArray(t) ? t.join(' >> ') : String(t))).join(' >> ');
        found.set(v.id + ' ' + elementKey(n.element, target), { rule: v, target, summary: n.failureSummary || '' });
      }
      return { found, version: axe.version };
    } catch (e) { return { error: errorText(e).slice(0, 160) }; } finally { clearTimeout(timer); }
  };
  const wcagOf = (tags) => tags.map((t) => /^wcag([0-9])([0-9])([0-9]+)$/.exec(t)).filter(Boolean).map((m) => m[1] + '.' + m[2] + '.' + m[3]);
  const byRule = (entries) => {
    const rules = new Map();
    for (const e of entries) {
      const v = e.rule;
      const r = rules.get(v.id) || { id: v.id, impact: v.impact || null, help: v.help, wcag: wcagOf(v.tags || []), count: 0, targets: [], summary: e.summary.slice(0, 300) };
      r.count += 1;
      if (r.targets.length < 3) r.targets.push(e.target.slice(0, 160));
      rules.set(v.id, r);
    }
    return [...rules.values()];
  };
  const compare = (before, after) => {
    if (!before || !after) return undefined;
    if (before.error || after.error) return { error: before.error || after.error };
    const added = [...after.found].filter(([k]) => !before.found.has(k)).map(([, e]) => e);
    const fixed = [...before.found].filter(([k]) => !after.found.has(k)).map(([, e]) => e);
    return { version: after.version, added: byRule(added), fixed: byRule(fixed).map(({ id, help, wcag, count }) => ({ id, help, wcag, count })), remaining: after.found.size - added.length };
  };
  // Counted as they arrive: records handed to the callback are gone from takeRecords().
  let records = 0;
  const watch = typeof MutationObserver === 'function' && typeof document === 'object' ? new MutationObserver((list) => { records += list.length; }) : null;
  let shift = 0;
  let shifts = null;
  try {
    shifts = new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) shift += e.value; });
  } catch (e) { shifts = null; }
  const stopWatching = () => { if (watch) watch.disconnect(); if (shifts) shifts.disconnect(); };
  const report = async (result) => {
    await new Promise((r) => setTimeout(r, ${SETTLE_MS}));
    if (watch) { records += watch.takeRecords().length; result.changes = records; }
    if (shifts) { for (const e of shifts.takeRecords()) if (!e.hadRecentInput) shift += e.value; result.shift = Math.round(shift * 1000) / 1000; }
    stopWatching();
    const axeAfter = await runAxe();
    if (axeAfter) result.axe = compare(axeBefore, axeAfter);
    if (CHECKS.length) {
      const after = await runChecks();
      result.checks = after.map((a, i) => ({ before: before[i].ok, after: a.ok, ...(a.error ? { error: a.error } : {}) }));
    }
    return result;
  };
  let before = [];
  let axeBefore = null;
  rt.adapters[KEY] = { adapter, revision: 0 };
  return runAxe().then((a) => { axeBefore = a; return runChecks(); }).then((b) => {
    before = b;
    if (watch) watch.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, characterData: true });
    if (shifts) { try { shifts.observe({ type: 'layout-shift' }); } catch (e) { shifts = null; } }
    return adapter.enable(${JSON.stringify(parameters)}, TOOLKIT);
  }).then(
    (value) => {
      if (value === false) { delete rt.adapters[KEY]; stopWatching(); return { status: 'skipped', message: 'enable() returned false: nothing to change on this page' }; }
      return report({ status: 'applied' });
    },
    (e) => { delete rt.adapters[KEY]; stopWatching(); return { status: 'failed', message: 'enable() failed: ' + errorText(e) }; });
})()`;
}

/** Take the preview off the page; the value says whether there was one. */
export function previewTeardownScript() {
  return `(() => {
  const rt = globalThis.__ai4a11yRuntime;
  const running = rt && rt.adapters[${JSON.stringify(PREVIEW_KEY)}];
  if (!running) return false;
  delete rt.adapters[${JSON.stringify(PREVIEW_KEY)}];
  try { running.adapter.disable(); } catch (e) { return 'disable() threw: ' + String((e && e.message) || e); }
  return true;
})()`;
}
