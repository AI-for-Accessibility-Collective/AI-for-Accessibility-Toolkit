// Adapter MCP: the wire contract (toolkit/protocol/adapter/) and the binding
// helpers (toolkit/adapter-mcp/), checked against the acceptance criteria in
// docs/design/adapter-mcp.md §11.
//
//   node toolkit/test/adapter-mcp.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  validate, checkSchema, canonicalize, descriptorDigest, digestInput,
  matchUrlPattern, urlPatternError, checkTargetRules, matchTarget, targetShapeError,
  platformCompatibility, checkDescriptor, checkApplication, defineDescriptor, PROFILE_VERSION,
} from '../protocol/adapter/index.js';
import { createAdapterProvider, fromToggleAdapter, fromAction, catalogDescriptors, AdapterMcpError } from '../adapter-mcp/index.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.message); }
}
const fixture = (name) => JSON.parse(readFileSync(new URL(`../protocol/adapter/fixtures/${name}`, import.meta.url), 'utf8'));

// ── schema validator ──────────────────────────────────────────────────────

await test('schema: supported keywords enforce, falsy values are values', () => {
  const schema = { type: 'object', properties: { n: { type: 'number', minimum: 0, maximum: 2 }, b: { type: 'boolean' }, s: { type: 'string', maxLength: 3 }, e: { enum: ['off', 'on'] } }, required: ['n', 'b', 's'], additionalProperties: false };
  assert.deepEqual(validate(schema, { n: 0, b: false, s: '' }), []);
  assert.equal(validate(schema, { n: 3, b: false, s: '' }).length, 1);
  assert.equal(validate(schema, { b: false, s: '' })[0].message, 'is required');
  assert.match(validate(schema, { n: 1, b: false, s: '', x: 1 })[0].message, /not an allowed property/);
  assert.equal(validate(schema, { n: 1, b: 'false', s: '' }).length, 1, 'a string is not a boolean');
  assert.equal(validate(schema, { n: Number.NaN, b: false, s: '' }).length, 1, 'NaN is not JSON');
  assert.equal(validate(schema, { n: 1, b: true, s: '', e: 'dim' }).length, 1);
});

await test('schema: unsupported assertion keywords are refused, annotations allowed', () => {
  assert.equal(checkSchema({ type: 'object', patternProperties: { x: {} } }).length, 1);
  assert.equal(checkSchema({ type: 'object', if: {}, then: {} }).length, 2);
  assert.deepEqual(checkSchema({ type: 'number', unit: 'em', 'x-ui': 'slider', description: 'd', default: 1 }), []);
  assert.equal(checkSchema({ $ref: '#/$defs/missing' }).length, 1);
  assert.deepEqual(checkSchema({ $defs: { a: { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/$defs/a' } } }), []);
});

// ── canonical JSON and digests ────────────────────────────────────────────

await test('canonical JSON: sorted keys, ES numbers, refuses non-JSON', () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, 1.5e-7, -0] }), '{"a":[true,null,1.5e-7,0],"b":1}');
  assert.throws(() => canonicalize({ x: Number.POSITIVE_INFINITY }));
  assert.throws(() => canonicalize({ x: undefined }));
  assert.throws(() => canonicalize({ x: '\uD800' }), /Unicode/);
  assert.throws(() => canonicalize(new Date()));
});

await test('digest vectors match the fixtures and an independent sha256', async () => {
  for (const c of fixture('digest-vectors.json').cases) {
    assert.equal(canonicalize({ descriptor: digestInput(c.descriptor), executionArtifactDigest: c.executionArtifactDigest }), c.canonical, c.name);
    assert.equal(await descriptorDigest(c.descriptor, c.executionArtifactDigest), c.digest, c.name);
    assert.equal(c.digest, `sha256:${crypto.createHash('sha256').update(c.canonical, 'utf8').digest('hex')}`, c.name);
  }
});

await test('digest ignores availability and ownership, follows a code change', async () => {
  const d = fixture('descriptor.valid.json');
  const base = await descriptorDigest(d);
  assert.equal(await descriptorDigest({ ...d, registeredBy: 'x', updatedAt: 'now', descriptorDigest: 'sha256:0' }), base);
  assert.notEqual(await descriptorDigest({ ...d, version: '1.0.1' }), base);
  assert.notEqual(await descriptorDigest(d, 'sha256:' + '1'.repeat(64)), base);
});

// ── targets and platforms ─────────────────────────────────────────────────

