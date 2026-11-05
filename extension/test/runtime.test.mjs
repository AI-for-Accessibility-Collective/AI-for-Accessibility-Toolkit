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
import { buildUserScript, teardownScript, registrationFor, personalScript, runnable, scriptId, buildPreviewScript, previewTeardownScript, AXE_TAGS, AXE_ADVICE_TAGS } from '../runtime/scripts.js';
import { isAllowedServerUrl } from '../runtime/config.js';
import { createPageTypes, pageKey } from '../runtime/page-type.js';

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
    Promise, RegExp, Object, JSON, String, Error, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  return { run: (code) => vm.runInContext(code, context), reports, log, context };
}
const settle = () => new Promise(r => setTimeout(r, 0));
// A value made in the page's realm, as plain data in this one.
const plain = async (v) => JSON.parse(JSON.stringify(await v));

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
  assert.deepEqual(p.log, ['enable x {}', 'disable x'], 'an adapter that says no is wound down: what it started goes');
  const q = page('https://shop.example/');
  q.run(buildUserScript(entry({ package: { format: 'web-module@1', code: CODE('y', 'throw new Error("half done");') } })));
  await settle();
  assert.deepEqual(q.log, ['enable y {}', 'disable y'], 'and so is one that throws');
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

await test('a preview runs once, replaces the last preview, reports nothing, and comes off', async () => {
  const p = page('https://shop.example/cart');
  const preview = (tag, extra) => buildPreviewScript({ code: CODE(tag, extra), urlPatterns: ['https://shop.example/*'], parameters: { size: 44 } });
  // How long enable() took comes back too.
  const applied = async (script) => { const r = await plain(p.run(script)); assert.equal(typeof r.enableMs, 'number'); delete r.enableMs; return r; };
  assert.deepEqual(await applied(preview('p1')), { status: 'applied' });
  assert.deepEqual(await applied(preview('p2')), { status: 'applied' });
  assert.deepEqual(p.log, ['enable p1 {"size":44}', 'disable p1', 'enable p2 {"size":44}']);
  assert.deepEqual(p.reports, [], 'a preview is never reported to the toolkit');
  // An installed adapter in the same page is left alone.
  p.run(buildUserScript(entry()));
  assert.equal(p.run(previewTeardownScript()), true);
  assert.equal(p.run(previewTeardownScript()), false);
  assert.deepEqual(p.log.slice(-2), ['enable r1 {}', 'disable p2']);
});

await test('a preview says why it did not apply', async () => {
  const p = page('https://elsewhere.example/');
  assert.equal((await p.run(buildPreviewScript({ code: CODE('x'), urlPatterns: ['https://shop.example/*'] }))).status, 'skipped');
  const q = page('https://shop.example/');
  const failed = await q.run(buildPreviewScript({ code: CODE('x', "throw new Error('no buttons');"), urlPatterns: ['https://shop.example/*'] }));
  assert.deepEqual(await plain(failed), { status: 'failed', message: 'enable() failed: no buttons' });
  assert.equal(q.run(previewTeardownScript()), false, 'a failed preview is not left running');
  const data = await q.run(buildPreviewScript({ code: `export const D = { async enable(o, t) { await t.data.set('k', 2); log('got ' + await t.data.get('k')); }, disable() {} };`, urlPatterns: ['https://shop.example/*'] }));
  assert.equal(data.status, 'applied');
  assert.equal(q.log.at(-1), 'got 2', 'its data stays in the page');
});

