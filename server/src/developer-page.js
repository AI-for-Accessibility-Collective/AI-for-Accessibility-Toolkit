import { readFileSync } from 'node:fs';

// Explicit assets only: never resolve a filesystem path from user input.
export const DEVELOPER_ASSETS = new Map([
  ['/developer', 'index.html', 'text/html'],
  ['/developer/', 'index.html', 'text/html'],
  ['/developer/styles.css', 'styles.css', 'text/css'],
  ['/developer/app.js', 'app.js', 'text/javascript'],
  ['/developer/adapters.js', 'adapters.js', 'text/javascript'],
  ['/developer/listings.js', 'listings.js', 'text/javascript'],
  ['/developer/client.js', 'client.js', 'text/javascript'],
  ['/developer/value-editor.js', 'value-editor.js', 'text/javascript'],
  ['/developer/profiles.js', 'profiles.js', 'text/javascript'],
  ['/developer/apps.js', 'apps.js', 'text/javascript'],
  ['/developer/account.js', 'account.js', 'text/javascript'],
  ['/developer/console.css', 'console.css', 'text/css'],
].map(([path, file, type]) => [path, {
  body: readFileSync(new URL(`../developer/${file}`, import.meta.url)),
  type: `${type}; charset=utf-8`,
}]));

export function serveDeveloperAsset(res, asset) {
  res.writeHead(200, {
    'content-type': asset.type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http: https:; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(asset.body);
}
