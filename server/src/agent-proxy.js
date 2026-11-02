// /v1/agent/…: the browser extension's assistant sidebar. The service checks
// the person's token and forwards the request to the agent host (agent-host/,
// on its own VM, reachable only on the private network), signed with the
// shared secret and naming the account. The host runs that account's opencode
// sandbox. Event streams pass straight through.
//
// What a person shares of a page (/v1/agent/requests/…) is never logged here:
// app.js leaves those bodies out of the request log (agentContentLogged).

import { sendJSON, bearerFrom } from './http.js';

export const AGENT_PREFIX = '/v1/agent';
const MAX_BODY = 12_000_000;

/** Whether the request log may keep a request's body: never page data. */
export const agentContentLogged = (pathname) => !pathname.startsWith(`${AGENT_PREFIX}/requests/`);

export function createAgentProxy({ authenticate, hostUrl, secret, fetch = globalThis.fetch, log }) {
  const base = hostUrl ? String(hostUrl).replace(/\/+$/, '') : null;

  return async function route(req, res, method, pathname, search = '') {
    if (!base || !secret) return sendJSON(res, 503, { error: 'agent-unavailable', message: 'The assistant is not set up on this toolkit.' });
    if (!bearerFrom(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const rec = await authenticate(req);
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized' });
    // A token bound to one app speaks for that app, not for the person.
    if (rec.kind === 'app') return sendJSON(res, 403, { error: 'forbidden', message: 'Use your default token for the assistant.' });

    let body;
    if (method === 'POST' || method === 'PUT') {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return sendJSON(res, 413, { error: 'too-large' });
        chunks.push(c);
      }
      body = Buffer.concat(chunks);
    }
    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    let up;
    try {
      up = await fetch(`${base}/agent${pathname.slice(AGENT_PREFIX.length)}${search}`, {
        method, body, signal: ctl.signal,
        headers: { authorization: `Bearer ${secret}`, 'x-ai4a11y-uid': rec.uid, ...(body ? { 'content-type': 'application/json' } : {}) },
      });
    } catch (e) {
      if (ctl.signal.aborted) return res.end();
      log?.warn('agent.unreachable', { uid: rec.uid, error: e });
      return sendJSON(res, 502, { error: 'agent-unreachable', message: 'The assistant is not answering. Try again in a minute.' });
    }
    const type = up.headers.get('content-type') || 'application/json';
    res.writeHead(up.status, { 'content-type': type, 'cache-control': 'no-store', ...(type.startsWith('text/event-stream') ? { 'x-accel-buffering': 'no' } : {}) });
    try {
      if (up.body) for await (const chunk of up.body) res.write(chunk);
    } catch { /* the sidebar or the host went away */ }
    res.end();
  };
}
