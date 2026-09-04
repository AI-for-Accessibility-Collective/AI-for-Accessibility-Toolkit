// REAL-BROWSER end-to-end check of the /chat surface — launches actual headless
// Chromium (via Playwright) against a real onboarding server on an ephemeral
// port, and drives the page the way a person does: by typing into the composer.
//
// This is the layer the Node suites structurally cannot reach. chat.js is an ES
// module the page loads over HTTP by absolute path (/controller/lib/...), so
// jsdom cannot execute it at all (jsdom does not run <script type="module">).
// Without a real browser, everything the chat surface does is untested.
//
// It exists to PIN today's behavior so the logic can be lifted out of chat.js
// into importable modules without silently changing what the page does.
//
// Local only (needs a Chromium download); not in CI, and named *-e2e.mjs rather
// than *.test.mjs so `npm test` does not pick it up — the same split
// tools/test/browser-validate.js uses. Run:
//   npm run test:e2e
//
// The assist lane is deliberately left unconfigured (no GEMINI_API_KEY), so the
// unrecognized-input path is deterministic and no network call is made.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'onboard-e2e-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';
process.env.ADMIN_PASSWORD = 'e2e-admin';
delete process.env.GEMINI_API_KEY; // keep the general-answer lane offline

const { chromium } = await import('playwright');
const { server } = await import('../server.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();

// The composer is a textarea: Enter submits, so typing then Enter is exactly
// what a person does. Each turn ends by waiting for the transcript to grow,
// which is the page's own signal that the turn completed.
async function say(text) {
  const before = await page.locator('#transcript .msg').count();
  await page.fill('#composer-input', text);
  await page.press('#composer-input', 'Enter');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#transcript .msg').length >= n + 2,
    before,
    { timeout: 10000 },
  );
}
const profileText = () => page.locator('#profile').innerText();
const lastReply = () => page.locator('#transcript .msg').last().innerText();

try {
  // ── the front door ─────────────────────────────────────────────────────────
  {
    const resp = await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    check('/ lands on /chat', new URL(page.url()).pathname === '/chat');
    check('/ was a redirect, not a rewrite', resp.request().redirectedFrom() !== null);
    check('the composer is present', await page.locator('#composer-input').isVisible());
    check('no profile yet on a fresh browser', /no profile yet/i.test(await profileText()));
  }

  // ── a self-description onboards, and the pill reflects it ──────────────────
  {
    await say("I'm blind");
    const pill = await profileText();
    check('a self-description creates a profile', /^You:/.test(pill.trim()));
    check('the pill carries a capability uid', /u-[A-Za-z0-9_-]{22}/.test(pill));
    check('the pill names the vision support area', /vision/i.test(pill));
    check('the assistant answered the turn', (await lastReply()).trim().length > 0);
  }

  // ── the uid is the credential, and it survives a reload ────────────────────
  {
    const uid = await page.evaluate(() => localStorage.getItem('onb-uid'));
    check('the uid is persisted in localStorage', /^u-[A-Za-z0-9_-]{22}$/.test(uid || ''));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /^You:/.test(document.getElementById('profile').textContent.trim()));
    check('the profile survives a reload', (await profileText()).includes(uid));
  }

  // ── a settings command drives the app, and does NOT touch the profile ──────
  {
    const pillBefore = await profileText();
    await say('bigger text');
    check('“bigger text” scales the driven app', await page.evaluate(
      () => !!document.getElementById('demo-app').style.getPropertyValue('--aa-font-scale'),
    ));
    check('a settings command leaves the profile alone', (await profileText()) === pillBefore);
  }

  // ── an unrecognized request explains itself rather than failing silently ───
  {
    await say('play a podcast from spotify');
    const reply = await lastReply();
    check('an unrecognized request says nothing is connected', /nothing is connected/i.test(reply));
    check('…and still offers what it CAN do', /bigger text/i.test(reply));
  }

  // ── back to the profile: overrides are forgotten ───────────────────────────
  {
    await say('back to my profile');
    check('a reset phrase is answered', (await lastReply()).trim().length > 0);
    check('the profile itself is not deleted by a reset', /^You:/.test((await profileText()).trim()));
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nChat E2E: ${pass} passed, ${fail} failed  (real headless Chromium)`);
process.exit(fail ? 1 : 0);
