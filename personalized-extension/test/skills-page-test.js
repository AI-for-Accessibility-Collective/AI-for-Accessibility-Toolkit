// Skill Builder page smoke test — drives the real skill-builder/skills.html
// in a headless browser against a mocked background, verifying the UI glue:
// build → preview → save → list → apply.
// Run: node test/skills-page-test.js
const puppeteer = require('puppeteer');
const path = require('path');

const PAGE = path.resolve(__dirname, '..', 'extension', 'skill-builder', 'skills.html');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } };

// A canned skill the mocked Engineer "builds".
const BUILT = {
  name: 'news-calm', description: 'Calm, readable news pages.',
  supportAreas: ['vision'], siteRelevance: ['news'],
  recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 130 } }, { id: 'focus-mode', settings: { focusMode: true } }] },
  body: '# News Calm',
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Mock chrome.* BEFORE the page script runs. sendMessage routes by type to
  // canned responses and records what was sent (so we can assert apply/save).
  await page.evaluateOnNewDocument(() => {
    window.__sent = [];
    let mineSkills = [];
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          window.__sent.push(msg);
          let resp = {};
          if (msg.type === 'librarianListSkills') {
            resp = { skills: [
              { name: 'reading-aid', description: 'Reading help.', source: 'builtin', recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 130 } }] } },
              { name: 'turn-on-captions', description: 'Runs a saved task.', source: 'mine', recipe: { adapters: [], actions: [{ name: 'Turn on captions', prompt: 'Turn on captions for this video' }] } },
              ...mineSkills.map(s => ({ ...s, source: 'mine' })),
            ] };
          } else if (msg.type === 'librarianBuildSkill') {
            resp = { skill: window.__BUILT, valid: true, errors: [] };
          } else if (msg.type === 'librarianSaveSkill') {
            mineSkills.push(msg.skill); resp = { saved: true, errors: [] };
          } else if (msg.type === 'librarianResolveSkill') {
            resp = msg.skill?.recipe?.actions?.length
              ? { plan: { settings: {}, adapterIds: [], actions: msg.skill.recipe.actions } }
              : { plan: { settings: { fontScale: 130, focusMode: true }, adapterIds: ['visual-assist', 'focus-mode'] } };
          } else if (msg.type === 'runSkillActions') {
            resp = { started: true, count: (msg.actions || []).length };
          } else if (msg.type === 'librarianRetrieveSkill') {
            resp = { skill: { name: 'reading-aid' } };
          } else if (msg.type === 'librarianFindSkill') {
            resp = /\breading\b/.test(msg.need)
              ? { skill: { name: 'reading-aid', description: 'Reading help.', source: 'builtin' } }
              : {};
          } else if (msg.type === 'librarianDeleteSkill') {
            mineSkills = mineSkills.filter(s => s.name !== msg.name); resp = { deleted: true };
          }
          setTimeout(() => cb(resp), 0);
        },
      },
      tabs: {
        query: (_q, cb) => { const r = [{ id: 7, url: 'https://www.nytimes.com/x' }]; return cb ? cb(r) : Promise.resolve(r); },
        sendMessage: (id, msg) => { window.__sent.push({ __toTab: id, ...msg }); return Promise.resolve({ success: true }); },
      },
    };
  });
  await page.evaluateOnNewDocument((b) => { window.__BUILT = b; }, BUILT);

  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => document.getElementById('skillList')?.children.length > 0, { timeout: 5000 });

  // Initial list loaded (built-in reading-aid).
  check('list renders built-in skills on load', await page.$eval('#skillList', el => el.children.length) >= 1);
  check('built-in card shows adapters', (await page.$eval('.skill-adapters', el => el.textContent)).includes('visual-assist'));

  // Build a skill → preview appears.
  await page.type('#needInput', 'calm readable news');
  await page.click('#buildBtn');
  await page.waitForFunction(() => !document.getElementById('preview').hidden, { timeout: 5000 });
  check('preview shows built skill name', (await page.$eval('#previewName', el => el.textContent)) === 'news-calm');
  check('preview lists composed adapters', (await page.$eval('#previewAdapters', el => el.textContent)).includes('visual-assist'));
  check('build sent librarianBuildSkill with the need', await page.evaluate(() => window.__sent.some(m => m.type === 'librarianBuildSkill' && /news/.test(m.need))));

  // Try before save: the unsaved built skill can be applied to the page.
  await page.click('#tryBtn');
  await page.waitForFunction(() => window.__sent.some(m => m.__toTab === 7 && m.type === 'applySkill'), { timeout: 5000 });
  check('try applies the built skill before saving', await page.evaluate(() => {
    const m = window.__sent.find(x => x.__toTab === 7 && x.type === 'applySkill');
    return m?.plan?.settings?.fontScale === 130;
  }));

  // Feedback loop: "Improve it" sends the rejected attempt + feedback back.
  await page.type('#feedbackInput', 'text still too small');
  await page.click('#improveBtn');
  await page.waitForFunction(() => window.__sent.some(m =>
    m.type === 'librarianBuildSkill' && m.feedback && m.previous), { timeout: 5000 });
  check('improve sends previous skill and feedback to the Engineer', await page.evaluate(() => {
    const m = window.__sent.find(x => x.type === 'librarianBuildSkill' && x.feedback);
    return m.previous?.name === 'news-calm' && /too small/.test(m.feedback);
  }));

  // Save → preview hides, list grows, save message sent.
  await page.click('#saveBtn');
  await page.waitForFunction(() => document.getElementById('preview').hidden, { timeout: 5000 });
  check('save sent librarianSaveSkill', await page.evaluate(() => window.__sent.some(m => m.type === 'librarianSaveSkill' && m.skill?.name === 'news-calm')));
  await page.waitForFunction(() => [...document.querySelectorAll('.skill-name')].some(e => e.textContent === 'news-calm'), { timeout: 5000 });
  check('saved skill appears in list as yours', await page.evaluate(() =>
    [...document.querySelectorAll('.skill-card')].some(c => /news-calm/.test(c.textContent) && /yours/.test(c.textContent))));

  // Apply the built-in skill → resolves + messages the tab with applySkill.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.skill-card')].find(c => /reading-aid/.test(c.textContent));
    card.querySelector('.btn-primary').click();
  });
  await page.waitForFunction(() => window.__sent.some(m => m.__toTab === 7 && m.type === 'applySkill'), { timeout: 5000 });
  const applyMsg = await page.evaluate(() => window.__sent.find(m => m.__toTab === 7 && m.type === 'applySkill'));
  check('apply resolves skill first', await page.evaluate(() => window.__sent.some(m => m.type === 'librarianResolveSkill')));
  check('apply sends resolved settings to the tab', applyMsg?.plan?.settings?.fontScale === 130);

  // Action skill (a reusable task saved as a skill): the card names the task
  // and Apply hands it to the browser agent for the chosen tab.
  check('action skill card shows the task it runs', await page.evaluate(() =>
    [...document.querySelectorAll('.skill-card')].some(c => /Runs: Turn on captions/.test(c.textContent))));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.skill-card')].find(c => /turn-on-captions/.test(c.textContent));
    card.querySelector('.btn-primary').click();
  });
  await page.waitForFunction(() => window.__sent.some(m => m.type === 'runSkillActions'), { timeout: 5000 });
  check('applying an action skill asks the agent to run it', await page.evaluate(() => {
    const m = window.__sent.find(x => x.type === 'runSkillActions');
    return m.tabId === 7 && m.actions[0].prompt === 'Turn on captions for this video';
  }));

  // Reuse-before-build: a need an existing skill covers gets an offer first,
  // and "Build a new one anyway" then proceeds to the Engineer.
  await page.evaluate(() => { document.getElementById('needInput').value = ''; window.__sent.length = 0; });
  await page.type('#needInput', 'help with reading');
  await page.click('#buildBtn');
  await page.waitForFunction(() => !document.getElementById('reuseOffer').hidden, { timeout: 5000 });
  check('covered need offers the existing skill instead of building', await page.evaluate(() =>
    document.getElementById('reuseText').textContent.includes('reading-aid')
    && !window.__sent.some(m => m.type === 'librarianBuildSkill')));
  await page.click('#reuseBuildBtn');
  await page.waitForFunction(() => window.__sent.some(m => m.type === 'librarianBuildSkill' && /reading/.test(m.need)), { timeout: 5000 });
  check('build anyway proceeds to the Engineer', await page.evaluate(() =>
    document.getElementById('reuseOffer').hidden));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
