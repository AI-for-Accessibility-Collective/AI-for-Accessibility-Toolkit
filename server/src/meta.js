// Generates the /v1/meta payload — and, via generateMarkdown(), server/API.md
// — by introspecting the LIVE route table (this file imports LIBRARIAN_ROUTES,
// the same data app.js dispatches from) and a real `librarian` instance built
// through the toolkit barrel (arity read off `fn.length`). Nothing here is a
// hand-written method list: add/remove/rename a route in routes.js and both
// /v1/meta and API.md (after `npm run docs`) follow without touching this
// file.

import { createToolkit } from '../../toolkit/index.js';
import { memoryKV } from '../../toolkit/platforms/node/kv.js';
import { LIBRARIAN_ROUTES } from './routes.js';

// The non-librarian HTTP surface, transcribed from CONTRACT.md's Endpoints
// table (the fixed wire contract server-test.mjs's contract-consistency check
// enforces this against). Kept as data — not prose baked into a handler — so
// meta.js and app.js can both read it and never drift from each other.
export const HTTP_ENDPOINTS = [
  { method: 'GET', path: '/healthz', auth: 'none', purpose: 'liveness: {ok:true, version}' },
  { method: 'GET', path: '/v1/healthz', auth: 'none', purpose: 'the same payload; the path deployed probes must use (the bare /healthz is intercepted at the run.app edge)' },
  { method: 'GET', path: '/v1/meta', auth: 'none', purpose: 'generated service+API description' },
  { method: 'GET', path: '/developer', auth: 'none (API calls require bearer)', purpose: 'developer profile manager; static assets under /developer/' },
  { method: 'POST', path: '/v1/librarian/{method}', auth: 'bearer', purpose: "invoke a Librarian method for the token's uid" },
  { method: 'GET', path: '/v1/whoami', auth: 'bearer', purpose: '{uid, label, kind} for the presented token' },
  { method: 'GET', path: '/v1/adapters', auth: 'bearer', purpose: 'list the adapter marketplace, grouped-by-app metadata included; filters ?app= ?kind= ?mine=1 ?installed=1 (mine/installed are per calling uid)' },
  { method: 'POST', path: '/v1/adapters', auth: 'bearer', purpose: 'register an adapter {appId, id, name, ...manifest, code?, appName?} -> 201 {adapter}; code present makes kind "code"' },
  { method: 'POST', path: '/v1/adapters/sync', auth: 'bearer', purpose: 'publish an app catalog in one call {appId, appName?, adapters: [...], full?}; upserts the caller\'s entries, skips another uid\'s, full:true also removes the caller\'s missing ones' },
  { method: 'GET', path: '/v1/adapters/{appId}/{id}', auth: 'bearer', purpose: '{adapter} for one listing' },
  { method: 'PUT', path: '/v1/adapters/{appId}/{id}', auth: 'bearer (registering uid) or admin', purpose: 'update the manifest; code present replaces/removes the code blob (empty string removes), absent leaves it' },
  { method: 'DELETE', path: '/v1/adapters/{appId}/{id}', auth: 'bearer (registering uid) or admin', purpose: 'remove the listing and its code blob' },
  { method: 'GET', path: '/v1/adapters/{appId}/{id}/code', auth: 'bearer', purpose: '{code, sha256, size, updatedAt} for a kind "code" listing; 404 for data-only' },
  { method: 'PUT', path: '/v1/adapters/{appId}/{id}/install', auth: 'bearer', purpose: "mark installed in the calling uid's state -> {ok, installed:true}" },
  { method: 'DELETE', path: '/v1/adapters/{appId}/{id}/install', auth: 'bearer', purpose: 'clear it -> {ok, installed:false}' },
  { method: 'GET', path: '/sdk/adapter-mcp.js', auth: 'none (public code, any origin)', purpose: 'the Adapter MCP SDK entry point for apps; its modules are under /sdk/toolkit/' },
  { method: 'GET', path: '/skill/ai4a11y-toolkit/SKILL.md', auth: 'none (public, any origin)', purpose: 'the toolkit skill for coding agents (Claude Code, opencode); its helper is /skill/ai4a11y-toolkit/scripts/adapter.mjs' },
  { method: 'POST', path: '/v1/auth/login', auth: 'none (rate limited)', purpose: 'developer sign-in {username, password} -> {token (session, expires), expiresAt, account, defaultToken}' },
  { method: 'POST', path: '/v1/auth/logout', auth: 'session', purpose: 'end this sign-in session' },
  { method: 'GET', path: '/v1/account', auth: 'session', purpose: '{account, defaultToken, tokens, session, liveApps} for the signed-in account' },
  { method: 'PUT', path: '/v1/account', auth: 'session', purpose: 'rename the signed-in account {displayName} -> {account}; the username stays the same' },
  { method: 'POST', path: '/v1/account/default-token', auth: 'session', purpose: 'regenerate the default token -> {defaultToken}; the old one is revoked and its apps disconnect' },
  { method: 'POST', path: '/v1/account/tokens', auth: 'session', purpose: 'make an app token {label?} -> {token, id, label} (shown once)' },
  { method: 'DELETE', path: '/v1/account/tokens/{id}', auth: 'session', purpose: "revoke one of the account's tokens" },
  { method: 'POST', path: '/v1/account/password', auth: 'session', purpose: 'change password {current, next}; signs out other sessions' },
  { method: 'GET', path: '/v1/account/presets', auth: 'session', purpose: "{presets} saved profile presets for the developer console" },
  { method: 'PUT', path: '/v1/account/presets', auth: 'session', purpose: 'replace the saved presets {presets: [{id, name, description?, profile}]}' },
  { method: 'POST', path: '/v1/mcp', auth: 'bearer', purpose: 'the adapter registry, an MCP server (POST JSON-RPC): tools adapter_search, adapter_get, adapter_publish, adapter_share, adapter_delete, adapter_install, adapter_uninstall, adapter_installed, adapter_report, adapter_status; resources adapter://owner/appId/id' },
  { method: 'GET', path: '/v1/mcp', auth: 'bearer', purpose: 'server-sent events (Accept: text/event-stream): notifications/resources/list_changed when an adapter the account can see changes, its installs change, or a runtime reports' },
  { method: 'POST', path: '/v1/providers', auth: 'bearer (app or default token)', purpose: 'register an Adapter MCP app instance {providerId?, label?, application, adapters: [descriptor]} -> {providerId, endpoints}' },
  { method: 'DELETE', path: '/v1/providers/{providerId}', auth: 'bearer (the registering token)', purpose: 'sign the instance off' },
  { method: 'GET', path: '/v1/providers/{providerId}/channel', auth: 'bearer (the registering token)', purpose: 'server-sent events: each `request` event is one relayed MCP JSON-RPC message' },
  { method: 'POST', path: '/v1/providers/{providerId}/channel', auth: 'bearer (the registering token)', purpose: 'the instance answers one relayed request with its JSON-RPC response -> 204' },
  { method: 'POST', path: '/v1/mcp/providers/{providerId}', auth: 'bearer (same account)', purpose: 'MCP Streamable HTTP endpoint (POST JSON-RPC, JSON response) for one connected instance' },
  { method: 'POST', path: '/v1/mcp/apps/{appId}', auth: 'bearer (same account)', purpose: "MCP endpoint for the app's one live instance; an error names the instance endpoints when several are connected" },
  { method: 'GET', path: '/v1/profile/selection', auth: 'bearer', purpose: 'the preset last loaded with replaceProfile: {revision, selected: {id, name, edited} or null, updatedAt}' },
  { method: 'GET', path: '/v1/profile/events', auth: 'bearer', purpose: 'server-sent events: a `profile` event (the same object as /v1/profile/selection) on connecting and on every profile write, with no profile content; read that with getProfile' },
  { method: 'GET', path: '/v1/profile/presets', auth: 'bearer', purpose: "the presets an app can choose from, the console's built-in ones then the account's saved ones: {presets: [{id, name, description, builtIn}]}" },
  { method: 'POST', path: '/v1/profile/select', auth: 'bearer', purpose: 'make a preset the active profile, as the console does when it loads one {id} -> {revision, selected, updatedAt, profile}' },
  { method: 'GET', path: '/v1/apps', auth: 'bearer', purpose: "the account's connected apps grouped by app: {apps: [{appId, name, live, hidden, connections, adapters, endpoint}], hiddenApps}" },
  { method: 'DELETE', path: '/v1/apps/{appId}', auth: 'bearer', purpose: 'forget an app that is not connected (it returns when it connects again)' },
  { method: 'PUT', path: '/v1/apps/{appId}/hidden', auth: 'bearer', purpose: 'hide the app in the developer console (Apps and Listings)' },
  { method: 'DELETE', path: '/v1/apps/{appId}/hidden', auth: 'bearer', purpose: 'show it again' },
  { method: 'GET', path: '/admin/accounts', auth: 'admin', purpose: "list accounts {accounts: [{uid, displayName, disabled, createdAt, lastLoginAt, passwordSetBy, passwordKept, appTokens, sessions, liveApps, hasData}]}; with ?passwords=1, every account's admin-issued password {passwords: [{uid, displayName, password|null, reason?}]} (reason: changed-by-account, not-kept or unreadable); with ?format=csv, a download of every account with its password, status and last sign-in" },
  { method: 'POST', path: '/admin/accounts', auth: 'admin', purpose: 'make an account {uid, displayName?, password?} -> 201 {account, password?} (a generated password is returned; GET …/password shows it again)' },
  { method: 'POST', path: '/admin/accounts/bulk', auth: 'admin', purpose: 'make many {accounts: [{uid, displayName?}]} -> {results: [{uid, ok, password?|error}]}' },
  { method: 'PUT', path: '/admin/accounts/{uid}', auth: 'admin', purpose: 'rename {displayName}' },
  { method: 'GET', path: '/admin/accounts/{uid}/password', auth: 'admin', purpose: 'the password an admin issued {uid, password|null, reason?}; null once the developer changed it themselves' },
  { method: 'POST', path: '/admin/accounts/{uid}/password', auth: 'admin', purpose: 'reset the password {password?} -> {password?}; signs the account out everywhere' },
  { method: 'POST', path: '/admin/accounts/{uid}/disable', auth: 'admin', purpose: 'turn the account off: revokes every token and disconnects its apps' },
  { method: 'POST', path: '/admin/accounts/{uid}/enable', auth: 'admin', purpose: 'turn it back on (a new default token at the next sign-in)' },
  { method: 'DELETE', path: '/admin/accounts/{uid}', auth: 'admin', purpose: 'delete the account, its data and its tokens' },
  { method: 'GET', path: '/admin/assets/console.js', auth: 'none (public code)', purpose: "the admin console's script" },
  { method: 'POST', path: '/admin/tokens', auth: 'admin', purpose: 'create token {uid, label?, kind?: "app"|"default"} -> {token, uid} (token shown once)' },
  { method: 'GET', path: '/admin/tokens', auth: 'admin', purpose: 'list {id, uid, label, kind, createdAt, expiresAt?, revoked} (no token values)' },
  { method: 'DELETE', path: '/admin/tokens/{id}', auth: 'admin', purpose: 'revoke' },
  { method: 'GET', path: '/admin/users', auth: 'admin', purpose: 'list {users: uid[]}, every uid holding stored state' },
  { method: 'DELETE', path: '/admin/users/{uid}', auth: 'admin', purpose: "delete that uid's partition and revoke its tokens -> {ok, uid, revokedTokens} (a count); 404 when the uid had neither data nor live tokens" },
  { method: 'GET', path: '/admin', auth: 'admin (HTTP Basic. An unauthenticated GET answers 401 + WWW-Authenticate, so the browser prompts, then attaches the cached credential to the page\'s own fetches; browser POSTs must be same-origin JSON)', purpose: 'admin console: accounts, tokens, stored data' },
];

