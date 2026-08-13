// Generates the /v1/meta payload — and, via generateMarkdown(), server/API.md
// — by introspecting the LIVE route table (this file imports LIBRARIAN_ROUTES,
// the same data app.js dispatches from) and a real `librarian` instance built
// through the toolkit barrel (arity read off `fn.length`). Nothing here is a
// hand-written method list: add/remove/rename a route in routes.js and both
// /v1/meta and API.md (after `npm run docs`) follow without touching this
// file.

import { createToolkit } from '../../toolkit/index.js';
import { memoryKV } from '../../toolkit/adapters/node/kv.js';
import { LIBRARIAN_ROUTES } from './routes.js';

// The non-librarian HTTP surface, transcribed from CONTRACT.md's Endpoints
// table (the fixed wire contract server-test.mjs's contract-consistency check
// enforces this against). Kept as data — not prose baked into a handler — so
// meta.js and app.js can both read it and never drift from each other.
export const HTTP_ENDPOINTS = [
  { method: 'GET', path: '/healthz', auth: 'none', purpose: 'liveness: {ok:true, version}' },
  { method: 'GET', path: '/v1/meta', auth: 'none', purpose: 'generated service+API description' },
  { method: 'POST', path: '/v1/librarian/{method}', auth: 'bearer', purpose: "invoke a Librarian method for the token's uid" },
  { method: 'GET', path: '/v1/whoami', auth: 'bearer', purpose: '{uid, label} for the presented token' },
  { method: 'POST', path: '/admin/tokens', auth: 'admin', purpose: 'create token {uid, label?} -> {token, uid} (token shown once)' },
  { method: 'GET', path: '/admin/tokens', auth: 'admin', purpose: 'list {id, uid, label, createdAt, revoked} (no token values)' },
  { method: 'DELETE', path: '/admin/tokens/{id}', auth: 'admin', purpose: 'revoke' },
  { method: 'GET', path: '/admin', auth: 'none (page shell — data calls need the admin token typed into the page)', purpose: 'minimal HTML config interface' },
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
      tokens: 'admin/tokens.json',
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
  lines.push(`- Backends: ${meta.storage.backends.join(', ')}`);
  lines.push('');
  return lines.join('\n');
}