await test('URL pattern vectors', () => {
  const { cases, invalid } = fixture('url-patterns.json');
  for (const c of cases) assert.equal(matchUrlPattern(c.pattern, c.url), c.match, `${c.pattern} vs ${c.url}`);
  for (const p of invalid) assert.ok(urlPatternError(p), `"${p}" should be invalid`);
});

await test('target rules: validated shape', () => {
  assert.equal(checkTargetRules([]).length, 1, 'empty list');
  assert.ok(checkTargetRules([{ platforms: ['*', 'macos'], urls: ['*'] }]).length, 'mixed whole-field wildcard');
  assert.ok(checkTargetRules([{ platforms: ['*'] }]).length, 'no target type');
  assert.ok(checkTargetRules([{ urls: ['*'] }]).length, 'platforms required');
  assert.ok(checkTargetRules([{ platforms: ['amiga'], urls: ['*'] }]).length, 'unknown platform id');
  assert.ok(checkTargetRules([{ platforms: ['*'], applications: ['com.example.*'] }]).length, 'partial application glob');
  assert.deepEqual(checkTargetRules([{ platforms: ['macos'], applications: ['com.example.reader'] }, { platforms: ['*'], urls: ['https://docs.example.org/*'] }]), []);
});

await test('target matching: platform AND (application OR url), OR across rules', () => {
  const rules = [
    { platforms: ['macos'], applications: ['com.example.reader'] },
    { platforms: ['android'], applications: ['org.example.reader'] },
    { platforms: ['*'], urls: ['https://docs.example.org/*'] },
  ];
  assert.ok(matchTarget(rules, { platform: 'macos', application: 'com.example.reader' }));
  assert.ok(!matchTarget(rules, { platform: 'android', application: 'com.example.reader' }), 'app id is platform-scoped');
  assert.ok(matchTarget(rules, { url: 'https://docs.example.org/a' }), 'url rule with * platforms needs no platform');
  assert.ok(!matchTarget([{ platforms: ['windows'], urls: ['*'] }], { url: 'https://x.test/' }), 'constrained platform unknown is no match');
  assert.ok(targetShapeError({ url: 'https://a.test/', application: 'x', platform: 'macos' }), 'exactly one of application/url');
  assert.ok(targetShapeError({ application: 'com.example.reader' }), 'native target needs its platform');
});

await test('platform compatibility: inherit, narrow, never expand, unknown is not a match', () => {
  const app = [{ os: ['windows', 'macos'], environment: 'browser-extension' }];
  assert.equal(platformCompatibility(app, undefined, { os: 'macos', environment: 'browser-extension' }), 'compatible');
  assert.equal(platformCompatibility(app, [{ os: 'windows' }], { os: 'macos', environment: 'browser-extension' }), 'incompatible');
  assert.equal(platformCompatibility(app, [{ os: 'linux' }], { os: 'linux', environment: 'browser-extension' }), 'incompatible', 'constraints cannot expand');
  assert.equal(platformCompatibility(app, undefined, { environment: 'browser-extension' }), 'unknown');
});

// ── descriptors ───────────────────────────────────────────────────────────

await test('descriptors: the whole catalog derives valid descriptors from the registry', () => {
  const all = catalogDescriptors({ appId: 'browser-extension', version: '1.0.0' });
  assert.ok(all.length > 40);
  for (const d of all) assert.deepEqual(checkDescriptor(d), [], d.id);
  const va = all.find(d => d.id === 'visual-assist');
  assert.equal(va.inputSchema.properties.fontScale.minimum, 50, 'registry ranges become bounds');
});

await test('descriptors: contract rules are enforced', () => {
  const d = fixture('descriptor.valid.json');
  assert.deepEqual(checkDescriptor(d), []);
  assert.ok(checkDescriptor({ ...d, adapterProtocol: { name: 'ai4a11y.adapter-mcp', version: '0.2.0' } }).length, 'exact 0.x version');
  assert.ok(checkDescriptor({ ...d, stateSchema: undefined }).length, 'query needs a stateSchema');
  assert.ok(checkDescriptor({ ...d, effects: { ...d.effects, reversibility: 'none' } }).length, 'revert with no reversibility');
  assert.ok(checkDescriptor({ ...d, targets: undefined }).length, 'an exposed adapter needs targets');
  assert.ok(checkDescriptor({ ...d, operations: ['query'] }).length, 'apply is required');
  assert.ok(checkDescriptor({ ...d, capabilities: [{ id: 'text-scale' }] }).length, 'capabilities are versioned ids');
  assert.ok(checkDescriptor({ ...d, surfaces: ['xr'] }, { application: { appId: d.appId, surfaces: ['web'] } }).length, 'surfaces within the application');
  assert.ok(checkApplication({ appId: 'x', name: 'X', version: '1', supportedPlatforms: [], surfaces: ['web'] }).length, 'supportedPlatforms non-empty');
});

