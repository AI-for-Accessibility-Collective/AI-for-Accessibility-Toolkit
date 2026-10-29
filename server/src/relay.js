// The provider relay: how an app that cannot accept connections (a web page)
// still answers MCP clients.
//
// A provider registers, then holds one server-sent-event channel open. When
// an MCP client of the SAME uid posts a JSON-RPC request to the provider's
// endpoint, the relay gives it a relay-local id, writes it down the channel,
// and waits for the provider to post the response back. The relay never
// interprets the request beyond JSON-RPC framing and never runs adapter code:
// the provider validates and executes (adapter-mcp.md §1, "the integrating
// application owns execution").
//
// Live state is in memory, so it is per process. A deployment with several
// instances needs sticky routing for a provider's channel and its clients
// (or one instance), the same constraint the per-uid lock in app.js already
// documents. When the process restarts, providers reconnect and re-register.
//
// Keys are `<uid>/<providerId>`: provider ids are chosen by the provider and
// only unique within an account.

const REQUEST_TIMEOUT_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const ACTIVITY_LIMIT = 25;
const PROVIDERS_PER_UID = 20;

export class RelayError extends Error {
  constructor(code, message, rpcCode = -32000) {
    super(message);
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

/**
 * @param {Object} [options]
 * @param {(uid: string) => void} [options.onChange]  the uid's apps changed
 * @param {(type: string, fields: object) => void} [options.onEvent]  for logs
 *   and the stored activity: app.registered, app.connected, app.disconnected,
 *   app.removed, mcp.call
 */
export function createRelay({ requestTimeoutMs = REQUEST_TIMEOUT_MS, heartbeatMs = HEARTBEAT_MS, onChange = () => {}, onEvent = () => {} } = {}) {
  const providers = new Map(); // key -> entry
  let seq = 0;

  const keyOf = (uid, providerId) => `${uid}/${providerId}`;
  const ids = (p) => ({ uid: p.uid, appId: p.appId, providerId: p.providerId });
  const listeners = new Set([onEvent]);
  const emit = (type, fields) => {
    for (const fn of listeners) { try { fn(type, fields); } catch { /* a listener must not break the relay */ } }
  };
  /** Also send events to `fn`. Returns a function that stops it. */
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function publicView(p) {
    return {
      providerId: p.providerId,
      appId: p.appId,
      label: p.label,
      live: !!p.channel,
      platform: p.application.platform || null,
      registeredAt: p.registeredAt,
      connectedAt: p.connectedAt,
      lastSeenAt: p.lastSeenAt,
      adapterIds: p.adapters.map(a => a.id),
      activity: p.activity.slice(-10),
    };
  }

  /** Record (or refresh) a registration. The channel comes separately. */
  function register({ uid, tokenId, providerId, label, application, adapters }) {
    const key = keyOf(uid, providerId);
    const existing = providers.get(key);
    if (!existing && [...providers.values()].filter(p => p.uid === uid).length >= PROVIDERS_PER_UID) {
      // Make room by forgetting this account's oldest disconnected provider.
      const stale = [...providers.values()].filter(p => p.uid === uid && !p.channel).sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      if (!stale) throw new RelayError('too-many-providers', `An account can have at most ${PROVIDERS_PER_UID} connected app instances.`);
      providers.delete(keyOf(uid, stale.providerId));
    }
    if (existing && existing.appId !== application.appId && existing.channel) {
      throw new RelayError('provider-id-in-use', `Provider id ${providerId} is already connected for app ${existing.appId}.`);
    }
    const now = Date.now();
    const entry = existing || { uid, providerId, channel: null, pending: new Map(), activity: [], registeredAt: now, connectedAt: null, heartbeat: null };
    Object.assign(entry, { tokenId, label: label || '', appId: application.appId, application, adapters, lastSeenAt: now });
    providers.set(key, entry);
    if (!existing) emit('app.registered', { ...ids(entry), tokenId, adapters: adapters.length, label: entry.label });
    onChange(uid);
    return entry;
  }

  function get(uid, providerId) {
    return providers.get(keyOf(uid, providerId)) || null;
  }

  /** Attach the provider's SSE response. Replaces (and ends) an older channel. */
  function attach(uid, providerId, res) {
    const p = get(uid, providerId);
    if (!p) throw new RelayError('not-registered', 'Register the provider before opening its channel.');
    if (p.channel) closeChannel(p, 'replaced by a newer connection');
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n: connected\n\n');
    p.channel = res;
    p.connectedAt = Date.now();
    p.lastSeenAt = p.connectedAt;
    p.heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* close handler cleans up */ } }, heartbeatMs);
    p.heartbeat.unref?.();
    res.on('close', () => {
      if (p.channel === res) detach(p, 'the app disconnected');
    });
    emit('app.connected', ids(p));
    onChange(uid);
  }

  function detach(p, why) {
    clearInterval(p.heartbeat);
    p.heartbeat = null;
    p.channel = null;
    p.lastSeenAt = Date.now();
    for (const [, pending] of p.pending) pending.reject(new RelayError('provider-disconnected', `The app disconnected (${why}) before answering.`));
    p.pending.clear();
    emit('app.disconnected', { ...ids(p), reason: why, connectedMs: p.connectedAt ? p.lastSeenAt - p.connectedAt : undefined });
    onChange(p.uid);
  }

  function closeChannel(p, why) {
    const res = p.channel;
    detach(p, why);
    try { res.end(); } catch { /* already gone */ }
  }

  function note(p, entry) {
    p.activity.push({ at: new Date().toISOString(), ...entry });
    if (p.activity.length > ACTIVITY_LIMIT) p.activity.splice(0, p.activity.length - ACTIVITY_LIMIT);
    emit('mcp.call', { ...ids(p), ...entry });
  }

  // A short description of a tools/call for the console's activity list.
  function describeCall(message) {
    if (message.method !== 'tools/call') return { method: message.method };
    const args = message.params?.arguments || {};
    const adapter = args.adapterRef?.id || (String(message.params?.name || '').startsWith('apply_') ? String(message.params.name).slice(6) : undefined);
    return { method: 'tools/call', tool: message.params?.name, ...(adapter ? { adapter } : {}) };
  }

  /**
   * Forward one JSON-RPC message from a client. Resolves with the provider's
   * response (original id restored), or null for a notification.
   */
  function forward(p, message, { client = 'client' } = {}) {
    if (!p.channel) return Promise.reject(new RelayError('provider-offline', `${p.application.name} (${p.providerId}) is not connected right now. Open the app again and it reconnects.`));
    const isRequest = Object.hasOwn(message, 'id');
    const relayId = `r${++seq}`;
    const outgoing = isRequest ? { ...message, id: relayId } : message;
    const started = Date.now();
    const call = describeCall(message);
    try {
      p.channel.write(`event: request\ndata: ${JSON.stringify(outgoing)}\n\n`);
    } catch (e) {
      return Promise.reject(new RelayError('provider-offline', 'The connection to the app broke.'));
    }
    if (!isRequest) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        p.pending.delete(relayId);
        note(p, { ...call, client, outcome: 'timeout', ms: Date.now() - started });
        onChange(p.uid);
        reject(new RelayError('provider-timeout', `${p.application.name} did not answer within ${Math.round(requestTimeoutMs / 1000)} seconds.`, -32001));
      }, requestTimeoutMs);
      timer.unref?.();
      p.pending.set(relayId, {
        resolve: (response) => {
          clearTimeout(timer);
          const sc = response?.result?.structuredContent;
          note(p, { ...call, client, outcome: response?.error ? `error ${response.error.code}` : sc?.status || 'ok', ms: Date.now() - started });
          onChange(p.uid);
          resolve({ ...response, id: message.id });
        },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  /** The provider posting a JSON-RPC response. Returns false for an unknown id. */
  function complete(p, response) {
    const pending = p.pending.get(response?.id);
    if (!pending) return false;
    p.pending.delete(response.id);
    p.lastSeenAt = Date.now();
    pending.resolve(response);
    return true;
  }

  function remove(uid, providerId) {
    const p = get(uid, providerId);
    if (!p) return false;
    if (p.channel) closeChannel(p, 'the app signed off');
    providers.delete(keyOf(uid, providerId));
    emit('app.removed', ids(p));
    onChange(uid);
    return true;
  }

  /** Live and recently seen providers for one uid. */
  function list(uid) {
    return [...providers.values()].filter(p => p.uid === uid).map(publicView);
  }

  function forUid(uid) {
    return [...providers.values()].filter(p => p.uid === uid);
  }

  /** Disconnect every provider of a uid (account disabled or deleted). */
  function dropUser(uid) {
    for (const p of forUid(uid)) remove(uid, p.providerId);
  }

  /** Disconnect providers that authenticated with one of these token ids. */
  function dropTokens(ids) {
    const set = new Set(ids);
    for (const p of [...providers.values()]) if (set.has(p.tokenId)) remove(p.uid, p.providerId);
  }

  function liveCount(uid) {
    return forUid(uid).filter(p => p.channel).length;
  }

  /** End every channel (server shutdown, tests). */
  function closeAll() {
    for (const p of providers.values()) if (p.channel) closeChannel(p, 'the toolkit is shutting down');
  }

  return { register, get, attach, forward, complete, remove, list, forUid, dropUser, dropTokens, liveCount, closeAll, subscribe };
}
