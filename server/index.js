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

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createApp } from './src/app.js';
import { createStore } from './src/store.js';
import { createGeminiCaller } from './src/gemini.js';
import { createToolkitHost } from './src/toolkit-host.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

function boot() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 8080;

  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (isProd) {
      console.error('ADMIN_PASSWORD is required when NODE_ENV=production. Exiting.');
      process.exit(1);
    }
    adminPassword = 'dev-admin-password';
    console.warn(
      `[toolkit-service] ADMIN_PASSWORD not set — using an insecure dev default ` +
        `(${adminPassword}). Set ADMIN_PASSWORD for anything beyond local iteration.`
    );
  }

  const bucket = process.env.TOOLKIT_BUCKET || null;
  const dataDir = process.env.DATA_DIR || './data';
  const store = createStore({ bucket, dataDir });
  console.log(`[toolkit-service] storage: ${bucket ? `gcs bucket=${bucket}` : `file dir=${dataDir}`}`);

  const geminiApiKey = process.env.GEMINI_API_KEY || null;
  const geminiCaller = createGeminiCaller({ apiKey: geminiApiKey });
  console.log(`[toolkit-service] gemini: ${geminiApiKey ? 'key configured' : 'NO KEY (slow lane disabled server-side)'}`);

  const toolkitHost = createToolkitHost({ store, geminiCaller });

  const listener = createApp({ store, adminPassword, toolkitHost, version: pkg.version });
  const server = http.createServer(listener);
  server.listen(port, () => {
    console.log(`[toolkit-service] listening on :${port} (version ${pkg.version})`);
  });
  return server;
}

// Only boot when run directly (`node index.js`), not when imported (e.g. by
// a future test that wants the boot() function itself).
if (import.meta.url === `file://${process.argv[1]}`) {
  boot();
}

export { boot };