// ── provider ──────────────────────────────────────────────────────────────

const APP = { appId: 'demo', name: 'Demo', version: '1.0.0', supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node', os: 'linux' }, surfaces: ['web'] };
const PAGE = 'https://shop.test/product';

function makeAdapter() {
  return { enabled: false, options: null, enables: 0, enable(o) { this.enabled = true; this.options = o; this.enables++; }, disable() { this.enabled = false; } };
}
function scaleDescriptor(extra = {}) {
  return defineDescriptor({
    appId: 'demo', id: 'text-scale', name: 'Text scale', version: '1.0.0',
    targets: [{ platforms: ['*'], urls: ['https://shop.test/*'] }],
    targetRefSchema: { type: 'object', properties: { selector: { type: 'string', minLength: 1 } }, additionalProperties: false },
    inputSchema: { type: 'object', properties: { scale: { type: 'number', minimum: 0, maximum: 2 }, label: { type: 'string' }, bold: { type: 'boolean' } }, required: ['scale'], additionalProperties: false },
    operations: ['query', 'check', 'apply', 'revert', 'targets'],
    ...extra,
  });
}
function makeProvider({ adapter = makeAdapter(), extra = [] } = {}) {
  const provider = createAdapterProvider({
    application: APP,
    adapters: [
      fromToggleAdapter({ descriptor: scaleDescriptor(), adapter, targets: () => ({ candidates: [{ target: { url: PAGE }, label: 'Product page' }], coverage: 'complete' }) }),
      fromToggleAdapter({ descriptor: defineDescriptor({ appId: 'demo', id: 'secret', name: 'Internal only', version: '1', exposure: 'internal' }), adapter: makeAdapter() }),
      fromAction({ descriptor: defineDescriptor({ appId: 'demo', id: 'describe', name: 'Describe', version: '1', mode: 'action', targets: [{ platforms: ['*'], urls: ['*'] }], operations: ['apply'], stateSchema: undefined, outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, effects: { writes: [], idempotent: true, reversibility: 'none' } }), run: () => ({ text: 'a kettle' }) }),
      ...extra,
    ],
  });
  return { provider, adapter };
}
async function refOf(provider, id) {
  await provider.ready;
  const d = provider.descriptors().find(x => x.id === id);
  return { appId: d.appId, id: d.id, version: d.version, descriptorDigest: d.descriptorDigest };
}
const sc = (r) => r.structuredContent;

await test('provider: invalid registrations fail at creation with every problem', () => {
  assert.throws(() => createAdapterProvider({ application: { ...APP, appId: 'Bad App' }, adapters: [] }), AdapterMcpError);
  try {
    createAdapterProvider({ application: APP, adapters: [{ descriptor: scaleDescriptor({ operations: ['apply', 'query'] }), apply() {} }] });
    assert.fail('should throw');
  } catch (e) { assert.match(e.message, /query/); }
});

await test('provider: MCP lifecycle, tools, and protocol errors', async () => {
  const { provider } = makeProvider();
  const init = await provider.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.equal(await provider.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const tools = (await provider.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(t => t.name);
  for (const t of ['adapter_list', 'adapter_describe', 'adapter_apply', 'adapter_query', 'adapter_check', 'adapter_revert', 'adapter_targets', 'apply_text-scale', 'apply_describe']) assert.ok(tools.includes(t), t);
  assert.ok(!tools.includes('apply_secret'), 'internal adapters are not exported');
  assert.equal((await provider.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).error.code, -32601);
  assert.equal((await provider.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602);
  const list = (await provider.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'adapter_list', arguments: {} } })).result;
  assert.equal(list.isError, false);
  assert.equal(list.structuredContent.profileVersion, PROFILE_VERSION);
  assert.deepEqual(list.structuredContent.adapters.map(a => a.id).sort(), ['describe', 'text-scale']);
});

await test('provider: internal adapters cannot be invoked by guessing their id; provider namespace checked', async () => {
  const { provider } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const guessed = sc(await provider.call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: { ...ref, id: 'secret' }, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1 } } }));
  assert.equal(guessed.reasons[0].code, 'unknown-adapter');
  const otherApp = sc(await provider.call('adapter_describe', { adapterRef: { appId: 'shop', id: 'text-scale' } }));
  assert.equal(otherApp.reasons[0].code, 'unknown-adapter', 'adapterRef.appId names the provider, not the target');
});

