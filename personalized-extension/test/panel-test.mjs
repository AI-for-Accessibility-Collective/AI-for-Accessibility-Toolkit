/**
 * The side panel, rendered in a real DOM from a real published state.
 *
 * This file exists because two things shipped here that the suite could not
 * see. The "Give it back" button was added, tested through the overlay only,
 * and its own bundle was never rebuilt, so it did not exist in the loaded
 * extension. And `Validation.ask()` shipped with a route, a schema and 34
 * assertions, and no surface at all — the capability was complete and
 * unreachable.
 *
 * Both are surface bugs, and a surface bug is invisible to every test that
 * checks the layer underneath it.
 *
 * Note the panel reads `chrome.storage` itself rather than taking state as an
 * argument. Stubbing that empty makes every assertion below fail in exactly
 * the way a real regression would, which is how the first version of this
 * check fooled me.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>',
  { url: 'https://www.amazon.com/dp/X' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event',
                 'getComputedStyle']) {
  global[k] = k === 'window' ? dom.window
    : (k === 'document' ? dom.window.document : dom.window[k]);
}
global.requestAnimationFrame = (f) => setTimeout(f, 0);

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const BASE = {
  contract: { item: 'sandals', size: '5', budget: 40 },
  ask: 'flat sandals size 5 under $40',
  phase: 'Check item',
  findings: [], acknowledged: [], steps: [], said: [],
};

let STATE = BASE;
global.chrome = {
  storage: {
    local: { get: async () => ({ 'aa.validation': STATE }) },
    onChanged: { addListener() {} },
  },
};
const { mountValidationPanel } = await import('../extension/validation/panel.js');

const draw = async (state) => {
  STATE = state;
  const root = document.getElementById('p');
  root.textContent = '';
  const calls = [];
  mountValidationPanel(root, { onControl: (c) => calls.push(c) });
  await new Promise((r) => setTimeout(r, 40));
  return { root, calls };
};

// ── asking about the page ────────────────────────────────────────────────────
{
  const { root, calls } = await draw({
    ...BASE,
    asked: [{ question: 'does it say anything about returns?',
      say: 'Free returns until January 31.', quote: 'Free returns' }],
  });
  const box = root.querySelector('.va-ask-page');
  ok(!!box, 'there is a way to ask about the page');
  ok(/Free returns until January 31/.test(box?.textContent || ''),
    'the last answer is shown');
  ok(!!box?.querySelector('.va-where'),
    'and it carries the page\'s own words underneath, like every other claim');

  box.querySelector('.va-ask-input').value = 'what does it cost?';
  box.querySelector('form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  ok(calls.length === 1 && calls[0].action === 'ask'
     && calls[0].question === 'what does it cost?',
    'asking sends the question');
  ok(calls.every((c) => c.action === 'ask'),
    'and nothing else - asking must never steer the agent');
}

// ── everything found is visible, not just the one being waited on ───────────
//
// The gate holds for every unread finding at once, and the panel used to hide
// everything the gate was waiting on. So a run that found three things showed
// one of them, said "And 2 more you haven't seen", and offered no way to see
// them. A recorded Wikipedia run lost the completion date and the architect
// that way — both found, both quoted, neither on screen.
{
  const findings = [
    { widget: 'search box', phase: 'Find', level: 'aside', say: 'There is a search box.' },
    { widget: 'completion date', phase: 'Read', level: 'aside',
      say: 'It was finished in 1889.', from: '31 March 1889' },
    { widget: 'architect', phase: 'Read', level: 'aside',
      say: 'Stephen Sauvestre is listed.', from: 'Stephen Sauvestre' },
  ];
  const { root } = await draw({
    ...BASE,
    findings,
    gate: { allowed: false, waitingOn: findings.map((f) => f.widget),
      leading: 'search box', unread: 3,
      say: 'Waiting for you: There is a search box. And 2 more you haven\'t seen.' },
  });
  const text = root.textContent;
  ok(/It was finished in 1889/.test(text), 'the second finding is on screen');
  ok(/Stephen Sauvestre is listed/.test(text), 'and so is the third');
  ok(/31 March 1889/.test(text),
    'each with the page\'s own words, which is the whole basis for believing it');

  const rows = [...root.querySelectorAll('.va-do')]
    .filter((b) => /Got it/.test(b.textContent));
  ok(rows.length >= 2, 'and each one can be waved past, so the agent is not stuck');

  // Pressing it has to change something on screen. It did not, and a recorded
  // Amazon run dismissed the same two findings every four seconds for the
  // length of the run because nothing ever looked answered.
  const after = await draw({
    ...BASE,
    findings,
    acknowledged: ['completion date|Read|It was finished in 1889.'],
    gate: { allowed: false, waitingOn: ['search box'], leading: 'search box', unread: 1,
      say: 'Waiting for you: There is a search box.' },
  });
  const doneItem = [...after.root.querySelectorAll('li')]
    .find((li) => /It was finished in 1889/.test(li.textContent));
  ok(!!doneItem, 'an answered finding stays on screen, as part of what was checked');
  ok(doneItem.className.includes('va-read'), 'but it is marked as read');
  ok(!doneItem.querySelector('button'), 'and it stops asking');
  const stillAsking = [...after.root.querySelectorAll('li')]
    .find((li) => /Stephen Sauvestre/.test(li.textContent));
  ok(!!stillAsking.querySelector('button'), 'while the one not yet answered still asks');

  const lead = [...root.querySelectorAll('li')]
    .filter((li) => /There is a search box/.test(li.textContent));
  ok(lead.length === 0,
    'the one the gate is already showing is not listed twice with two button rows');
}

// ── holding a part of the task ───────────────────────────────────────────────
{
  const { root, calls } = await draw({
    ...BASE, holder: 'person', handOverNode: '2.2', handOverNodeLabel: 'Pick the size',
  });
  const wheel = root.querySelector('.va-wheel');
  ok(!!wheel, 'the person holding a part is shown that they do');
  ok(/Pick the size/.test(wheel?.textContent || ''),
    'it names the part, from the label the layer publishes');
  const back = [...wheel.querySelectorAll('button')]
    .find((b) => /Give it back/.test(b.textContent));
  ok(!!back, 'there is a way back');
  back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  ok(calls.some((c) => c.action === 'hand-back'), 'and pressing it hands back');
}

// ── the agent has the wheel ──────────────────────────────────────────────────
{
  const { root } = await draw({ ...BASE });
  ok(!root.querySelector('.va-wheel'),
    'nothing about holding the wheel when the agent has it');
}

// ── going back to a decision ────────────────────────────────────────────────
//
// Trace.why() shipped with a route, 39 assertions and no surface, so nothing
// could query the record. Findings carry node, cluster, moment and verified for
// exactly this, and nothing read them.
{
  const { root, calls } = await draw({
    ...BASE,
    decisions: [
      { nodeId: '1.1', label: 'Search for it', phase: 'Find' },
      { nodeId: '2.3', label: 'Pick the size', phase: 'Check item' },
    ],
  });
  const box = root.querySelector('.va-back');
  ok(!!box, 'the decisions the run passed through can be reached');
  ok(/Pick the size/.test(box.textContent), 'each one is named');

  const b = [...box.querySelectorAll('button')].find((x) => /Pick the size/.test(x.textContent));
  b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  ok(calls.some((c) => c.action === 'why' && c.nodeId === '2.3'),
    'pressing one looks it up');
  ok(calls.every((c) => c.action === 'why'),
    'and does nothing else - going back is a lookup, never an instruction');
}

{
  const { root } = await draw({
    ...BASE,
    decisions: [{ nodeId: '2.3', label: 'Pick the size', phase: 'Check item' }],
    lookedBack: { found: true, nodeId: '2.3', label: 'Pick the size', phase: 'Check item',
      findings: [{ widget: 'size on the page' }], actions: ['click_index'],
      note: 'This is what was on the record at that point. Going back to it re-opens '
        + 'the decision; it does not undo anything that has already happened on the site.' },
  });
  const t = root.querySelector('.va-back').textContent;
  ok(/size on the page/.test(t), 'the answer says what was checked there');
  ok(/click_index/.test(t), 'and what was done there');
  ok(/does not undo/.test(t),
    'and says plainly that it re-opens the decision rather than undoing anything');
}

{
  const { root } = await draw({ ...BASE });
  ok(!root.querySelector('.va-back'),
    'nothing to go back to before the run has passed through anything');
}

console.log(`\n${pass}/${pass + fail} - the panel shows what the layer published, and asking does not steer.`);
if (fail) process.exit(1);