await test('a preview runs its checks before and after enable(), and says only whether each passed', async () => {
  const p = page('https://shop.example/');
  const code = `export const F = { enable() { globalThis.marked = true; }, disable() { globalThis.marked = false; } };`;
  const checks = [
    { name: 'marked', code: 'return globalThis.marked === true;' },
    { name: 'gives page text back', code: "return 'some page text';" },
    { name: 'throws', code: "throw new Error('no rows ' + 'x'.repeat(300));" },
  ];
  const r = await plain(p.run(buildPreviewScript({ code, urlPatterns: ['https://shop.example/*'], checks })));
  assert.equal(r.status, 'applied');
  assert.deepEqual(r.checks.map(c => [c.before, c.after]), [[false, true], [true, true], [false, false]]);
  assert.ok(!JSON.stringify(r).includes('some page text'), 'a check answers pass or fail, never what it returned');
  assert.ok(r.checks[2].error.startsWith('no rows') && r.checks[2].error.length <= 160);
  // A failed enable() runs no checks after it.
  const failed = await plain(p.run(buildPreviewScript({ code: CODE('x', "throw new Error('no');"), urlPatterns: ['https://shop.example/*'], checks })));
  assert.deepEqual(failed, { status: 'failed', message: 'enable() failed: no' });
});

