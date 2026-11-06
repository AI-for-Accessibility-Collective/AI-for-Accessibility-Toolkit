#!/usr/bin/env node
// Run the XR bridge beside the AI for Accessibility XR guide (bridge.js says
// what it does). Only for that app: it stops if XR_URL does not answer like it.
//
//   node toolkit/hosts/xr-bridge/run.mjs          (or: npm run xr:bridge)
//
// It reads, from the environment or a .env file in this folder or one above:
//   TOOLKIT_URL, TOOLKIT_TOKEN   the toolkit and the account's default token
//                                (the developer console's two lines)
//   XR_URL                       the XR guide's server (default http://localhost:3000)
//   XR_BRIDGE_TOKEN              its BRIDGE_TOKEN (or XR_ADMIN_PASSWORD, its ADMIN_PASSWORD)
// Ctrl+C stops it; the XR guide keeps running as it was.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createXrBridge, XR_APP } from './bridge.js';

const KEYS = ['TOOLKIT_URL', 'TOOLKIT_TOKEN', 'XR_URL', 'XR_BRIDGE_TOKEN', 'XR_ADMIN_PASSWORD'];
function loadDotEnv() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && KEYS.includes(m[1]) && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}

loadDotEnv();
const env = process.env;
const bridge = createXrBridge({
  toolkitUrl: env.TOOLKIT_URL, toolkitToken: env.TOOLKIT_TOKEN,
  xrUrl: env.XR_URL || 'http://localhost:3000', xrToken: env.XR_BRIDGE_TOKEN, xrPassword: env.XR_ADMIN_PASSWORD,
  log: (event, fields = {}) => {
    const said = {
      'xr-bridge.toolkit': () => `Toolkit: ${fields.state}${fields.message ? ` (${fields.message})` : ''}`,
      'xr-bridge.store-open': () => 'The XR guide opened a profile (a phone session): following the toolkit profile.',
      'xr-bridge.followed': () => `Wrote the toolkit profile's ${fields.written.join(', ')} into the XR guide.`,
    }[event];
    console.log(said ? said() : `${event}${Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''}`);
  },
});

try {
  const started = await bridge.start();
  console.log(`${XR_APP.name} is connected to ${env.TOOLKIT_URL}: it shows under Apps in the developer console.`);
  console.log(started.storeOpen
    ? `Following the toolkit profile${started.followed.length ? ` (wrote ${started.followed.join(', ')})` : ''}.`
    : 'The XR guide has no profile open yet: it follows the toolkit profile once the phone app connects.');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const stop = async () => { await bridge.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
