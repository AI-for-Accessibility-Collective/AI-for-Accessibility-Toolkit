import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCaptionFlowDemoServer } from './server.mjs';

test('browser prototype serves pipeline captions and toolkit text-size persistence', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'captionflow-demo-'));
  const server = await createCaptionFlowDemoServer({ storageDir, userId: 'test-demo' });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(base);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /CaptionFlow/);

    const response = await fetch(`${base}/api/captions?lang=sw&mode=plain`);
    assert.equal(response.status, 200);
    const output = await response.json();
    assert.equal(output.captions.length, 3);
    assert.equal(output.captions[0].language, 'sw');
    assert.equal(output.captions[0].status, 'needs-review');

    const before = await (await fetch(`${base}/api/preferences`)).json();
    assert.equal(before.fontScale, 1);
    const update = await fetch(`${base}/api/font-scale`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1.6 }) });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).fontScale, 1.6);
    const saved = await (await fetch(`${base}/api/preferences`)).json();
    assert.equal(saved.fontScale, 1.6);
    const undo = await fetch(`${base}/api/undo-font-scale`, {method:'POST'});
    assert.equal(undo.status, 200);
    const undone = await undo.json();
    assert.equal(undone.undone, true);
    assert.equal(undone.preferences.fontScale, 1);

    assert.equal((await fetch(`${base}/api/captions?lang=fr`)).status, 400);
    assert.equal((await fetch(`${base}/wrong-route`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(storageDir, { recursive: true, force: true });
  }
});