await test('with audit, a preview compares axe-core before and after enable(): what the adapter added and fixed', async () => {
  const p = page('https://shop.example/');
  const code = `export const F = { enable() { globalThis.marked = true; }, disable() { globalThis.marked = false; } };`;
  const node = (target, summary = '') => ({ target: [target], failureSummary: summary });
  const runs = [];
  p.context.document = {};
  p.context.axe = { version: '4.12.1', run: async (doc, options) => {
    runs.push(options);
    const on = p.context.marked === true;
    return { violations: [
      { id: 'target-size', impact: 'serious', help: 'All touch targets must be 24px large', tags: ['wcag22aa', 'wcag258'], nodes: on ? [] : [node('#buy')] },
      { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', tags: ['wcag2aa', 'wcag143'],
        nodes: on ? [node('#buy', 'Fix any of the following: insufficient contrast of 2.1'), node('#cart'), node('#old')] : [node('#old')] },
      { id: 'heading-order', impact: 'moderate', help: 'Heading levels should only increase by one', tags: ['cat.semantics', 'best-practice'], nodes: on ? [node('#h4')] : [] },
    ] };
  } };
  const r = await plain(p.run(buildPreviewScript({ code, urlPatterns: ['https://shop.example/*'], audit: true })));
  assert.equal(r.status, 'applied');
  assert.equal(runs.length, 2, 'once before enable() and once after');
  assert.deepEqual(JSON.parse(JSON.stringify(runs[0].runOnly.values)), [...AXE_TAGS, ...AXE_ADVICE_TAGS]);
  assert.deepEqual(r.axe.added, [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', wcag: ['1.4.3'], count: 2, targets: ['#buy', '#cart'], summary: 'Fix any of the following: insufficient contrast of 2.1' }]);
  assert.deepEqual(r.axe.fixed, [{ id: 'target-size', help: 'All touch targets must be 24px large', wcag: ['2.5.8'], count: 1 }]);
  assert.equal(r.axe.remaining, 1, 'the problem that was there before is the site\'s');
  // A best practice the adapter breaks is advice: shown, not counted.
  assert.deepEqual(r.axe.advice, [{ id: 'heading-order', impact: 'moderate', help: 'Heading levels should only increase by one', wcag: [], count: 1, targets: ['#h4'], summary: '' }]);
  // Without axe-core in the page, the preview says so; without audit, it does not look.
  delete p.context.axe;
  assert.deepEqual((await plain(p.run(buildPreviewScript({ code, urlPatterns: ['https://shop.example/*'], audit: true })))).axe, { error: 'axe-core is not loaded in this page' });
  assert.equal((await plain(p.run(buildPreviewScript({ code, urlPatterns: ['https://shop.example/*'] })))).axe, undefined);
});

await test('the runtime sends a token only to https or this computer', () => {
  for (const ok of ['https://toolkit.example', 'http://localhost:8080', 'http://127.0.0.1:9', 'http://[::1]:8080']) assert.equal(isAllowedServerUrl(ok), true, ok);
  for (const bad of ['http://toolkit.example', 'ftp://localhost', 'http://localhost.evil.org', 'https://user:pw@toolkit.example', '', 'nonsense']) assert.equal(isAllowedServerUrl(bad), false, bad);
});

// The blocks bundle as the runtime injects it, in a real DOM: an adapter
// gets toolkit.session(), toolkit.page and toolkit.personal, its AI goes to
// the service worker as the adapter, and disable() puts the page back.
await test('with the blocks bundle, an adapter builds on toolkit.session() and its AI goes through the service worker', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const html = '<!doctype html><html><body><main><p id="p">A long paragraph about the terms of the loan.</p></main></body></html>';
  const dom = new JSDOM(html, { url: 'https://shop.example/terms', runScripts: 'outside-only' });
  const w = dom.window;
  const sent = [];
  w.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return m.type === 'ai4a11y:ai' ? { ok: true, result: { text: 'Plain words about the loan.' } } : { ok: true }; } } };
  w.log = () => {};
  w.eval(readFileSync(path.join(root, 'extension', 'vendor', 'blocks.js'), 'utf8'));
  const code = `export default {
    async enable(options, toolkit) {
      this.s = toolkit.session();
      const p = toolkit.page.main().querySelector('p');
      const plain = await this.s.ai.text('simplify', p.textContent, { tone: 'friendly' });
      this.s.text.replaceBlock(p, plain);
      window.__personal = toolkit.personal;
    },
    disable() { this.s.end(); },
  };`;
  const before = w.document.body.innerHTML;
  // The person's settings come first, page-wide, with what they set for this site.
  w.eval(personalScript({ personal: { readingLevel: 'easy-read', fontScale: 120 }, explicit: { general: {}, sites: { 'shop.example': { fontScale: 160 } } } }));
  w.eval(buildUserScript(entry({ package: { format: 'web-module@1', code } })));
  for (let i = 0; i < 20 && !sent.some(m => m.type === 'ai4a11y:report'); i++) await settle();
  const ai = sent.find(m => m.type === 'ai4a11y:ai');
  assert.equal(ai.key, 'ada/console/big-buttons');
  assert.deepEqual({ ...ai.request, options: { ...ai.request.options } }, { kind: 'text', task: 'simplify', input: 'A long paragraph about the terms of the loan.', options: { tone: 'friendly', readingLevel: 'easy-read' } });
  assert.equal(sent.find(m => m.type === 'ai4a11y:report').status, 'applied');
  assert.match(w.document.body.textContent, /Plain words about the loan\./);
  assert.equal(w.__personal.readingLevel, 'easy-read');
  assert.equal(w.__personal.fontScale, 160, "this site's own setting");
  // A change reaches the running adapter in place: it is not turned off and on.
  const reports = sent.filter(m => m.type === 'ai4a11y:report').length;
  w.eval(personalScript({ personal: { readingLevel: 'plain' } }));
  await settle();
  assert.equal(sent.filter(m => m.type === 'ai4a11y:report').length, reports);
  assert.match(w.document.body.textContent, /Plain words about the loan\./);
  w.eval(teardownScript('ada/console/big-buttons'));
  assert.equal(w.document.body.innerHTML, before);
});

