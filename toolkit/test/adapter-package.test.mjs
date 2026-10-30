// Shareable adapter packages and the registry wire contract
// (toolkit/protocol/adapter/package.js and registry.js; adapter-mcp.md §14).
//
//   node toolkit/test/adapter-package.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  rewriteExports, moduleFactorySource, instantiateWebModule, pickAdapter, lintWebModule,
  checkPackage, artifactDigest, chromeMatchPatterns, urlPatternRegExpSource, normalizedUrl,
  webUrlPatterns, matchUrlPattern, checkSchema, validate, defineDescriptor,
  REGISTRY_TOOL_SCHEMAS, REGISTRY_TOOLS, REGISTRY_TOOL_DESCRIPTIONS, WEB_MODULE,
} from '../protocol/adapter/index.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.message); }
}

const STARTER = `// My Adapter: makes buttons bigger.
function grow(el) { el.style.minHeight = '44px'; }

export const BigButtons = {
  enabled: false,
  changed: [],
  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.size = options.size || 44;
  },
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
  },
};
`;

const descriptor = (fields = {}) => defineDescriptor({
  appId: 'console', id: 'big-buttons', name: 'Big buttons', description: 'Bigger buttons.', version: '1.0.0',
  targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }], ...fields,
});

await test('the Redbird starter shape runs as a factory and its adapter is found', () => {
  const adapter = instantiateWebModule(STARTER);
  assert.equal(typeof adapter.enable, 'function');
  adapter.enable({ size: 50 });
  assert.equal(adapter.enabled, true);
  assert.equal(adapter.size, 50);
  adapter.disable();
  assert.equal(adapter.enabled, false);
});

await test('every export form becomes part of the returned object', () => {
  const code = [
    'const helper = 1;',
    'export function f() { return helper; }',
    'export async function g() {}',
    'export class C {}',
    'export let n = 2;',
    'const local = { enable() {}, disable() {} };',
    'export { local as Adapter, helper };',
    'export default { enable() {}, disable() {}, kind: "default" };',
  ].join('\n');
  const { names, errors } = rewriteExports(code);
  assert.deepEqual(errors, []);
  assert.deepEqual(names.sort(), ['Adapter', 'C', 'default', 'f', 'g', 'helper', 'n'].sort());
  const exports = new Function(`return ${moduleFactorySource(code)}`)()();
  assert.equal(exports.f(), 1);
  assert.equal(exports.n, 2);
  assert.equal(exports.helper, 1);
  assert.equal(typeof exports.C, 'function');
  assert.equal(pickAdapter(exports).kind, 'default', 'the default export wins');
  assert.equal(pickAdapter(exports, 'Adapter'), exports.Adapter);
});

await test('imports and re-exports are refused with the line', () => {
  assert.match(rewriteExports("import x from './x.js';\nexport const A = x;").errors[0], /line 1: import is not supported/);
  assert.match(rewriteExports("export { a } from './a.js';").errors[0], /export … from is not supported/);
  assert.match(rewriteExports('const m = await import("./m.js");').errors[0], /import is not supported/);
  assert.match(rewriteExports('export * from "./all.js";').errors[0], /this form of export is not supported/);
  assert.throws(() => moduleFactorySource('import "x";'), /import is not supported/);
  assert.deepEqual(rewriteExports('const important = 1; export const A = { enable() {}, disable() {} };').errors, [], '"important" is not an import');
});

await test('the adapter is picked by entry, default, or being the only one', () => {
  const two = { A: { enable() {}, disable() {} }, B: { enable() {}, disable() {} } };
  assert.throws(() => pickAdapter(two), /exports 2 adapters \(A, B\)/);
  assert.equal(pickAdapter(two, 'B'), two.B);
  assert.throws(() => pickAdapter({ x: 1 }), /exports no adapter/);
  assert.throws(() => pickAdapter(two, 'x'), /"x" is not an adapter/);
});

await test('lint: running text as code, the network and cookies are errors; storage is a warning', () => {
  const levels = (code) => lintWebModule(code).map(f => `${f.level}:${f.message}`);
  assert.deepEqual(lintWebModule(STARTER), []);
  const bad = `export const A = { enable() { eval('1'); fetch('/x'); new Function('x'); document.cookie; setTimeout("go()", 1); }, disable() {} };`;
  const found = levels(bad);
  for (const m of ['eval runs text as code', 'sends or fetches data', 'new Function runs text', 'reads or writes cookies', 'a timer given a string']) {
    assert.ok(found.some(f => f.startsWith('error:') && f.includes(m)), m);
  }
  assert.ok(levels(`export const A = { enable() { localStorage.x = 1; }, disable() {} };`).some(f => f.startsWith('warning:') && f.includes('storage')));
  assert.ok(levels(`export const A = { enable() {} };`).some(f => f.includes('no disable()')));
  assert.ok(levels('const x = 1;').some(f => f.includes('exports nothing')));
  assert.deepEqual(levels(`// fetch('/x') in a comment is fine\nexport const A = { enable() {}, disable() {} };`), []);
  assert.equal(lintWebModule('').length, 1);
});

