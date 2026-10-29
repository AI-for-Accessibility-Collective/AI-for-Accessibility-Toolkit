// GET /admin — the admin console. The page sits behind the browser's native
// HTTP Basic login popup (app.js answers an unauthenticated GET with 401 +
// WWW-Authenticate, so the browser prompts, caches the credential for the
// session — remembered by default — and offers to save it in the password
// manager). Every data call the console makes is a plain same-origin fetch():
// the browser attaches the cached Basic credential automatically, so the page
// holds no password of its own.
//
// The HTML is gated; its script is public code with no data in it, served
// from an explicit list like the developer console's assets.

import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../admin/index.html', import.meta.url));

export const ADMIN_ASSETS = new Map([
  ['/admin/assets/console.js', { body: readFileSync(new URL('../admin/console.js', import.meta.url)), type: 'text/javascript; charset=utf-8' }],
]);

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

export function serveAdminPage(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(PAGE);
}

export function serveAdminAsset(res, asset) {
  res.writeHead(200, { 'content-type': asset.type, ...SECURITY_HEADERS });
  res.end(asset.body);
}