await test('a check waits for the model, not a guess at how long it takes: model time is not check time, up to its own limit', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const dom = new JSDOM('<!doctype html><html><body><main><p>Text.</p></main></body></html>', { url: 'https://shop.example/', runScripts: 'outside-only' });
  const w = dom.window;
  // The model answers in 600 ms, longer than a check's 300 ms here; 'forever' never.
  w.chrome = { runtime: { sendMessage: (m) => (m.type !== 'ai4a11y:ai' ? Promise.resolve({ ok: true })
    : m.request.input === 'forever' ? new Promise(() => {})
    : new Promise((r) => setTimeout(() => r({ ok: true, result: { text: 'Answer.' } }), 600))) } };
  w.log = () => {};
  w.eval(readFileSync(path.join(root, 'extension', 'vendor', 'blocks.js'), 'utf8'));
  const code = `export default {
    enable(options, toolkit) {
      this.s = toolkit.session();
      window.__ask = () => this.s.ai.text('simplify', 'slow').then((t) => { document.body.dataset.answered = t ? '1' : '0'; });
      window.__askForever = () => this.s.ai.text('simplify', 'forever');
    },
    disable() { this.s.end(); },
  };`;
  const checks = [
    { name: 'waits for a slow answer', code: "if (!window.__ask) return false; window.__ask(); await aiSettled(); return document.body.dataset.answered === '1';" },
    { name: 'a hang with no model still stops', code: 'await new Promise(() => {});' },
    { name: 'a model that never answers', code: "if (!window.__askForever) return false; window.__askForever(); await new Promise((r) => setTimeout(r, 5000)); return true;" },
  ];
  const r = await w.eval(buildPreviewScript({ code, urlPatterns: ['https://shop.example/*'], checks, limits: { checkMs: 300, aiWaitMs: 1500, aiQuietMs: 50 } }));
  const after = JSON.parse(JSON.stringify(r.checks));
  assert.deepEqual(after.map((c) => c.after), [true, false, false]);
  assert.match(after[1].error, /took over 0\.3 seconds/);
  assert.match(after[2].error, /the model did not answer within 1\.5 seconds/);
});

await test("registrations inject the blocks and the person's settings before the adapter", () => {
  const reg = registrationFor(entry(), { personal: { speechRate: 1.5 } });
  assert.deepEqual(reg.js[0], { file: 'vendor/blocks.js' });
  assert.match(reg.js[1].code, /setPersonal\(\{"speechRate":1\.5\}, null\)/);
  assert.equal(reg.js[2].code, buildUserScript(entry()), 'the adapter\'s script does not carry them');
});

await test('extension/vendor matches the toolkit modules', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.mjs'), '--check'], { stdio: 'pipe' });
});

await test('an adapter for some kinds of page asks what kind this one is, and runs only there', async () => {
  const run = async (kinds, answer) => {
    const p = page('https://shop.example/p/1');
    const asked = [];
    p.context.document = { querySelectorAll: () => [], querySelector: () => null, forms: [], links: [], title: 'Tea pot', body: { innerText: 'Tea pot $4' } };
    p.context.chrome.runtime.sendMessage = (m) => { if (m.type === 'ai4a11y:pagetype') { asked.push(m); return Promise.resolve(answer); } p.reports.push(m); };
    p.run(buildUserScript(entry({ pageTypes: kinds })));
    for (let i = 0; i < 5; i++) await settle();
    return { p, asked };
  };
  const yes = await run(['product'], { type: 'product', source: 'page' });
  assert.deepEqual(yes.p.log, ['enable r1 {}']);
  assert.equal(yes.asked.length, 1);
  assert.equal(yes.asked[0].key, 'ada/console/big-buttons');
  assert.equal(yes.asked[0].facts.title, 'Tea pot');
  const no = await run(['article'], { type: 'product', source: 'model' });
  assert.deepEqual(no.p.log, []);
  assert.deepEqual(no.p.reports.map(r => [r.status, r.message]), [['skipped', 'not one of its kinds of page (Articles)']]);
  const unknown = await run(['product'], null);
  assert.deepEqual(unknown.p.log, [], 'no answer: it does not run');
  const plainOne = page('https://shop.example/p/1');
  plainOne.run(buildUserScript(entry()));
  await settle();
  assert.deepEqual(plainOne.log, ['enable r1 {}'], 'one without kinds asks nothing');
});

