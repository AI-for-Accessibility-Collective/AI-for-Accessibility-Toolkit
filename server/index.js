#!/usr/bin/env node
// Boot: read env, build the store + gemini caller + toolkit host, start the
// HTTP server. Env:
//   PORT            default 8080
//   ADMIN_PASSWORD  required in production (NODE_ENV=production); a dev
//                   default is used otherwise so `node server/index.js` works
//                   out of the box for local iteration, with a loud warning.
//   GEMINI_API_KEY  optional — without it the slow lane (extract/reflect/
//                   buildSkill/interpretNeedsPrompt) throws 'no-server-key'
//                   when actually invoked; the fast lane is unaffected.
//   TOOLKIT_BUCKET  set -> gcsStore(bucket); unset -> fileStore(DATA_DIR)
//   DATA_DIR        default ./data (only used when TOOLKIT_BUCKET is unset)
//   CORS_ORIGINS    comma-separated browser origins allowed to call /v1, or *
//   TOKEN_SECRET    optional HMAC key for account default tokens; defaults to
//                   ADMIN_PASSWORD (changing either issues new default tokens)
//   --workshop      flag: CORS_ORIGINS=* for a local workshop (refused in production)
//   LOG_FORMAT      json | text; default json on Cloud Run (K_SERVICE set), else text
//   LOG_LEVEL       debug | info | warn | error; default info

import http from 'node:http';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createApp } from './src/app.js';
import { createStore } from './src/store.js';
import { createGeminiCaller } from './src/gemini.js';
import { createToolkitHost } from './src/toolkit-host.js';
import { createLogger } from './src/log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

function boot() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 8080;
  const log = createLogger({
    format: process.env.LOG_FORMAT || (process.env.K_SERVICE ? 'json' : 'text'),
    level: process.env.LOG_LEVEL || 'info',
  });
  // Anything that escapes a request handler still reaches the log, with its stack.
  process.on('unhandledRejection', (e) => log.error('process.unhandled-rejection', { error: e }));
  process.on('uncaughtException', (e) => { log.error('process.uncaught-exception', { error: e }); process.exit(1); });

  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (isProd) {
      log.error('config.invalid', { message: 'ADMIN_PASSWORD is required when NODE_ENV=production. Exiting.' });
      process.exit(1);
    }
    adminPassword = 'dev-admin-password';
    log.warn('config.dev-admin-password', {
      message: `ADMIN_PASSWORD not set — using an insecure dev default (${adminPassword}). Set ADMIN_PASSWORD for anything beyond local iteration.`,
    });
  }

  const bucket = process.env.TOOLKIT_BUCKET || null;
  const dataDir = process.env.DATA_DIR || './data';
  const store = createStore({ bucket, dataDir });
  if (isProd && !bucket) log.warn('config.local-storage', { message: `NODE_ENV=production without TOOLKIT_BUCKET: data is written to ${dataDir}, which a container loses when it stops.` });

  const geminiApiKey = process.env.GEMINI_API_KEY || null;
  const geminiCaller = createGeminiCaller({ apiKey: geminiApiKey });

  const toolkitHost = createToolkitHost({ store, geminiCaller });

  let corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  // --workshop: any web page (Redbird on localhost:8000, a participant's own
  // app) may call /v1 with a token it holds. Safe because /v1 authenticates
  // with bearer tokens only, never cookies; see CONTRACT.md.
  if (process.argv.includes('--workshop')) {
    if (isProd) {
      log.error('config.invalid', { message: '--workshop is for local workshops; set CORS_ORIGINS explicitly in production. Exiting.' });
      process.exit(1);
    }
    corsOrigins = ['*'];
  }
  const tokenSecret = process.env.TOKEN_SECRET || undefined;
  const listener = createApp({ store, adminPassword, toolkitHost, version: pkg.version, corsOrigins, tokenSecret, log });
  const server = http.createServer(listener);
  server.listen(port, () => {
    log.info('server.started', {
      port, version: pkg.version,
      storage: bucket ? `gcs:${bucket}` : `file:${dataDir}`,
      gemini: geminiApiKey ? 'configured' : 'none',
      cors: corsOrigins.includes('*') ? 'any origin' : corsOrigins.join(',') || 'same origin only',
      tokenSecret: tokenSecret ? 'TOKEN_SECRET' : 'admin password',
    });
    if (!process.env.K_SERVICE) {
      console.log(`[toolkit-service] developer console: http://localhost:${port}/developer`);
      console.log(`[toolkit-service] admin console:     http://localhost:${port}/admin (any username, the admin password)`);
    }
  });

  // Cloud Run sends SIGTERM and allows 10 seconds: stop taking requests,
  // tell connected apps (they reconnect to the next instance), and write the
  // activity still buffered in memory before exiting.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info('server.stopping', { signal });
    const force = setTimeout(() => { log.warn('server.stop.forced', { signal }); process.exit(0); }, 8000);
    force.unref();
    server.close();
    listener.relay.closeAll();
    listener.registry.closeAll();
    server.closeIdleConnections?.();
    try { await listener.activity.flush(); } catch (e) { log.error('server.stop.flush-failed', { error: e }); }
    log.info('server.stopped', { signal });
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

// Only boot when run directly (`node index.js`), not when imported (e.g. by
// a future test that wants the boot() function itself). Compare decoded
// filesystem paths, not URL strings: import.meta.url is percent-encoded, so a
// raw `file://` + argv comparison fails on paths with spaces or `~` (e.g. an
// iCloud checkout) and the server would silently never start.
// Both sides resolved through the filesystem: Node realpaths the main
// module's URL but not argv[1], so a symlinked or extension-less entry
// (`node server/index`) would otherwise never boot.
function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  boot();
}

export { boot };