await test('checkPackage: format, code, entry and the descriptor\'s web targets', () => {
  assert.deepEqual(checkPackage({ format: WEB_MODULE, code: STARTER }, descriptor()), []);
  assert.deepEqual(checkPackage({ format: WEB_MODULE, code: STARTER, entry: 'BigButtons' }, descriptor()), []);
  const paths = (p, d) => checkPackage(p, d).map(e => e.path);
  assert.deepEqual(paths({ format: 'zip', code: STARTER }, descriptor()), ['/package/format']);
  assert.deepEqual(paths({ format: WEB_MODULE, code: STARTER, entry: 'Nope' }, descriptor()), ['/package/entry']);
  assert.deepEqual(paths({ format: WEB_MODULE, code: STARTER, extra: 1 }, descriptor()), ['/package/extra']);
  assert.deepEqual(paths({ format: WEB_MODULE, code: 'export const A = { enable() { fetch(1) }, disable() {} };' }, descriptor()), ['/package/code']);
  assert.deepEqual(paths({ format: WEB_MODULE, code: STARTER }, descriptor({ surfaces: ['xr'] })), ['/descriptor/surfaces']);
  assert.deepEqual(paths({ format: WEB_MODULE, code: STARTER }, descriptor({ targets: [{ platforms: ['*'], applications: ['com.example'] }] })), ['/descriptor/targets']);
});

await test('artifactDigest is sha256 of the code', async () => {
  assert.equal(await artifactDigest(STARTER), `sha256:${crypto.createHash('sha256').update(STARTER).digest('hex')}`);
});

await test('URL regexes agree with matchUrlPattern on every pattern and URL in a grid', () => {
  const patterns = ['*', 'https://example.com/*', 'http://example.com/a/*', '*://example.com/*', 'https://*.example.com/*',
    'https://*/*', 'http://localhost/*', 'http://localhost:8080/*', 'https://example.com:443/x*y', 'http://[::1]/*', 'https://example.com/'];
  const urls = ['https://example.com/', 'https://example.com/a/b?q=1#h', 'http://example.com/a/b', 'https://sub.example.com/x',
    'https://example.com.evil.org/', 'https://notexample.com/', 'http://localhost:8080/', 'http://localhost/', 'http://localhost:3000/x',
    'https://example.com:8443/xzy', 'https://example.com/xzy', 'http://[::1]:5000/p', 'https://EXAMPLE.com/A', 'https://example.com'];
  for (const p of patterns) {
    const re = new RegExp(urlPatternRegExpSource(p));
    for (const u of urls) assert.equal(re.test(normalizedUrl(u)), matchUrlPattern(p, u), `${p} vs ${u}`);
  }
});

await test('Chrome match patterns cover the toolkit patterns (ports dropped)', () => {
  assert.deepEqual(chromeMatchPatterns(['*']), ['http://*/*', 'https://*/*']);
  assert.deepEqual(chromeMatchPatterns(['http://localhost:8080/*', 'https://*.Example.com/a*', 'https://*.example.com/a*']), ['http://localhost/*', 'https://*.example.com/a*']);
  assert.deepEqual(webUrlPatterns([{ platforms: ['*'], urls: ['a', 'b'] }, { platforms: ['*'], urls: ['b'] }, { platforms: ['*'], applications: ['x'] }]), ['a', 'b']);
});

await test('registry tool schemas are valid, described, and validate typical calls', () => {
  for (const name of REGISTRY_TOOLS) {
    assert.deepEqual(checkSchema(REGISTRY_TOOL_SCHEMAS[name]), [], name);
    assert.ok(REGISTRY_TOOL_DESCRIPTIONS[name], `${name} has a description`);
  }
  assert.deepEqual(validate(REGISTRY_TOOL_SCHEMAS.adapter_install, { app: 'browser-runtime', adapter: { owner: 'team-3', appId: 'redbird', id: 'swatch-labels' }, revision: 'latest', sites: { 'https://example.com': false } }), []);
  assert.deepEqual(validate(REGISTRY_TOOL_SCHEMAS.adapter_install, { app: 'browser-runtime', adapter: { appId: 'redbird', id: 'x' }, revision: 3 }), []);
  assert.ok(validate(REGISTRY_TOOL_SCHEMAS.adapter_install, { app: 'browser-runtime', adapter: { appId: 'redbird', id: 'x' }, revision: 0 }).length);
  assert.ok(validate(REGISTRY_TOOL_SCHEMAS.adapter_get, { adapter: { appId: 'Bad App', id: 'x' } }).length);
  assert.ok(validate(REGISTRY_TOOL_SCHEMAS.adapter_report, { app: 'browser-runtime', instanceId: 'a', results: [{ adapter: { appId: 'a', id: 'b' }, status: 'exploded' }] }).length);
});

console.log(`\nAdapter packages: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