await test('page types: the markup first, else the model once per address, kept', async () => {
  const store = {};
  const storage = { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))) };
  const asked = [];
  let answer = { text: '6' };
  let clock = 1_000;
  const types = createPageTypes({ storage, ask: async (input) => { asked.push(input); return answer; }, now: () => clock });
  const facts = (url, declared = {}) => ({ url, title: 'T', declared, headings: [], counts: {}, text: 'x' });
  assert.deepEqual(await types.classify(facts('https://shop.example/p/1#top', { types: ['WebSite', 'Product', 'BreadcrumbList'] })), { type: 'product', source: 'page' });
  assert.equal(asked.length, 0, 'the page said so: no model');
  assert.deepEqual(await types.classify(facts('https://shop.example/cart')), { type: 'checkout', source: 'model' });
  assert.match(asked[0], /Address: https:\/\/shop\.example\/cart/);
  assert.deepEqual(await types.classify(facts('https://shop.example/cart#x')), { type: 'checkout', source: 'model', cached: true });
  assert.equal(asked.length, 1, 'kept by address, without the fragment');
  // Two adapters on one page ask once.
  answer = { text: '1' };
  const both = await Promise.all([types.classify(facts('https://news.example/a')), types.classify(facts('https://news.example/a'))]);
  assert.deepEqual(both.map(b => b.type), ['article', 'article']);
  assert.equal(asked.length, 2);
  // Not answered at all: not kept. Cannot tell: kept a day.
  answer = { text: null, reason: 'http-503' };
  assert.equal((await types.classify(facts('https://x.example/'))).type, null);
  answer = { text: null, reason: 'cannot tell' };
  await types.classify(facts('https://x.example/'));
  await types.classify(facts('https://x.example/'));
  assert.equal(asked.length, 4);
  clock += 25 * 3600_000;
  await types.classify(facts('https://x.example/'));
  assert.equal(asked.length, 5, 'asked again after a day');
  assert.equal(pageKey('https://a.example/p?q=1#f'), 'https://a.example/p?q=1');
});

await test('the console bridge steps aside when the extension is reloaded under it, and the new one takes over', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../bridge.js', import.meta.url), 'utf8');
  const window = new EventTarget();
  const posted = [];
  window.postMessage = (data) => posted.push(data);
  const location = { origin: 'http://localhost:8080' };
  const extension = (version) => {
    const sent = [];
    const chrome = { runtime: {
      id: 'ext', getManifest: () => ({ version }),
      sendMessage: async (m) => { sent.push(m.type); return { ok: true, result: { connection: { uid: 'dev' }, state: { adapters: [] } } }; },
    } };
    // What Chrome does to a cut-off content script: no id, and every call throws.
    const invalidate = () => {
      chrome.runtime.id = undefined;
      chrome.runtime.getManifest = chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
    };
    return { chrome, sent, invalidate };
  };
  const fromConsole = (type) => { const e = new Event('message'); Object.assign(e, { source: window, origin: location.origin, data: { source: 'ai4a11y-console', type } }); window.dispatchEvent(e); };
  const settle = () => new Promise(r => setTimeout(r, 20));
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const old = extension('0.1.0');
    vm.runInNewContext(code, { window, location, chrome: old.chrome, Promise });
    await settle();
    assert.equal(posted.at(-1).version, '0.1.0');
    fromConsole('profile-changed');
    await settle();
    assert.deepEqual(old.sent, ['status', 'sync', 'status']);
    // The extension reloads: the old bridge must not throw, and steps aside.
    old.invalidate();
    const before = posted.length;
    fromConsole('adapters-changed');
    fromConsole('ping');
    await settle();
    assert.equal(posted.length, before, 'the cut-off bridge says nothing');
    assert.equal(window.__ai4a11yBridge, undefined);
    // The reloaded extension injects its bridge into the same page: it takes over.
    const fresh = extension('0.1.1');
    vm.runInNewContext(code, { window, location, chrome: fresh.chrome, Promise });
    await settle();
    assert.equal(posted.at(-1).version, '0.1.1');
    fromConsole('adapters-changed');
    await settle();
    assert.deepEqual(fresh.sent, ['status', 'sync', 'status']);
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

console.log(`\nAdapter runtime: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
