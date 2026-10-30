// A minimal MCP client over Streamable HTTP, for calling an adapter provider
// through a toolkit service (or any MCP HTTP endpoint).
//
// Enough of the transport for request/response tools: it POSTs one JSON-RPC
// message, accepts either a JSON body or an SSE stream carrying the response,
// echoes `Mcp-Session-Id` when the server issues one, and sends
// `MCP-Protocol-Version` after initialize. No server-initiated streams.
//
// `adapters(client)` adds the Adapter MCP vocabulary on top: list, describe,
// query, check, apply and revert with the pinned references done for you.

import { MCP_PROTOCOL_VERSION, PROFILE_VERSION } from '../protocol/adapter/index.js';

/** A JSON-RPC error from the server (protocol level, not a tool outcome). */
export class McpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

/**
 * @param {Object} options
 * @param {string} options.url    the MCP endpoint
 * @param {string} [options.token]  bearer token
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 */
export function createMcpClient({ url, token, fetch: fetcher = globalThis.fetch.bind(globalThis), timeoutMs = 35000, clientInfo = { name: 'ai4a11y-adapter-mcp-client', version: '0.1.0' } }) {
  let nextId = 1;
  let sessionId = null;
  let protocolVersion = null;
  let initialized = null;

  async function post(message) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
    const response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) });
    const sid = response.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (!('id' in message)) return null;
    const type = response.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      const text = await response.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (parsed.id === message.id) return parsed;
      }
      throw new McpError(-32603, 'The server closed the stream without a response.');
    }
    const body = await response.json().catch(() => null);
    if (!body) throw new McpError(-32603, `The server answered ${response.status} without a JSON-RPC response.`);
    if (!response.ok && !body.jsonrpc) throw new McpError(-32603, body.message || body.error || `HTTP ${response.status}`, body);
    return body;
  }

  async function request(method, params) {
    const reply = await post({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) });
    if (reply.error) throw new McpError(reply.error.code, reply.error.message, reply.error.data);
    return reply.result;
  }

  async function initialize() {
    if (!initialized) {
      initialized = (async () => {
        const result = await request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo });
        protocolVersion = result.protocolVersion;
        await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        return result;
      })();
      initialized.catch(() => { initialized = null; });
    }
    return initialized;
  }

  return {
    initialize,
    async listTools() { await initialize(); return (await request('tools/list')).tools; },
    /** Returns the CallToolResult: {content, structuredContent, isError}. */
    async callTool(name, args = {}) { await initialize(); return request('tools/call', { name, arguments: args }); },
    async ping() { return request('ping'); },
  };
}

/**
 * The Adapter MCP vocabulary over an MCP client. Every call returns the
 * domain result (structuredContent) with `isError` attached.
 * @param {ReturnType<typeof createMcpClient>} client
 */
export function adapterClient(client) {
  const call = async (name, args) => {
    const r = await client.callTool(name, args);
    return { ...(r.structuredContent || {}), isError: r.isError === true, text: r.content?.find(c => c.type === 'text')?.text };
  };
  const ref = (d) => ({ appId: d.appId, id: d.id, version: d.version, descriptorDigest: d.descriptorDigest });
  return {
    list: (filters = {}) => call('adapter_list', filters),
    describe: (appId, id) => call('adapter_describe', { adapterRef: { appId, id } }),
    targets: (descriptor) => call('adapter_targets', { adapterRef: ref(descriptor) }),
    query: (descriptor, target, fields) => call('adapter_query', { adapterRef: ref(descriptor), target, ...(fields ? { fields } : {}) }),
    check: (descriptor, target, desired) => call('adapter_check', { adapterRef: ref(descriptor), target, desired }),
    apply: (descriptor, target, desired, requestKey) => call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref(descriptor), target, desired, ...(requestKey ? { requestKey } : {}) }),
    revert: (receiptId) => call('adapter_revert', { receiptId }),
  };
}