await test('provider: preconditions fail visibly before any effect', async () => {
  const { provider, adapter } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const base = { profileVersion: PROFILE_VERSION, adapterRef: ref, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1 } } };
  const cases = [
    [{ profileVersion: '0.2.0' }, 'profile-version-unsupported'],
    [{ adapterRef: { ...ref, descriptorDigest: 'sha256:' + '0'.repeat(64) } }, 'descriptor-changed'],
    [{ expectedRevision: 'r1' }, 'precondition-unsupported'],
    [{ target: { url: 'https://elsewhere.test/' } }, 'target-out-of-scope'],
    [{ target: { url: PAGE, ref: { selector: '' } } }, 'invalid-target-ref'],
    [{ desired: { enabled: true, parameters: { scale: 9 } } }, 'out-of-range'],
    [{ desired: { enabled: false, parameters: { scale: 1 } } }, 'invalid-parameters'],
    [{ desired: { parameters: { scale: 1 } } }, 'invalid-parameters'],
  ];
  for (const [change, code] of cases) {
    const r = await provider.call('adapter_apply', { ...base, ...change });
    assert.equal(r.isError, true, code);
    assert.equal(sc(r).status, 'unavailable', code);
    assert.equal(sc(r).reasons[0].code, code, JSON.stringify(sc(r).reasons));
  }
  assert.equal(adapter.enables, 0, 'nothing ran');
});

await test('provider: stateful apply, update, noop, off — falsy parameters survive', async () => {
  const { provider, adapter } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const apply = (desired) => provider.call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref, target: { url: PAGE }, desired });
  const on = await apply({ enabled: true, parameters: { scale: 0, label: '', bold: false } });
  assert.equal(on.isError, false);
  assert.equal(sc(on).status, 'applied');
  assert.deepEqual(adapter.options, { scale: 0, label: '', bold: false }, 'falsy values reach the adapter');
  assert.ok(sc(on).executionId && sc(on).undo.available);
  assert.equal(sc(await apply({ enabled: true, parameters: { scale: 0, label: '', bold: false } })).status, 'noop');
  assert.equal(adapter.enables, 1);
  await apply({ enabled: true, parameters: { scale: 1.5 } });
  assert.equal(adapter.enables, 2, 'a parameter change re-enables (configuration update)');
  assert.deepEqual(adapter.options, { scale: 1.5 });
  const off = await apply({ enabled: false });
  assert.equal(sc(off).status, 'applied');
  assert.equal(adapter.enabled, false);
});

await test('provider: query reads state without changing it; unknown is never false', async () => {
  const adapter = makeAdapter();
  adapter.enabled = true; // turned on elsewhere
  const { provider } = makeProvider({ adapter });
  const ref = await refOf(provider, 'text-scale');
  const q = sc(await provider.call('adapter_query', { adapterRef: ref, target: { url: PAGE } }));
  assert.equal(q.status, 'partial');
  assert.deepEqual(q.state, { enabled: true });
  assert.equal(q.unavailableFields[0].field, 'requestedParameters');
  assert.ok(q.observedAt && q.verification === 'adapter-reported');
  const bad = await provider.call('adapter_query', { adapterRef: ref, target: { url: PAGE }, fields: ['nope'] });
  assert.equal(bad.isError, true);
  assert.equal(adapter.enables, 0);
});

await test('provider: check is advisory and reports, never applies', async () => {
  const { provider, adapter } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const ok = await provider.call('adapter_check', { adapterRef: ref, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1 } } });
  assert.equal(ok.isError, false);
  assert.equal(sc(ok).compatible, true);
  const no = await provider.call('adapter_check', { adapterRef: ref, target: { url: 'https://x.test/' }, desired: { enabled: true, parameters: { scale: 1 } } });
  assert.equal(no.isError, false, 'a successful check that finds a problem is not a tool error');
  assert.equal(sc(no).compatible, false);
  assert.equal(adapter.enables, 0);
});

