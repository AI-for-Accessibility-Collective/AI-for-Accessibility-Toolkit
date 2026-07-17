// Screen-reader adapters — realistic end-to-end DOM tests.
//
// Runs the real adapter modules (fix-landmarks, fix-links, fix-tables) and the
// missing-landmarks auditor against messy, real-world-shaped pages in a jsdom
// DOM, with a controllable AI provider injected via setAIProvider. Asserts the
// user-facing outcome (correct ARIA added, nothing good clobbered, idempotent),
// not internals.
//
// Run: node tools/test/adapters-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { fixLandmarks, ensureMainLandmark, ensureStructuralLandmarks } from '../adapters/fix-landmarks.js';
import { improveAmbiguousLinks, improveAmbiguousLink } from '../adapters/fix-links.js';
import { fixAllTables, fixTableHeaders } from '../adapters/fix-tables.js';
import { auditLandmarks, pageMissingMainLandmark, findUnmarkedNavigation } from '../auditors/missing-landmarks.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// Mount a page body into a fresh jsdom and expose the globals the adapters read.
// jsdom gives every element a 0-size rect; override so isVisible() behaves like
// a real laid-out page (elements are visible unless CSS-hidden).
function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0 };
  };
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.CSS = window.CSS || { escape: (s) => s };
  return window.document;
}

// A recording AI provider: deterministic answers + a call log, so tests can
// drive the AI paths and assert the AI was (or wasn't) used.
function fakeAI(overrides = {}) {
  const calls = { improveLinkText: [], inferColumnHeader: [] };
  setAIProvider({
    improveLinkText: async (text, href, context) => {
      calls.improveLinkText.push({ text, href, context });
      if (overrides.improveLinkText) return overrides.improveLinkText(text, href, context);
      return `Go to ${new URL(href).pathname.replace('/', '') || 'page'}`;
    },
    inferColumnHeader: async (samples) => {
      calls.inferColumnHeader.push(samples);
      if (overrides.inferColumnHeader) return overrides.inferColumnHeader(samples);
      return 'Inferred';
    },
  });
  return calls;
}

