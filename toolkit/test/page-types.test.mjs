// The toolkit's page types (protocol/adapter/page-types.js): what a page's
// own markup says, the descriptor field, and the pageType prompt.
//
//   node toolkit/test/page-types.test.mjs

import assert from 'node:assert/strict';
import { PAGE_TYPES, PAGE_TYPE_IDS, declaredPageType, checkDescriptor, defineDescriptor, descriptorDigest } from '../protocol/adapter/index.js';
import { buildPrompt } from '../blocks/ai/prompts.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

await test('the markup says one kind, or none', () => {
  assert.equal(declaredPageType({ types: ['WebSite', 'Organization', 'Product', 'BreadcrumbList'] }), 'product');
  assert.equal(declaredPageType({ types: ['https://schema.org/NewsArticle'] }), 'article');
  assert.equal(declaredPageType({ ogType: 'video.movie' }), 'video');
  assert.equal(declaredPageType({ ogType: 'website' }), null, 'says nothing about the page');
  assert.equal(declaredPageType({ types: ['WebSite', 'Organization'] }), null);
  assert.equal(declaredPageType({ types: ['Product', 'ItemList'] }), 'product', 'a product page with a list of related items');
  assert.equal(declaredPageType({ types: ['Recipe', 'Event'] }), null, 'two kinds: the model decides');
  assert.equal(new Set(PAGE_TYPE_IDS).size, PAGE_TYPES.length);
});

await test('a descriptor names kinds of page from the list, and they are part of its digest', async () => {
  const base = { appId: 'console', id: 'big', name: 'Big', description: 'x', targets: [{ platforms: ['*'], urls: ['https://shop.example/*'] }] };
  const d = defineDescriptor({ ...base, pageTypes: ['product'] });
  const about = (x) => checkDescriptor(x).filter(e => e.path === '/pageTypes').map(e => e.message);
  assert.deepEqual(about(d), []);
  assert.match(about(defineDescriptor({ ...base, pageTypes: ['shop'] })).join(), /must be a non-empty list of article/);
  assert.equal(about(defineDescriptor({ ...base, pageTypes: [] })).length, 1);
  assert.notEqual(await descriptorDigest(d, 'sha256:a'), await descriptorDigest(defineDescriptor(base), 'sha256:a'));
});

await test('the pageType prompt numbers every kind and allows 0', () => {
  const { prompt, options } = buildPrompt('pageType', 'Address: https://shop.example/p/1');
  assert.equal(options.choices, PAGE_TYPES.length);
  assert.match(prompt, /1\. Articles: a news story/);
  assert.match(prompt, new RegExp(`from 1 to ${PAGE_TYPES.length}\\. If it is none of these`));
  assert.ok(prompt.includes('<text>\nAddress: https://shop.example/p/1\n</text>'));
  assert.ok(!/Answer in the language/.test(prompt));
});

console.log(`\nPage types: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
