// The adapter runtime's user scripts, run in a Node vm that stands in for
// one page's USER_SCRIPT world: what enable/disable see, what gets reported,
// and that an update or teardown turns the earlier copy off. Plus the
// vendored-module drift check.
//
//   node extension/test/runtime.test.mjs

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildUserScript, teardownScript, registrationFor, runnable, scriptId } from '../runtime/scripts.js';
import { isAllowedServerUrl } from '../runtime/config.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

// One page: a shared global (the USER_SCRIPT world) and the reports it sent.
function page(href) {
  const u = new URL(href);
  const reports = [];
  const log = [];
  const context = vm.createContext({
    location: { href, origin: u.origin, protocol: u.protocol, hostname: u.hostname, port: u.port, pathname: u.pathname },
    chrome: { runtime: { sendMessage: (m) => reports.push(m) } },
    log: (x) => log.push(x),
    Promise, RegExp, Object, JSON, String, Error, setTimeout,
  });
  return { run: (code) => vm.runInContext(code, context), reports, log, context };
}
const settle = () => new Promise(r => setTimeout(r, 0));

const CODE = (tag, extra = '') => `export const A = {
  enabled: false,
  enable(options = {}) { this.enabled = true; log('enable ${tag} ' + JSON.stringify(options)); ${extra} },
  disable() { this.enabled = false; log('disable ${tag}'); },
};`;
const entry = (fields = {}) => ({
  adapter: { owner: 'ada', appId: 'console', id: 'big-buttons' }, available: true, enabled: true,
  revision: 1, urlPatterns: ['https://shop.example/*', 'http://localhost/*'], sites: {},
  package: { format: 'web-module@1', code: CODE('r1') }, ...fields,
});

await test('in scope: the adapter is enabled with its parameters and reports applied', async () => {
  const p = page('https://shop.example/cart?x=1');
  p.run(buildUserScript(entry({ parameters: { size: 48 } })));
  await settle();
  assert.deepEqual(p.log, ['enable r1 {"size":48}']);
  assert.deepEqual(p.reports.map(r => [r.key, r.revision, r.origin, r.status]), [['ada/console/big-buttons', 1, 'https://shop.example', 'applied']]);
  assert.ok(!JSON.stringify(p.reports).includes('cart'), 'only the origin is reported');
});

await test('the exact URL check: a host Chrome\'s broad pattern lets through does not run', async () => {
  const p = page('https://shop.example.evil.org/');
  p.run(buildUserScript(entry()));
  await settle();
  assert.deepEqual([p.log, p.reports], [[], []]);
  const local = page('http://localhost:8080/products');
  local.run(buildUserScript(entry()));
  await settle();
  assert.deepEqual(local.log, ['enable r1 {}'], 'a pattern without a port matches any port');
});

await test('a site switched off is skipped', async () => {
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry({ sites: { 'https://shop.example': false } })));
  await settle();
  assert.deepEqual(p.log, []);
  assert.deepEqual(p.reports.map(r => [r.status, r.message]), [['skipped', 'switched off on this site']]);
});

await test('a new revision turns the old one off first, so nothing stacks', async () => {
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry()));
  p.run(buildUserScript(entry({ revision: 2, package: { format: 'web-module@1', code: CODE('r2') } })));
  await settle();
  assert.deepEqual(p.log, ['enable r1 {}', 'disable r1', 'enable r2 {}']);
  assert.deepEqual(p.reports.map(r => [r.revision, r.status]), [[1, 'applied'], [2, 'applied']]);
  assert.equal(p.context.__ai4a11yRuntime.adapters['ada/console/big-buttons'].revision, 2);
});

await test('teardown disables a running adapter and reports removed; on a page without it, nothing', async () => {
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry()));
  p.run(teardownScript('ada/console/big-buttons'));
  await settle();
  assert.deepEqual(p.log, ['enable r1 {}', 'disable r1']);
  assert.deepEqual(p.reports.map(r => r.status), ['applied', 'removed']);
  const other = page('https://other.example/');
  other.run(teardownScript('ada/console/big-buttons'));
  assert.deepEqual(other.reports, []);
});

