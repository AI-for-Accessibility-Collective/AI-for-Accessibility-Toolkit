// Controller M2 (web) test — the DOM ControlPort adapter, exercised in node
// against a minimal hand-rolled DOM stub (no jsdom, zero deps). Proves the web
// receiver renders/undoes settings and reads content, and that the SAME
// Controller core drives it exactly as it drove the non-web mock.
//
//   node toolkit/test/controller-web.test.mjs

import { createDomReceiver } from '../web/dom-receiver.js';
import { createController } from '../createController.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// Minimal DOM stub: just the surface dom-receiver.js touches.
function makeStubApp() {
  const styles = new Map();
  const classes = new Set();
  const dataset = {};
  const headings = [
    { tagName: 'H2', textContent: 'Getting started' },
    { tagName: 'H2', textContent: 'How adaptation works' },
    { tagName: 'H3', textContent: 'Details' },
  ];
  const root = {
    style: {
      setProperty: (n, v) => styles.set(n, String(v)),
      getPropertyValue: (n) => styles.get(n) || '',
      removeProperty: (n) => styles.delete(n),
    },
    classList: {
      contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); return classes.has(c); },
    },
    dataset,
    textContent: 'Getting started How adaptation works Details some readable body text',
    getAttribute: (a) => (a === 'aria-label' ? 'Demo article' : null),
    querySelector: (sel) => (/h1|h2|heading/i.test(sel) ? headings[0] : null),
    querySelectorAll: (sel) => (/h1|h2|h3/i.test(sel) ? headings : []),
  };
  const scroller = { clientHeight: 400, _scrolled: false, scrollBy() { this._scrolled = true; } };
  return { root, scroller, styles, classes, dataset };
}

async function run() {
  // ── 1. dom-receiver direct ────────────────────────────────────────────────
  {
    const { root, scroller, styles, classes, dataset } = makeStubApp();
    const recv = createDomReceiver(root, { scrollTarget: scroller });

    const caps = await recv.describeCapabilities();
    check('web caps: platform web, has fontScale + scroll, can read', caps.platform === 'web' && caps.settingKeys.includes('fontScale') && caps.actions.includes('scroll') && caps.canReadContent);

    await recv.applySettings({ fontScale: 150, darkMode: true, contrastMode: 'yellow-black' });
    check('web apply: fontScale → --aa-font-scale 1.5', styles.get('--aa-font-scale') === '1.5');
    check('web apply: darkMode → aa-dark class', classes.has('aa-dark'));
    check('web apply: contrastMode → data-aa-contrast', dataset.aaContrast === 'yellow-black');

    const undo = await recv.undoLast();
    check('web undo: reverts all three', !styles.has('--aa-font-scale') && !classes.has('aa-dark') && dataset.aaContrast === undefined && undo.remainingUndos === 0);

    const outline = await recv.getContent('outline');
    check('web content(outline): headings', outline.outline.length === 3 && outline.source === 'untrusted-content');
    const text = await recv.getContent('text');
    check('web content(text): body text', /Getting started/.test(text.text));

    check('web action: scroll performs', (await recv.performAction('scroll', 'down')).ok && scroller._scrolled);
    check('web action: unknown refused', (await recv.performAction('teleport')).ok === false);
  }

  // ── 2. Same Controller core drives the web receiver ───────────────────────
  {
    const { root, styles, classes } = makeStubApp();
    const recv = createDomReceiver(root, {});
    const c = createController({ control: recv });

    await c.handle('bigger text'); // baseline 100 + 10 → 110 → 1.1
    check('core→web: "bigger text" renders --aa-font-scale 1.1', styles.get('--aa-font-scale') === '1.1');

    await c.handle('dark mode');
    check('core→web: "dark mode" adds aa-dark', classes.has('aa-dark'));

    const rd = await c.handle('read this');
    check('core→web: "read this" reads the app text', rd.ok && /getting started/i.test(rd.say));

    const r = await c.handle('large cursor'); // not a web-receiver capability
    check('core→web: honesty — unsupported key refused, not faked', r.ok === false && r.data.unsupported.includes('largeCursor'));
  }

  console.log(`\nController M2 (web): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
