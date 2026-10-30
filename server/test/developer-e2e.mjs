// Real browser + real toolkit service. No external API or LLM required.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { BUILTIN_PROFILES } from '../developer/profiles.js';
import { editableProfile } from '../developer/client.js';

const dir = await mkdtemp(path.join(tmpdir(), 'developer-e2e-'));
const store = fileStore(dir), host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: host }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const remote = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: host, corsOrigins: [base] }));
await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const tokenResponse = await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'browser-test' }) });
  const { token } = await tokenResponse.json();
  const { librarian } = await host.getInstance('browser-test');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  async function expandNeed(index) {
    const card = page.locator('.need-card').nth(index - 1);
    if (await card.getAttribute('open') === null) await card.locator('summary').click();
    return page.getByRole('group', { name: `Need ${index}`, exact: true });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/developer');
  assert.equal(await page.locator('.profile-card').count(), 9);
  assert.equal(await page.locator('[data-load]:disabled').count(), 9);
  // Accounts are the front door; the token form is the advanced path.
  assert.equal(await page.locator('#signin-form').isVisible(), true);
  await page.click('#token-connect summary');
  await page.fill('#instance-token', 'invalid');
  await page.click('#connect');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('unauthorized'));
  assert.match(await page.locator('#connection-state').innerText(), /Signed out/);
  await page.fill('#instance-token', token);
  // Exercise a different origin with an actual browser CORS preflight.
  await page.fill('#instance-url', `http://127.0.0.1:${remote.address().port}`);
  await page.click('#connect');
  await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Connected'));
  // The field clears once the console has loaded the account's pages.
  await page.waitForFunction(() => document.getElementById('instance-token').value === '');
  // Rendering and applying any built-in must not invent optional properties
  // or turn numbers, switches, arrays, or plain text into JSON strings.
  for (const preset of BUILTIN_PROFILES) {
    await page.click(`[data-load="${preset.id}"]`);
    await page.waitForFunction(name => document.getElementById('status').textContent.startsWith(`${name} loaded`), preset.name);
    assert.equal(await page.locator('.need-card[open]').count(), 0, 'loaded needs start collapsed');
    await page.click('#apply');
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile applied'));
    assert.deepEqual(editableProfile(await librarian.getProfile()), preset.profile, `${preset.name} must round trip without data loss`);
  }
  const customValues = {
    supportAreas: ['custom-area'], freeText: '', 'literal.dot': 12,
    fields: { visionKind: 'lowVision', needs: [
      { dimension: 'custom', value: { label: 'keep', flags: [1, true, { enabled: false }] }, strength: 'custom-strength', unit: 'custom-unit', confidence: null, source: null, extension: { enabled: false } },
      { dimension: 'nullable', value: null },
    ] },
    metaPreferences: { consentBoundary: 'custom-boundary', language: 'custom-language', sharing: 'personal' },
  };
  await librarian.replaceProfile(customValues);
  await page.click('#refresh');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Read the current profile'));
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile applied'));
  assert.deepEqual(editableProfile(await librarian.getProfile()), customValues, 'custom enum choices, nulls, nested values, unknown properties, and literal dots must survive');
  for (const key of ['metaPreferences.consentBoundary', 'metaPreferences.language', 'metaPreferences.sharing', 'fields.visionKind']) {
    await page.getByRole('button', { name: `Other value for ${key}`, exact: true }).click();
    await page.getByLabel(`Other ${key}`, { exact: true }).fill(`custom-${key}`);
  }
  const customNeed = await expandNeed(1);
  for (const property of ['strength', 'unit']) {
    await customNeed.getByRole('button', { name: `Other value for ${property}`, exact: true }).click();
    await customNeed.getByLabel(`Other ${property}`, { exact: true }).fill(`custom-${property}`);
  }
  // Switching to a known value hides the input without losing its text.
  const customConsent = page.getByRole('combobox', { name: 'metaPreferences.consentBoundary', exact: true });
  await customConsent.selectOption({ label: 'profile-only' });
  assert.equal(await page.getByLabel('Other metaPreferences.consentBoundary', { exact: true }).isHidden(), true);
  await customConsent.selectOption({ label: 'Other' });
  assert.equal(await page.getByLabel('Other metaPreferences.consentBoundary', { exact: true }).inputValue(), 'custom-metaPreferences.consentBoundary');
  await page.getByLabel('Other metaPreferences.consentBoundary', { exact: true }).fill('');
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Enter a custom value'));
  assert.deepEqual(editableProfile(await librarian.getProfile()), customValues, 'blank Other never overwrites the toolkit');
  await page.getByLabel('Other metaPreferences.consentBoundary', { exact: true }).fill('custom-metaPreferences.consentBoundary');
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile applied'));
  const customUpdated = await librarian.getProfile();
  for (const key of ['consentBoundary', 'language', 'sharing']) assert.equal(customUpdated.metaPreferences[key], `custom-metaPreferences.${key}`);
  assert.equal(customUpdated.fields.visionKind, 'custom-fields.visionKind');
  assert.equal(customUpdated.fields.needs[0].strength, 'custom-strength');
  assert.equal(customUpdated.fields.needs[0].unit, 'custom-unit');
  await page.click('[data-load="wai-3"]');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile 3 loaded'));
  assert.ok((await librarian.getAbilityModel()).needs.some(n => n.dimension === 'describeImages'));
  // The loaded preset is highlighted as selected and active; nothing else is.
  const selectedCard = page.locator('.profile-card[aria-current="true"]');
  assert.equal(await selectedCard.count(), 1);
  assert.equal(await selectedCard.locator('[data-load="wai-3"]').count(), 1);
  assert.deepEqual(await selectedCard.locator('.marker').allInnerTexts(), ['Selected', 'Active in toolkit']);
  // The edits made above stay as the temporary profile, no longer selected or active.
  assert.equal(await page.locator('.temp-card').count(), 1, 'loading a preset keeps the temporary profile');
  assert.equal(await page.locator('.temp-card .marker').count(), 0);
  await page.click('[data-load="wai-6"]');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile 6 loaded'));
  assert.equal((await librarian.getProfile()).fields.visionKind, undefined);
  assert.deepEqual((await librarian.getAbilityModel()).supportAreas, ['hearing']);
  const areas = page.getByRole('combobox', { name: 'supportAreas', exact: true });
  await areas.fill('motor');
  await areas.press('Enter');
  // The first edit moves the work into the temporary profile; Profile 6 itself is unchanged.
  const tempCard = page.locator('.temp-card');
  assert.equal(await tempCard.count(), 1);
  assert.match(await tempCard.innerText(), /Temporary profile \(based on Profile 6\)/);
  assert.equal(await tempCard.getAttribute('aria-current'), 'true');
  assert.deepEqual(await tempCard.locator('.marker').allInnerTexts(), ['Selected']);
  assert.deepEqual(await page.locator('.profile-card:has([data-load="wai-6"]) .marker').allInnerTexts(), ['Active in toolkit']);
  assert.equal(await page.inputValue('#profile-name'), 'Profile 6 (modified)');
  assert.equal(await page.locator('#draft-state').innerText(), 'Temporary · not applied');
  assert.deepEqual((await librarian.getProfile()).supportAreas, ['hearing'], 'an edit is not applied by itself');
  await page.getByRole('button', { name: 'Remove hearing from supportAreas', exact: true }).click();
  await areas.fill('custom-area');
  await areas.press('Enter');
  const consent = page.getByRole('combobox', { name: 'metaPreferences.consentBoundary', exact: true });
  await consent.selectOption({ label: 'all-tiers' });
  await page.getByRole('textbox', { name: 'freeText', exact: true }).fill('Plain text needs no JSON quotes.');
  const firstNeed = await expandNeed(1);
  await firstNeed.getByRole('switch', { name: 'Value', exact: true }).uncheck();
  await firstNeed.getByLabel('Strength', { exact: true }).selectOption({ label: 'floor' });
  await firstNeed.getByLabel('Unit', { exact: true }).selectOption({ label: 'boolean' });
  await firstNeed.getByLabel('Confidence', { exact: true }).fill('0.8');
  await firstNeed.getByLabel('Source', { exact: true }).fill('developer');
  await page.getByRole('button', { name: '+ Add need', exact: true }).click();
  const secondNeed = page.getByRole('group', { name: 'Need 2', exact: true });
  await secondNeed.getByLabel('Value', { exact: true }).fill('1.5');
  assert.match(await page.locator('.need-card').nth(1).locator('summary').innerText(), /textSize · 1.5/);
  await page.getByRole('button', { name: '+ Add need', exact: true }).click();
  const thirdNeed = page.getByRole('group', { name: 'Need 3', exact: true });
  await thirdNeed.getByRole('combobox', { name: /value type/ }).selectOption({ label: 'string' });
  await thirdNeed.getByLabel('Value', { exact: true }).fill('custom value');
  await thirdNeed.getByRole('button', { name: 'Remove need', exact: true }).click();
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile applied'));
  const typedProfile = await librarian.getProfile();
  assert.deepEqual(await tempCard.locator('.marker').allInnerTexts(), ['Selected', 'Active in toolkit']);
  assert.equal(await page.locator('#draft-state').innerText(), 'Temporary · applied');
  const selectionNow = async () => (await (await fetch(base + '/v1/profile/selection', { headers: { authorization: `Bearer ${token}` } })).json()).selected;
  assert.deepEqual(await selectionNow(), { id: 'wai-6', name: 'Profile 6', edited: true }, 'the toolkit knows it holds Profile 6 with changes');
  // Reading the toolkit back restores the temporary profile from that selection.
  await page.click('#refresh');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Read the current profile'));
  assert.equal(await tempCard.count(), 1);
  assert.deepEqual(await tempCard.locator('.marker').allInnerTexts(), ['Selected', 'Active in toolkit']);
  assert.equal(await page.inputValue('#profile-name'), 'Profile 6 (modified)');
  assert.deepEqual(typedProfile.supportAreas, ['motor', 'custom-area']);
  assert.equal(typedProfile.metaPreferences.consentBoundary, 'all-tiers');
  assert.equal(typedProfile.freeText, 'Plain text needs no JSON quotes.');
  assert.deepEqual(typedProfile.fields.needs, [
    { dimension: 'captions', value: false, strength: 'floor', unit: 'boolean', confidence: 0.8, source: 'developer' },
    { dimension: 'textSize', value: 1.5, strength: 'preference' },
  ]);
  await page.fill('#new-key', 'fields.testFlag');
  await page.getByRole('switch', { name: 'Value', exact: false }).last().check();
  await page.getByRole('button', { name: '+ Add key', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Added fields.testFlag'));
  await page.getByLabel('Remove fields.transcripts', { exact: true }).click();
  await page.fill('#profile-name', 'Browser custom preset');
  await page.fill('#profile-description', 'custom test');
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved Browser custom preset'));
  assert.equal((await librarian.getProfile()).fields.testFlag, undefined, 'saving does not apply a draft');
  assert.equal(await page.locator('.temp-card').count(), 0, 'saving turns the temporary profile into the preset');
  assert.deepEqual(await page.locator('.profile-card[aria-current="true"] .marker').allInnerTexts(), ['Selected']);
  const custom = page.locator('[data-load^="custom-"]');
  await custom.click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Browser custom preset loaded'));
  assert.equal((await librarian.getProfile()).fields.testFlag, true);
  assert.equal((await librarian.getProfile()).fields.transcripts, undefined, 'removed keys are absent in storage');
  await expandNeed(2);
  const number = page.getByRole('group', { name: 'Need 2', exact: true }).getByLabel('Value', { exact: true });
  await number.fill('');
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Enter a valid number'));
  assert.equal((await librarian.getProfile()).fields.testFlag, true);
  await number.fill('1.75');
  await page.getByRole('switch', { name: 'fields.testFlag' }).uncheck();
  await page.click('#apply');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Profile applied'));
  assert.equal((await librarian.getProfile()).fields.testFlag, false);
  assert.equal((await librarian.getProfile()).fields.needs[1].value, 1.75);
  await page.locator('.json-editor summary').click();
  assert.equal(JSON.parse(await page.inputValue('#profile-json')).fields.needs[1].value, 1.75);
  await page.fill('#profile-json', '{broken JSON');
  await page.click('#use-json');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Invalid JSON for profile'));
  await page.fill('#profile-json', JSON.stringify(editableProfile(await librarian.getProfile())));
  await page.click('#use-json');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('JSON loaded'));
  await page.locator('.json-editor summary').click();
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved Browser'));
  assert.equal(await page.locator('[data-load^="custom-"]').count(), 1, 'save updates an existing custom preset');
  assert.equal(await page.inputValue('#profile-name'), 'Browser custom preset', 'a custom preset keeps its name, since saving overwrites it');
  // Discarding a temporary profile returns the editor to its preset.
  const freeText = page.getByRole('textbox', { name: 'freeText', exact: true });
  const savedText = await freeText.inputValue();
  await freeText.fill('A change to throw away.');
  assert.equal(await page.locator('.temp-card').count(), 1);
  await page.click('[data-discard]');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Discarded the temporary profile'));
  assert.equal(await page.locator('.temp-card').count(), 0);
  assert.equal(await freeText.inputValue(), savedText);
  assert.equal(await page.locator('.profile-card[aria-current="true"] [data-load^="custom-"]').count(), 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(tmpdir(), 'toolkit-developer-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(tmpdir(), 'toolkit-developer-mobile-editor.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'loaded need cards must fit the mobile viewport');
  await page.reload();
  assert.equal(await page.locator('[data-load^="custom-"]').count(), 1, 'custom presets survive reload');
  assert.match(await page.locator('#connection-state').innerText(), /Signed out/);
  assert.equal(await page.inputValue('#instance-token'), '');
  await page.click('[data-delete]');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Deleted saved preset'));
  assert.equal(await page.locator('[data-load^="custom-"]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(tmpdir(), 'toolkit-developer-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout must not overflow horizontally');
  assert.deepEqual(errors, [], 'browser must not raise JS errors');
  console.log('Developer browser workflow passed: collapsed need rows, custom Other choices, all nine typed preset round trips, pills, need properties, switches, validation, JSON editing, persistence, CORS, and mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => remote.close(resolve));
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