await test('an async enable() turned off before it finishes does not report applied afterwards', async () => {
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry({ package: { format: 'web-module@1', code: CODE('slow', 'return new Promise(r => setTimeout(r, 5));') } })));
  p.run(teardownScript('ada/console/big-buttons'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(p.reports.map(r => r.status), ['removed']);
});

await test('a scope change that leaves the page out turns the running copy off', async () => {
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry()));
  p.run(buildUserScript(entry({ revision: 2, urlPatterns: ['https://elsewhere.example/*'] })));
  await settle();
  assert.deepEqual(p.log, ['enable r1 {}', 'disable r1']);
  assert.deepEqual(p.reports.map(r => r.status), ['applied', 'removed']);
});

await test('failures are reported with the reason: a throw, a rejection, a load error, enable() returning false', async () => {
  const cases = [
    [CODE('x', "throw new Error('no buttons');"), /enable\(\) threw: no buttons/],
    [CODE('x', "return Promise.reject(new Error('later'));"), /enable\(\) failed: later/],
    ['export const A = { enable() {}, disable() {} }; undefinedThing();', /Loading the adapter: .*undefinedThing/],
    ['export const A = 1;', /does not export exactly one adapter/],
  ];
  for (const [code, pattern] of cases) {
    const p = page('https://shop.example/');
    p.run(buildUserScript(entry({ package: { format: 'web-module@1', code } })));
    await settle(); await settle();
    assert.equal(p.reports.at(-1).status, 'failed', String(pattern));
    assert.match(p.reports.at(-1).message, pattern);
    assert.equal(p.context.__ai4a11yRuntime.adapters['ada/console/big-buttons'], undefined, 'a failed adapter is not left as running');
  }
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry({ package: { format: 'web-module@1', code: CODE('x', 'return false;') } })));
  await settle();
  assert.deepEqual(p.reports.map(r => r.status), ['skipped']);
});

await test('a named entry picks one of several adapters', async () => {
  const code = `${CODE('a')}\nexport const B = { enable() { log('enable b'); }, disable() {} };`;
  const p = page('https://shop.example/');
  p.run(buildUserScript(entry({ package: { format: 'web-module@1', code, entry: 'B' } })));
  await settle();
  assert.deepEqual(p.log, ['enable b']);
});

await test('registrations: only runnable adapters, Chrome patterns without ports, a script id without slashes', () => {
  const list = [
    entry(),
    entry({ adapter: { owner: 'bo', appId: 'redbird', id: 'off' }, enabled: false }),
    entry({ adapter: { owner: 'bo', appId: 'redbird', id: 'gone' }, available: false, package: undefined }),
    entry({ adapter: { owner: 'bo', appId: 'xr', id: 'desc' }, package: undefined }),
  ];
  assert.deepEqual(runnable(list).map(a => a.adapter.id), ['big-buttons']);
  const reg = registrationFor(entry({ urlPatterns: ['http://localhost:8080/*'] }));
  assert.equal(reg.id, 'rt-ada~console~big-buttons');
  assert.deepEqual(reg.matches, ['http://localhost/*']);
  assert.deepEqual([reg.world, reg.runAt, reg.allFrames], ['USER_SCRIPT', 'document_idle', false]);
  assert.equal(scriptId('a/b/c'), 'rt-a~b~c');
});

await test('the runtime sends a token only to https or this computer', () => {
  for (const ok of ['https://toolkit.example', 'http://localhost:8080', 'http://127.0.0.1:9', 'http://[::1]:8080']) assert.equal(isAllowedServerUrl(ok), true, ok);
  for (const bad of ['http://toolkit.example', 'ftp://localhost', 'http://localhost.evil.org', 'https://user:pw@toolkit.example', '', 'nonsense']) assert.equal(isAllowedServerUrl(bad), false, bad);
});

await test('extension/vendor matches the toolkit modules', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.mjs'), '--check'], { stdio: 'pipe' });
});

console.log(`\nAdapter runtime: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