await test('provider: undo refuses to overwrite a later change (A→B→C→B), repeat is a no-op', async () => {
  const { provider, adapter } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const apply = async (parameters) => sc(await provider.call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref, target: { url: PAGE }, desired: { enabled: true, parameters } }));
  await apply({ scale: 1 }); // A
  const b = await apply({ scale: 1.2 }); // B
  await apply({ scale: 1.4 }); // C
  await apply({ scale: 1.2 }); // B again: same values, different history
  const stale = await provider.call('adapter_revert', { receiptId: b.undo.receiptId });
  assert.equal(sc(stale).reasons[0].code, 'write-conflict');
  assert.deepEqual(adapter.options, { scale: 1.2 }, 'nothing was changed');
  const latest = await apply({ scale: 1.8 });
  const undo = await provider.call('adapter_revert', { receiptId: latest.undo.receiptId });
  assert.equal(sc(undo).status, 'applied');
  assert.equal(sc(undo).operation, 'revert');
  assert.deepEqual(adapter.options, { scale: 1.2 });
  assert.equal(sc(await provider.call('adapter_revert', { receiptId: latest.undo.receiptId })).status, 'noop');
  adapter.disable(); // a person switches it off outside the provider
  const external = await apply({ scale: 1 });
  adapter.disable();
  assert.equal(sc(await provider.call('adapter_revert', { receiptId: external.undo.receiptId })).reasons[0].code, 'write-conflict');
  assert.equal(sc(await provider.call('adapter_revert', { receiptId: 'receipt-guessed' })).reasons[0].code, 'undo-expired');
});

await test('provider: requestKey deduplicates retries and refuses reuse with other arguments', async () => {
  const { provider, adapter } = makeProvider();
  const ref = await refOf(provider, 'text-scale');
  const args = { profileVersion: PROFILE_VERSION, adapterRef: ref, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1 } }, requestKey: 'k1' };
  const first = sc(await provider.call('adapter_apply', args));
  const retry = sc(await provider.call('adapter_apply', args));
  assert.equal(retry.executionId, first.executionId);
  assert.equal(adapter.enables, 1);
  const reuse = sc(await provider.call('adapter_apply', { ...args, desired: { enabled: false } }));
  assert.equal(reuse.status, 'unavailable');
});

await test('provider: typed tools resolve a single complete target, else ambiguous', async () => {
  const { provider, adapter } = makeProvider();
  const r = await provider.call('apply_text-scale', { enabled: true, parameters: { scale: 1.1 } });
  assert.equal(sc(r).status, 'applied');
  assert.equal(sc(r).target.url, PAGE);
  assert.deepEqual(adapter.options, { scale: 1.1 });
  const action = await provider.call('apply_describe', { parameters: {} });
  assert.equal(sc(action).reasons[0].code, 'target-ambiguous', 'no enumerated target: nothing chosen silently');
  const run = await provider.call('apply_describe', { parameters: {}, target: { url: 'https://any.test/' } });
  assert.deepEqual(sc(run).data, { text: 'a kettle' });
  assert.equal(sc(run).undo.available, false);
});

await test('provider: a throwing adapter is failed with unknown effects, not a crash', async () => {
  const broken = { enabled: false, enable() { throw new Error('boom'); }, disable() {} };
  const { provider } = makeProvider({ adapter: broken });
  const ref = await refOf(provider, 'text-scale');
  const r = await provider.call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1 } } });
  assert.equal(r.isError, true);
  assert.equal(sc(r).status, 'failed');
  assert.equal(sc(r).effectsKnown, false);
});

await test('provider: in-process and MCP calls have equivalent effects', async () => {
  const a = makeProvider(), b = makeProvider();
  const ra = await refOf(a.provider, 'text-scale'), rb = await refOf(b.provider, 'text-scale');
  assert.equal(ra.descriptorDigest, rb.descriptorDigest);
  const args = { profileVersion: PROFILE_VERSION, adapterRef: ra, target: { url: PAGE }, desired: { enabled: true, parameters: { scale: 1.3 } } };
  const local = sc(await a.provider.call('adapter_apply', args));
  const viaMcp = (await b.provider.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'adapter_apply', arguments: args } })).result.structuredContent;
  for (const k of ['status', 'requested', 'applied', 'verification', 'effectsKnown']) assert.deepEqual(local[k], viaMcp[k], k);
  assert.deepEqual(a.adapter.options, b.adapter.options);
});

console.log(`\nAdapter MCP: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
