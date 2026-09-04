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
// Needs a Chromium download (`npx playwright install chromium`), so it is named
// *-e2e.mjs rather than *.test.mjs and `npm test` does not pick it up, the
// same split tools/test/browser-validate.js uses. CI runs it in the separate
// `browser` workflow (.github/workflows/browser.yml), which is not a required
// check and triggers on the paths listed there. Run:
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

  // ── a disclosure whose condition is also a settings keyword ───────────────
  // "dyslexia" parses as a dyslexia-font command too, and used to be handled as
  // one, so it never reached the profile. It now onboards like any other
  // disclosure.
  {
    await say('I have dyslexia');
    const pill = await profileText();
    check('a dyslexia disclosure reaches the profile', /reading/i.test(pill));
    check('…without dropping what was already known', /vision/i.test(pill));
  }

  // ── a disclosure adapts the page, not just the profile ────────────────────
  // Telling the surface about yourself has to DO something. The reading area
  // derives dyslexiaFont, so the disclosure above should have rendered.
  {
    check('a disclosure applies its derived settings', await page.evaluate(
      () => document.getElementById('demo-app').classList.contains('aa-dyslexia'),
    ));

    // …and says so. The page changing under someone with no explanation is
    // worse than it not changing, so the reply names what it did, in words
    // written for the person rather than the registry's developer wording.
    const reply = await lastReply();
    check('the answer says the page was changed', /changed this page to match/i.test(reply));
    check('…and names it in plain words', /a dyslexia-friendly font/.test(reply));
    check('…not in registry/developer wording', !/OpenDyslexic|settingsMeta|ARIA landmarks/.test(reply));
  }

  // ── the profile follows the person across a reload ────────────────────────
  // The point of storing a profile rather than toggling a setting: a returning
  // person's page matches their profile before they ask for anything.
  {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.getElementById('demo-app').classList.contains('aa-dyslexia'),
      null,
      { timeout: 10000 },
    ).catch(() => {});
    check('the adaptation is back after a reload, unasked', await page.evaluate(
      () => document.getElementById('demo-app').classList.contains('aa-dyslexia'),
    ));
  }

  // ── an unrecognized request explains itself rather than failing silently ───
  {
    await say('play a podcast from spotify');
    const reply = await lastReply();
    check('an unrecognized request says nothing is connected', /nothing is connected/i.test(reply));
    check('…and still offers what it CAN do', /bigger text/i.test(reply));
  }

  // ── back to the profile: overrides are forgotten ───────────────────────────
  // The reply says "I forgot N changes you'd made", so the page has to agree
  // with it. Reset re-renders the profile, which restores every key the profile
  // governs; a key the profile never mentions is a separate question, checked
  // below.
  {
    await say('dark mode');                       // a manual change the profile never asked for
    const darkBefore = await page.evaluate(() => document.getElementById('demo-app').classList.contains('aa-dark'));
    check('a manual change applies', darkBefore === true);

    await page.evaluate(() => document.getElementById('demo-app').classList.remove('aa-dyslexia'));

    await say('back to my profile');
    check('a reset phrase is answered', (await lastReply()).trim().length > 0);
    check('the profile itself is not deleted by a reset', /^You:/.test((await profileText()).trim()));
    check('a reset re-renders what the profile governs', await page.evaluate(
      () => document.getElementById('demo-app').classList.contains('aa-dyslexia'),
    ));

    const darkAfter = await page.evaluate(() => document.getElementById('demo-app').classList.contains('aa-dark'));
    check('KNOWN: a setting the profile never mentions survives a reset', darkAfter === true);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nChat E2E: ${pass} passed, ${fail} failed  (real headless Chromium)`);
process.exit(fail ? 1 : 0);