/** Build the librarian method table by constructing one throwaway toolkit
 *  instance over an in-memory KV (never persisted, never touches the real
 *  store) purely to read real method references off it. */
function introspectLibrarianMethods() {
  const { librarian } = createToolkit({ kv: memoryKV() });
  return LIBRARIAN_ROUTES.map((entry) => {
    if (entry.kind === 'datastore' || entry.kind === 'custom-librarian') {
      // Entries with their own invoke() aren't a single librarian method —
      // describe them from the route entry itself.
      return {
        route: entry.route,
        target: entry.target,
        alias: entry.route !== entry.target,
        kind: entry.kind,
        arity: entry.kind === 'datastore' ? 0 : null,
        supported: true,
        note: entry.note,
      };
    }
    const fn = librarian[entry.target];
    return {
      route: entry.route,
      target: entry.target,
      alias: entry.route !== entry.target,
      kind: entry.kind,
      arity: typeof fn === 'function' ? fn.length : null,
      supported: typeof fn === 'function',
    };
  });
}

export function buildMeta({ version = '0.0.0' } = {}) {
  const methods = introspectLibrarianMethods();
  return {
    ok: true,
    version,
    generatedAt: new Date().toISOString(),
    endpoints: HTTP_ENDPOINTS,
    librarian: {
      base: '/v1/librarian/{method}',
      body: '{"args": [...]} — positional arguments exactly as the in-process method takes them. Missing body = {"args": []}.',
      success: '200 {"ok":true, "result": <return value>}',
      failure: '200 {"ok":false, "error": "<message>"} (application errors are data, not transport failures)',
      unknownMethod: '404 {"error":"unknown-method"}',
      methodCount: methods.length,
      unsupportedCount: methods.filter((m) => !m.supported).length,
      methods,
    },
    llm: {
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      wiredVia: 'librarian.setGeminiCaller(serverGeminiCaller) at boot (server/src/gemini.js)',
      freeWithoutClientKey: ['extract', 'reflect', 'buildSkill', 'interpretNeedsPrompt'],
      note: "Server holds GEMINI_API_KEY. Without it, the caller throws 'no-server-key' the moment the slow lane tries to use it — the fast lane (everything else) is unaffected. Applications making their own direct LLM calls keep using their own keys; nothing here proxies arbitrary LLM traffic.",
    },
    storage: {
      kv: 'areas local/sync per uid -> users/<uid>/<area>.json',
      tokens: 'admin/tokens.json (hashes only; kinds app, default, session)',
      accounts: 'admin/accounts.json (scrypt password hashes)',
      apps: 'users/<uid>/apps.json (last-known app registrations), users/<uid>/console.json (hidden apps, presets) and users/<uid>/activity.json (the last 200 MCP calls)',
      backends: ['file (DATA_DIR)', 'gcs (TOOLKIT_BUCKET)'],
    },
  };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|');
}

