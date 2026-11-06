// The XR bridge: connects the AI for Accessibility XR guide (an audio guide
// for smart glasses, github.com/AI-for-Accessibility-Collective/
// AI-for-Accessibility-XR) to a toolkit service, without changing that app.
//
// The XR app keeps its own embedded toolkit and profile store. Its server
// exposes a small HTTP API under /webview, guarded by its BRIDGE_TOKEN (or
// ADMIN_PASSWORD), and this bridge works only through it:
//   GET  /webview/status    the session: mode (baseline | toolkit), …
//   POST /webview/mode      {mode}
//   GET  /webview/profile   {mode, needs: [{key, value}], …}; 409 until the
//                           phone app has opened the store
//   POST /webview/profile   {key, value}: pacing, readAloudRate or captions;
//                           value null clears it
// So the XR app stays the only writer of its store.
//
// What it does, once started:
//   - Registers the XR app with the toolkit (Adapter MCP), so it shows under
//     the developer console's Apps with four adaptations a person, the
//     console's Try it or a coding agent can switch: toolkit mode, one step
//     at a time, speaking rate, captions. "One step at a time" is a need the
//     toolkit has no name for, so its descriptor registers it, and the
//     profile agent can suggest it to the people it fits.
//   - Follows the person's toolkit profile: on start, on every profile change
//     (/v1/profile/events) and when the XR store opens (a phone session), it
//     writes what the profile says into the XR app: readAloudRate and
//     captions (the toolkit's own needs), and pacing from the registered need
//     <appId>/one-step. What the profile does not say is left as it is.
//   - Tells the toolkit when the person changes one of these on the XR side
//     (an observation), so it learns from it.
//
// It only runs when started for the XR app: start() checks that the address
// answers like the XR guide and stops otherwise. Node 18+, no dependencies.

import { connectToToolkit, createAdapterProvider, fromToggleAdapter, createRegistryClient, defineDescriptor } from '../../adapter-mcp/index.js';

export const XR_APP = Object.freeze({ appId: 'ai4a11y-xr', name: 'AI for Accessibility XR' });
const VERSION = '0.1.0';
// The XR app's own ranges (src/toolkit/needs-catalog.ts).
const RATE = Object.freeze({ min: 0.7, max: 1.2, step: 0.1, start: 1 });

// The one target: the XR guide itself (it speaks through the glasses; there
// are no pages). Its platform is the OS of the machine its server and this
// bridge run on.
const OS = { darwin: 'macos', win32: 'windows', linux: 'linux' }[globalThis.process?.platform] || 'linux';
export const XR_TARGET = Object.freeze({ platform: OS, application: XR_APP.appId });
const describe = (fields) => defineDescriptor({
  appId: XR_APP.appId, version: VERSION, surfaces: ['xr'], targets: [{ platforms: ['*'], applications: [XR_APP.appId] }],
  operations: ['query', 'check', 'apply', 'revert', 'targets'], ...fields,
});

/** The four adaptations, as the toolkit sees them. */
export const XR_DESCRIPTORS = Object.freeze({
  'toolkit-mode': describe({
    id: 'toolkit-mode', name: 'Follow my profile',
    description: 'The guide shapes what it says and how it says it from your profile (its toolkit mode). Off, it speaks the same way to everyone (its baseline mode).',
    supportAreas: ['cognitive', 'hearing', 'vision'],
  }),
  'one-step': describe({
    id: 'one-step', name: 'One step at a time',
    description: 'The guide gives one action, then waits for you before the next.',
    supportAreas: ['cognitive'],
    needs: [{
      id: 'one-step', phrase: 'One step at a time',
      description: 'Spoken directions come one action at a time, and the guide waits before the next.',
      abilities: 'Keeping several spoken steps in mind at once is hard, for example with memory or attention differences, or while doing the task with your hands.',
    }],
  }),
  'speaking-rate': describe({
    id: 'speaking-rate', name: 'Speaking rate',
    description: 'How fast the guide talks: slower to follow it more easily, faster to save time.',
    supportAreas: ['hearing', 'cognitive'],
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { rate: { type: 'number', minimum: RATE.min, maximum: RATE.max, default: 0.9, description: 'Times normal speed (1 is normal)' } },
    },
  }),
  captions: describe({
    id: 'captions', name: 'Captions on the display',
    description: 'The guide’s words also appear on the glasses’ display.',
    supportAreas: ['hearing'],
  }),
});

const NEED_KEY = `${XR_APP.appId}/one-step`;
const clampRate = (v) => Math.round(Math.min(RATE.max, Math.max(RATE.min, Math.round((v - RATE.min) / RATE.step) * RATE.step + RATE.min)) * 10) / 10;

/**
 * What the XR app should hold, from a toolkit profile: only what the profile
 * says. {pacing?, readAloudRate?, captions?}
 */
export function desiredFromProfile(profile) {
  const out = {};
  for (const n of profile?.fields?.needs || []) {
    if (n?.value === undefined || n.value === null) continue;
    if (n.dimension === 'readAloudRate' && Number.isFinite(Number(n.value))) out.readAloudRate = clampRate(Number(n.value));
    else if (n.dimension === 'captions' && typeof n.value === 'boolean') out.captions = n.value;
    else if (n.dimension === NEED_KEY) out.pacing = n.value === false ? 'continuous' : 'stepwise';
  }
  return out;
}