async function run() {
  // ── LANDMARKS ──────────────────────────────────────────────────────────────

  // Div-soup news page: no <main>, a link-cluster nav, a big article block.
  {
    const doc = mount(`
      <div class="site-nav"><a href="/">Home</a><a href="/news">News</a><a href="/sport">Sport</a><a href="/tv">TV</a></div>
      <div class="article"><p>${'The quick brown fox jumped over the lazy dog. '.repeat(6)}</p><p>More body copy here.</p></div>
      <div class="legal">© 2026 Example</div>`);
    fakeAI();
    const n = fixLandmarks();
    check('landmarks: adds a main to the article block', doc.querySelector('.article').getAttribute('role') === 'main');
    check('landmarks: does not mislabel nav or footer as main', doc.querySelectorAll('[role="main"]').length === 1);
    check('landmarks: labels the link cluster as navigation', doc.querySelector('.site-nav').getAttribute('role') === 'navigation');
    check('landmarks: reports the fixes it applied', n >= 2);
    const before = doc.body.innerHTML;
    fixLandmarks();
    check('landmarks: idempotent (second pass is a no-op)', doc.body.innerHTML === before);
  }

  // SPA shell: a single <div id="root"> wrapping header/nav/content/footer.
  {
    const doc = mount(`
      <div id="root">
        <header>Brand</header>
        <nav><a href="/">Home</a></nav>
        <div class="view"><p>${'Application content that is clearly the main region. '.repeat(4)}</p></div>
        <footer>Legal</footer>
      </div>`);
    fakeAI();
    ensureMainLandmark();
    check('landmarks: descends into SPA shell to find the main region', doc.querySelector('.view').getAttribute('role') === 'main');
    check('landmarks: never labels the shell root as main', doc.querySelector('#root').getAttribute('role') !== 'main');
  }

  // Page that already has a real <main> — must be left untouched.
  {
    const doc = mount(`<header>h</header><main><p>Existing main content on the page.</p></main><footer>f</footer>`);
    fakeAI();
    const added = ensureMainLandmark();
    check('landmarks: no-op when a <main> already exists', added === false);
    check('landmarks: does not add role=main alongside native <main>', doc.querySelectorAll('[role="main"]').length === 0);
  }

  // Nothing qualifies (all landmarks / too little text) — must refuse, not guess.
  {
    const doc = mount(`<header>Header</header><nav><a href="/">a</a></nav><footer>Footer</footer>`);
    fakeAI();
    const added = ensureMainLandmark();
    check('landmarks: refuses to mislabel when no real content block exists', added === false && doc.querySelectorAll('[role="main"]').length === 0);
  }

  // Structural nav heuristic must NOT fire on a prose block that merely has links.
  {
    const doc = mount(`<div class="navbar-brand"><a href="/">${'Read our long editorial about the news of the day. '.repeat(4)}</a> and <a href="/x">one</a> <a href="/y">two</a></div>`);
    fakeAI();
    const fixed = ensureStructuralLandmarks();
    check('landmarks: prose-with-links is not miscalled navigation', fixed === 0 && !doc.querySelector('.navbar-brand').getAttribute('role'));
  }

  // ── AMBIGUOUS LINKS ──────────────────────────────────────────────────────────

  {
    const doc = mount(`
      <article>
        <p>The Q3 report is published. <a href="https://example.com/q3-report">click here</a> to open it.</p>
        <p>Pricing changed — <a href="https://example.com/pricing">read more</a>.</p>
        <p>Also see <a href="https://example.com/about">our full company history</a>.</p>
      </article>`);
    const calls = fakeAI({
      improveLinkText: (text) => text === 'our full company history' ? text : `Open ${text.replace(/\s+/g, '-')}`,
    });
    const links = Array.from(doc.querySelectorAll('a'));
    await improveAmbiguousLinks(links);
    const [l1, , l3] = links;
    check('links: ambiguous "click here" gets a descriptive aria-label', !!l1.getAttribute('aria-label') && l1.getAttribute('aria-label') !== 'click here');
    check('links: visible text is never rewritten (non-destructive)', l1.textContent === 'click here');
    check('links: adapted links are flagged for styling', l1.classList.contains('ai4a11y-adapted'));
    check('links: a link the AI returns unchanged gets no aria-label', !l3.getAttribute('aria-label'));
    check('links: the AI was consulted for each link', calls.improveLinkText.length === 3);
    const callsBefore = calls.improveLinkText.length;
    await improveAmbiguousLinks(links);
    check('links: idempotent (processed links are skipped on re-run)', calls.improveLinkText.length === callsBefore);
  }

  // Per-page AI cap: a list page with 15 ambiguous links spends only 10 calls.
  {
    const doc = mount(`<ul>${Array.from({ length: 15 }, (_, i) => `<li><a href="https://example.com/i${i}">read more</a></li>`).join('')}</ul>`);
    const calls = fakeAI();
    await improveAmbiguousLinks(doc.querySelectorAll('a'));
    check('links: caps AI calls at 10 per page', calls.improveLinkText.length === 10);
    check('links: only the capped links are labeled', doc.querySelectorAll('a[aria-label]').length === 10);
  }

  // AI returns null (no suggestion) → link left as-is, marked failed, no crash.
  {
    const doc = mount(`<p><a href="https://example.com/x">click here</a></p>`);
    fakeAI({ improveLinkText: () => null });
    const link = doc.querySelector('a');
    const r = await improveAmbiguousLink(link);
    check('links: null AI result leaves the link unlabeled', r === null && !link.getAttribute('aria-label'));
    check('links: null AI result marks the link failed', link.dataset.ai4a11yProcessed === 'failed');
  }

  // ── TABLES ───────────────────────────────────────────────────────────────────

  // A real header row (short, distinct labels) → converted deterministically.
  {
    const doc = mount(`
      <table>
        <tr><td>Name</td><td>Age</td><td>City</td></tr>
        <tr><td>Alice</td><td>30</td><td>NYC</td></tr>
        <tr><td>Bob</td><td>25</td><td>LA</td></tr>
      </table>`);
    const calls = fakeAI();
    const table = doc.querySelector('table');
    const changed = await fixTableHeaders(table);
    check('tables: promotes a genuine header row to <th scope=col>', changed === true && table.querySelectorAll('th[scope="col"]').length === 3);
    check('tables: header cells keep their text', table.querySelector('th').textContent === 'Name');
    check('tables: header-row promotion uses no AI', calls.inferColumnHeader.length === 0);
  }

  // Data-only rows (first row is data, a value repeats below) → AI infers headers.
  {
    const doc = mount(`
      <table>
        <tr><td>NYC</td><td>100</td></tr>
        <tr><td>LA</td><td>200</td></tr>
        <tr><td>NYC</td><td>300</td></tr>
        <tr><td>SF</td><td>400</td></tr>
      </table>`);
    const calls = fakeAI({ inferColumnHeader: (s) => (s.includes('100') ? 'Amount' : 'City') });
    const table = doc.querySelector('table');
    const changed = await fixTableHeaders(table);
    const ths = table.querySelectorAll('thead th[scope="col"]');
    check('tables: inserts AI-inferred headers for headerless data', changed === true && ths.length === 2);
    check('tables: generated header is flagged as AI-generated', table.querySelector('thead').dataset.ai4a11yGenerated === 'true');
    check('tables: the AI was asked once per column', calls.inferColumnHeader.length === 2);
    check('tables: original data rows are preserved', table.querySelectorAll('tr').length === 5);
  }

  // Non-clobbering + skip rules via fixAllTables.
  {
    const doc = mount(`
      <table id="has-th"><tr><th>A</th></tr><tr><td>1</td></tr></table>
      <table id="layout" role="presentation"><tr><td>x</td></tr><tr><td>y</td></tr></table>
      <table id="tiny"><tr><td>only one row</td></tr></table>
      <table id="fixme"><tr><td>Product</td><td>Price</td></tr><tr><td>Widget</td><td>$9</td></tr></table>`);
    fakeAI();
    const fixed = await fixAllTables();
    check('tables: skips tables that already have <th>', doc.querySelector('#has-th thead') === null);
    check('tables: skips layout tables (role=presentation)', !doc.querySelector('#layout').querySelector('th'));
    check('tables: fixes only the headerless data table', fixed === 1 && !!doc.querySelector('#fixme th[scope="col"]'));
    const again = await fixAllTables();
    check('tables: idempotent (second sweep fixes nothing)', again === 0);
  }

  // AI failure mid-inference → table marked failed, left structurally intact.
  {
    const doc = mount(`
      <table>
        <tr><td>NYC</td><td>100</td></tr>
        <tr><td>LA</td><td>200</td></tr>
        <tr><td>NYC</td><td>300</td></tr>
        <tr><td>SF</td><td>400</td></tr>
      </table>`);
    fakeAI({ inferColumnHeader: () => { throw new Error('provider down'); } });
    const table = doc.querySelector('table');
    const changed = await fixTableHeaders(table);
    check('tables: AI failure does not corrupt the table', changed === false && !table.querySelector('thead'));
    check('tables: AI failure marks the table failed', table.dataset.ai4a11yProcessed === 'failed');
  }

  // ── AUDITOR ──────────────────────────────────────────────────────────────────

  {
    mount(`
      <div class="main-nav"><a href="/">Home</a><a href="/a">A</a><a href="/b">B</a></div>
      <div class="content"><p>${'Body text. '.repeat(20)}</p></div>`);
    fakeAI();
    const audit = auditLandmarks();
    check('auditor: detects the missing main landmark', audit.hasMain === false && pageMissingMainLandmark() === true);
    check('auditor: reports no banner/contentinfo/navigation on div-soup', !audit.hasBanner && !audit.hasContentinfo && !audit.hasNavigation);
    check('auditor: flags the unmarked nav cluster', audit.unmarkedNavCandidates === 1 && findUnmarkedNavigation().length === 1);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