/** Render the same data buildMeta() returns as server/API.md. Pass the result
 *  of buildMeta() (or nothing, to build+render in one call). */
export function generateMarkdown(meta = buildMeta()) {
  const lines = [];
  lines.push('# Toolkit Service API');
  lines.push('');
  lines.push(
    `_Generated ${meta.generatedAt} by \`server/scripts/generate-docs.mjs\` from the live route table ` +
      `(\`server/src/routes.js\`) and the Librarian method list (\`toolkit/core/librarian.js\`, introspected ` +
      `through the \`toolkit/index.js\` barrel). Do not hand-edit — re-run \`npm run docs\`._`
  );
  lines.push('');
  lines.push(`Version: \`${meta.version}\``);
  lines.push('');
  lines.push('## Endpoints');
  lines.push('');
  lines.push('| Method | Path | Auth | Purpose |');
  lines.push('|---|---|---|---|');
  for (const e of meta.endpoints) {
    lines.push(`| ${e.method} | \`${e.path}\` | ${e.auth} | ${mdEscape(e.purpose)} |`);
  }
  lines.push('');
  lines.push('## `/v1/librarian/{method}`');
  lines.push('');
  lines.push(meta.librarian.body);
  lines.push('');
  lines.push(`- Success: \`${meta.librarian.success}\``);
  lines.push(`- Application error: \`${meta.librarian.failure}\``);
  lines.push(`- Unknown method: \`${meta.librarian.unknownMethod}\``);
  lines.push('');
  lines.push(`### Methods (${meta.librarian.methodCount}, ${meta.librarian.unsupportedCount} unsupported)`);
  lines.push('');
  lines.push('`{method}` is the route (`{"method"}` segment in the POST path). `target` is the underlying');
  lines.push('Librarian (or, for `shareAudit`, datastore) call it resolves to; `alias` marks the 7 routes');
  lines.push('whose wire name differs from the call it makes.');
  lines.push('');
  lines.push('| Route | Target | Alias? | Arity | Kind |');
  lines.push('|---|---|---|---|---|');
  for (const m of meta.librarian.methods) {
    lines.push(`| \`${m.route}\` | \`${m.target}\` | ${m.alias ? 'yes' : ''} | ${m.arity ?? '—'} | ${m.kind} |`);
  }
  lines.push('');
  lines.push('## Server-side LLM');
  lines.push('');
  lines.push(`Provider: **${meta.llm.provider}** (\`${meta.llm.model}\`). Wired via ${meta.llm.wiredVia}.`);
  lines.push('');
  lines.push(`Free without a client-supplied key: ${meta.llm.freeWithoutClientKey.map((m) => `\`${m}\``).join(', ')}.`);
  lines.push('');
  lines.push(meta.llm.note);
  lines.push('');
  lines.push('## Storage');
  lines.push('');
  lines.push(`- KV: ${meta.storage.kv}`);
  lines.push(`- Tokens: ${meta.storage.tokens}`);
  lines.push(`- Accounts: ${meta.storage.accounts}`);
  lines.push(`- Apps: ${meta.storage.apps}`);
  lines.push(`- Backends: ${meta.storage.backends.join(', ')}`);
  lines.push('');
  return lines.join('\n');
}