const SPOKEN = {
  pacing: (v) => (v === 'stepwise' ? 'Turned on One step at a time on the XR guide.' : 'Turned off One step at a time on the XR guide.'),
  readAloudRate: (v) => (v == null ? 'Set the XR guide back to its usual speaking rate.' : `Set the XR guide's speaking rate to ${v} times normal.`),
  captions: (v) => (v ? 'Turned on captions on the XR guide’s display.' : 'Turned off captions on the XR guide’s display.'),
  mode: (v) => (v === 'toolkit' ? 'Switched the XR guide to follow their profile.' : 'Switched the XR guide to speak the same way to everyone.'),
};

/**
 * @param {object} o
 * @param {string} o.toolkitUrl     the toolkit service
 * @param {string} o.toolkitToken   the account's default token, or an app token made for XR_APP.appId
 * @param {string} o.xrUrl          the XR app's server, e.g. http://localhost:3000
 * @param {string} [o.xrToken]      the XR app's BRIDGE_TOKEN
 * @param {string} [o.xrPassword]   or its ADMIN_PASSWORD
 * @param {number} [o.pollMs]       how often to read the XR app's state (default 3000)
 * @param {typeof fetch} [o.fetch]
 * @param {(event: string, fields?: object) => void} [o.log]
 */
export function createXrBridge({ toolkitUrl, toolkitToken, xrUrl, xrToken, xrPassword, pollMs = 3000, fetch: fetcher = globalThis.fetch.bind(globalThis), log = () => {} }) {
  const xrBase = String(xrUrl || '').replace(/\/+$/, '');
  const toolkitBase = String(toolkitUrl || '').replace(/\/+$/, '');
  const auth = xrToken ? `Bearer ${xrToken}` : xrPassword ? `Basic ${Buffer.from(`bridge:${xrPassword}`).toString('base64')}` : null;
  const registry = createRegistryClient({ url: toolkitBase, token: toolkitToken, fetch: fetcher });

  // The XR app's state as last read: null until its store is open.
  let xr = null;
  // What the bridge itself wrote last, so a change made on the XR side can be told apart.
  const wrote = {};
  let link = null, timer = null, events = null, stopped = false;

  async function xrCall(method, p, body) {
    const res = await fetcher(`${xrBase}/webview${p}`, {
      method, headers: { ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 404) throw Object.assign(new Error('The XR app refused the bridge: set XR_BRIDGE_TOKEN to its BRIDGE_TOKEN (or XR_ADMIN_PASSWORD to its ADMIN_PASSWORD).'), { code: 'xr-auth' });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    return { status: res.status, body: json, text };
  }

  function read(view) {
    const needs = {};
    for (const n of view?.needs || []) needs[n.key] = n.value;
    return { mode: view?.mode, needs };
  }

  /** Read the XR app's profile view; null while its store is not open. */
  async function refresh() {
    const r = await xrCall('GET', '/profile');
    if (r.status === 409) { xr = null; return null; }
    if (r.status !== 200) throw new Error(`The XR app answered ${r.status}: ${r.text.slice(0, 200)}`);
    return read(r.body);
  }

  async function setNeed(key, value) {
    const r = await xrCall('POST', '/profile', { key, value });
    if (r.status === 409) throw new Error('The XR guide has no profile open yet: connect the phone app to it first.');
    if (r.status !== 200) throw new Error(r.body?.error || `The XR app answered ${r.status}.`);
    wrote[key] = value;
    xr = read(r.body);
  }

  async function setMode(mode) {
    const r = await xrCall('POST', '/mode', { mode });
    if (r.status !== 204) throw new Error(`The XR app could not switch mode (${r.status}): ${r.text.slice(0, 200)}`);
    wrote.mode = mode;
    if (xr) xr = { ...xr, mode };
  }

  /** Write what the toolkit profile says into the XR app, where it differs. */
  async function follow() {
    if (!xr) return { written: [] };
    let profile;
    try { profile = (await registry.profile.get()).profile; } catch (e) { log('xr-bridge.profile-unread', { error: e.message }); return { written: [] }; }
    const want = desiredFromProfile(profile);
    const written = [];
    for (const [key, value] of Object.entries(want)) {
      if (xr.needs[key] === value) continue;
      await setNeed(key, value);
      written.push(key);
    }
    if (written.length) log('xr-bridge.followed', { written });
    return { written };
  }

  /** Changes the person made on the XR side since the last read: told to the toolkit. */
  async function noticeChanges(before, after) {
    if (!before || !after) return;
    const changed = [];
    if (before.mode !== after.mode && wrote.mode !== after.mode) changed.push(SPOKEN.mode(after.mode));
    for (const key of ['pacing', 'readAloudRate', 'captions']) {
      const was = before.needs[key], now = after.needs[key];
      if (was === now || wrote[key] === now) continue;
      changed.push(SPOKEN[key](now));
    }
    for (const text of changed) {
      try { await registry.profile.observe({ text, type: 'setting-change', origin: 'xr', app: XR_APP.appId }); } catch (e) { log('xr-bridge.observe-failed', { error: e.message }); }
    }
  }

  async function poll() {
    try {
      const before = xr;
      const now = await refresh();
      xr = now;
      if (now && !before) { log('xr-bridge.store-open'); await follow(); }
      else await noticeChanges(before, now);
    } catch (e) {
      log('xr-bridge.poll-failed', { error: e.message });
    }
    if (!stopped) timer = setTimeout(poll, pollMs);
  }

  // The toolkit's profile changes, as server-sent events: each one is followed.
  async function listen() {
    while (!stopped) {
      const ctrl = new AbortController();
      events = ctrl;
      try {
        const res = await fetcher(`${toolkitBase}/v1/profile/events`, { headers: { authorization: `Bearer ${toolkitToken}`, accept: 'text/event-stream' }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`profile events answered ${res.status}`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            if (/^data:/m.test(block) && !/^event:\s*(ready|ping)\s*$/m.test(block)) await follow().catch(e => log('xr-bridge.follow-failed', { error: e.message }));
          }
        }
      } catch (e) {
        if (stopped) return;
        log('xr-bridge.events-dropped', { error: e.message });
      }
      if (!stopped) await new Promise(r => setTimeout(r, 3000));
    }
  }

  const unavailable = () => (xr ? { available: true } : { available: false, reasons: [{ code: 'target-unavailable', message: 'The XR guide has no profile open yet: connect the phone app to it first.' }] });

  function adaptation(id, { isOn, enable, disable, toOptions, parameters }) {
    return fromToggleAdapter({
      descriptor: XR_DESCRIPTORS[id],
      adapter: { get enabled() { return !!(xr && isOn(xr)); }, enable, disable },
      toOptions, availability: unavailable,
      // What the XR app holds now, so undo can put back a value set on the glasses or by the profile.
      parameters: parameters && (() => (xr && isOn(xr) ? parameters(xr) : null)),
      targets: () => ({ candidates: [{ target: XR_TARGET, label: 'The XR guide' }], coverage: 'complete' }),
    });
  }

  const adapters = [
    adaptation('toolkit-mode', { isOn: (s) => s.mode === 'toolkit', enable: () => setMode('toolkit'), disable: () => setMode('baseline') }),
    adaptation('one-step', { isOn: (s) => s.needs.pacing === 'stepwise', enable: () => setNeed('pacing', 'stepwise'), disable: () => setNeed('pacing', 'continuous') }),
    adaptation('speaking-rate', {
      isOn: (s) => s.needs.readAloudRate != null,
      toOptions: (p) => ({ rate: clampRate(Number(p?.rate ?? 0.9)) }),
      parameters: (s) => ({ rate: s.needs.readAloudRate }),
      enable: (o) => setNeed('readAloudRate', o.rate), disable: () => setNeed('readAloudRate', null),
    }),
    adaptation('captions', { isOn: (s) => s.needs.captions === true, enable: () => setNeed('captions', true), disable: () => setNeed('captions', false) }),
  ];

  return {
    /** Check the XR app is there, connect to the toolkit, and start following. */
    async start() {
      if (!toolkitBase || !toolkitToken) throw new Error('No toolkit: set TOOLKIT_URL and TOOLKIT_TOKEN.');
      if (!xrBase) throw new Error('No XR app: set XR_URL to its server, e.g. http://localhost:3000.');
      // Only for the XR guide: its status names a mode it can switch.
      let status;
      try { status = await xrCall('GET', '/status'); } catch (e) { if (e.code === 'xr-auth') throw e; throw new Error(`Could not reach the XR app at ${xrBase}: ${e.message}`); }
      const mode = status.body?.state?.mode;
      if (status.status !== 200 || !('canSetMode' in (status.body || {})) || !['baseline', 'toolkit'].includes(mode)) {
        throw new Error(`${xrBase} does not answer like the AI for Accessibility XR guide (GET /webview/status). The bridge is only for that app.`);
      }
      xr = await refresh();
      const provider = createAdapterProvider({
        application: { appId: XR_APP.appId, name: XR_APP.name, version: VERSION, supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node' }, surfaces: ['xr'] },
        adapters,
      });
      link = connectToToolkit({ url: toolkitBase, token: toolkitToken, provider, providerId: 'xr-bridge', label: `XR guide at ${new URL(xrBase).host}`, fetch: fetcher,
        onStatus: (s) => log('xr-bridge.toolkit', { state: s.state, ...(s.message ? { message: s.message } : {}) }) });
      await link.ready;
      const followed = await follow();
      timer = setTimeout(poll, pollMs);
      listen();
      return { storeOpen: !!xr, followed: followed.written };
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      events?.abort();
      await link?.close();
    },
    /** For tests and the CLI: read the XR app now, and follow the profile. */
    async sync() { const before = xr; xr = await refresh(); if (xr && !before) return follow(); await noticeChanges(before, xr); return { written: [] }; },
    follow,
    state: () => xr,
  };
}
