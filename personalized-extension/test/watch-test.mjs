/**
 * Watching a value instead of deciding about it now.
 *
 * `watch` is the tenth interface type and the only one whose move is spread
 * over time: the person delegates ATTENTION, because a value the decision rests
 * on moves and they are either not ready to commit or have committed and can
 * still re-contest it. It is 7 of the 242 gold questions and appears in four of
 * the six flights videos.
 *
 * It had the right control pair from its card and nothing behind it.
 * `watch-value` had no entry in the background action map, so pressing "Watch
 * it for me" fell through to the label and reached the agent as "Watch it for
 * me. Then tell me what changed." — one re-read of the page already in front of
 * the person, which is the one thing a watch is not.
 *
 * What this covers:
 *   - pressing it registers a watched value and sends the agent nothing
 *   - the value is re-read on later settles, through the same `askPage` every
 *     other answer goes through, so a reading still carries a verbatim quote
 *   - a movement is compared against what was recorded, and raised
 *   - the two design decisions, each asserted rather than described:
 *       * a watch OUTLIVES the run — the flights case is keeping the fare watch
 *         on after booking, because a drop inside a cancellable fare class
 *         means cancel and rebook
 *       * a standing watch costs NOTHING while nobody is looking — no timer, no
 *         wakeup, nothing read on another site, nothing read twice on a page
 *         that has not changed
 *
 * Run: node test/watch-test.mjs
 */
let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const local = new Map();
const area = (m) => ({
  async get(keys) {
    const want = keys == null ? [...m.keys()] : (Array.isArray(keys) ? keys : [keys]);
    const out = {};
    for (const k of want) if (m.has(k)) out[k] = m.get(k);
    return out;
  },
  async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, v); },
  async remove(k) { m.delete(k); },
});
const spoken = [];
global.chrome = {
  storage: { local: area(local), sync: area(new Map()), session: area(new Map()) },
  runtime: { async sendMessage(m) { spoken.push(m); } },
  tabs: { async query() { return [{ id: 7 }]; } },
};

// The page the person is on. Changing it is the world moving, which is the only
// way the layer is allowed to find out that it has.
const pageWith = (fare, seats) => [
  '- heading "Flights to LAX"',
  '- text: Departs 9:40 AM, 1 stop',
  `- text: ${fare}`,
  `- text: ${seats}`,
  '- link "Track prices"',
].join('\n');

let PAGE = pageWith('$487', '3 seats left');
let URL_NOW = 'https://www.google.com/travel/flights/search';
let reads = 0;
globalThis.BrowserHarness = {
  async axSnapshot() { reads += 1; return { text: PAGE, url: URL_NOW }; },
};

const agent = { calls: [] };
globalThis.BrowserAgent = {
  isRunning: () => true,
  pause: (o) => { agent.calls.push(['pause', o]); return { paused: true, atStep: 2 }; },
  resume: (o) => { agent.calls.push(['resume', o]); return { resumed: true }; },
  interject: (s) => { agent.calls.push(['interject', s]); return { queued: 1 }; },
  stop: (r) => { agent.calls.push(['stop', r]); },
};

const R = await import('../extension/validation/reasoner.js');
const Watch = await import('../extension/validation/watch.js');
const { default: Validation } = await import('../extension/validation/session.js');
const state = async () => (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};

// The model reads whatever the current page says. It is asked ONE question -
// the watch's own - and it answers with the page's own words, so every reading
// is checkable the same way every other answer in this layer is.
let modelCalls = 0;
let lastPrompt = null;
R.setGeminiCaller(async (prompt) => {
  modelCalls += 1;
  lastPrompt = prompt;
  const m = /- text: (\$[\d,.]+)/.exec(PAGE);
  return JSON.stringify(m
    ? { answer: m[1], quote: `- text: ${m[1]}`, confidence: 0.9 }
    : { answer: null, quote: null, confidence: 0.2 });
});

// Wall-clock intervals a test cannot wait out.
Watch.setWatchTiming({ minRereadMs: 0 });

// ── the value is read out of a reading, and only when it is really there ─────
{
  ok(Watch.valueIn('$1,234.56 round trip, 2 stops') === 1234.56,
    'the fare is read out of a sentence with three numbers in it');
  ok(Watch.valueIn('3 seats left') === 3, 'a count is a value too');
  ok(Watch.valueIn('Sold out') === null,
    'and a reading with no number in it says so rather than inventing a zero');

  const same = Watch.compare({ answer: '$487', quote: 'x' }, { answer: '$487.00', quote: 'x' });
  ok(same.moved === false, 'the same number written two ways has not moved');
  const down = Watch.compare({ answer: '$487', quote: 'x' }, { answer: '$412', quote: 'x' });
  ok(down.moved === true && down.direction === 'down' && down.delta === -75,
    'a drop is a move, with its direction and how far');
  const gone = Watch.compare({ answer: '$487', quote: 'x' }, { answer: 'Sold out', quote: 'x' });
  ok(gone.moved === true && gone.on === 'what it says',
    'a price becoming "Sold out" is a move even though one side has no number');
  const quiet = Watch.compare({ answer: 'In stock', quote: 'x' }, { answer: 'in stock.', quote: 'x' });
  ok(quiet.moved === false, 'punctuation and case are not movement');
  const nothing = Watch.compare({ answer: '$487', quote: 'x' }, { answer: null, quote: null });
  ok(nothing.moved === false && /does not say/.test(nothing.why),
    'a page that does not say is not a value that held steady');
}

await Validation.start('a flight to LAX in October under $500');

// ── pressing it registers a watch, and steers nothing ────────────────────────
let watchId = null;
{
  agent.calls.length = 0;
  const before = modelCalls;
  const r = await Validation.watch({
    nodeId: '2.4', widget: 'Watch it instead of booking?', quote: '- text: $487' });

  watchId = r.id;
  ok(r.watching === true, 'the value is being watched');
  ok(modelCalls === before + 1,
    'one call takes the baseline, through the same reader every later reading uses');
  ok(r.baseline.answer === '$487', 'and the baseline is what the page said');
  ok(agent.calls.length === 0,
    'the agent is told nothing - pressing "watch it" is a way of NOT deciding now');
  ok(/\$487/.test(r.question),
    'the question is anchored to the page\'s own words, not to the task model\'s '
    + '"Watch it instead of booking?", which no page can answer');

  const live = await Validation.watches();
  ok(live.length === 1 && live[0].node === '2.4', 'it is on the register, keyed to its node');
  ok(live[0].origin === 'https://www.google.com',
    'with the site the value was read off, which is what bounds where it looks');
  ok(spoken.some((m) => /I am watching/.test(m.lines?.[0]?.say || '')),
    'and the person is told it is being watched');
  ok(spoken.some((m) => /not checking it in the background/.test(m.lines?.[0]?.say || '')),
    'including the honest limit: it looks at pages they open, it is not a service');
}

// ── a still page costs nothing ──────────────────────────────────────────────
{
  const before = modelCalls;
  await Validation.observe(7);
  ok(modelCalls === before,
    'a page that has not changed since the watch read it costs no model call');

  URL_NOW = 'https://www.example.com/anything';
  PAGE = `${pageWith('$487', '3 seats left')}\n- text: a different site entirely`;
  await Validation.observe(7);
  ok(modelCalls === before, 'and a page on another site is not read at all');
  URL_NOW = 'https://www.google.com/travel/flights/search';
}

// ── the value moves, and the layer says so ──────────────────────────────────
{
  const before = modelCalls;
  PAGE = pageWith('$412', '3 seats left');
  const r = await Validation.observe(7);

  ok(modelCalls === before + 1, 'a changed page on the watched site is read, once');
  ok(r.watched.moved === 1, 'the movement is found');
  ok(/scoped|ONE question|watching one value/i.test(lastPrompt || ''),
    'and it was found by asking one question about this page, not by re-reading everything');

  const said = spoken.filter((m) => m.phase === 'watch').pop();
  ok(/gone down/.test(said?.lines?.[0]?.say || ''), 'the person hears which way it went');
  ok(/487/.test(said?.lines?.[0]?.say || '') && /412/.test(said?.lines?.[0]?.say || ''),
    'with both numbers, so they can judge it rather than take the word "down"');

  const s = await state();
  const f = (s.findings || []).find((x) => x.source === 'watch');
  ok(!!f, 'and with a task running it becomes a finding like any other');
  ok(f.control?.action === 'watch-stop' && f.control?.decline === 'Keep watching',
    'whose control is the one that now applies: stop watching, or keep watching');
}

// ── it is not reported twice ────────────────────────────────────────────────
{
  const before = modelCalls;
  PAGE = `${pageWith('$412', '3 seats left')}\n- text: an unrelated banner appeared`;
  const r = await Validation.observe(7);
  ok(modelCalls === before + 1, 'the page changed, so it is read');
  ok(r.watched.moved === 0, 'but the value did not, so nothing is said again');
}

// ── the floor between reads ─────────────────────────────────────────────────
{
  Watch.setWatchTiming({ minRereadMs: 60_000 });
  const before = modelCalls;
  PAGE = pageWith('$399', '3 seats left');
  const r = await Validation.observe(7);
  ok(modelCalls === before,
    'a second look too soon after the last one is not taken, however much the page churns');
  ok(r.watched.skipped.some((s) => /too recently/.test(s.why)),
    'and the reason is on the record rather than looking like nothing happened');
  Watch.setWatchTiming({ minRereadMs: 0 });
}

// ── a watch outlives the run ────────────────────────────────────────────────
//
// The decision, and the flights gold is the reason for it: the expert keeps the
// price watch on AFTER booking, because a drop inside a cancellable fare class
// means cancel and rebook. A registry that died with the run could not express
// the one move the type is actually for.
{
  await Validation.stop();
  ok(Validation.isRunning() === false, 'the task has ended');
  const live = await Validation.watches();
  ok(live.length === 1 && live[0].id === watchId,
    'and the watch is still standing, because that is what the flights case does');

  const before = modelCalls;
  PAGE = pageWith('$355', '3 seats left');
  const r = await Validation.observe(7);
  ok(modelCalls === before + 1, 'a settle after the run still reads it');
  ok(r.watched.moved === 1, 'and still finds the movement');

  const s = await state();
  ok((s.watchAlerts || []).some((a) => /355/.test(a.say)),
    'which is recorded as an alert the person can see');
  ok(!(s.findings || []).some((x) => /355/.test(x.say || '')),
    'and NOT as a finding - a finding with no run would sit unread in storage and '
    + 'hold the gate of whatever task starts next');
  ok(spoken.filter((m) => m.phase === 'watch').pop()?.lines?.[0]?.say.includes('$355'),
    'the person is still told, which is the whole point of it outliving the run');
}

// ── what it costs when nobody is looking ────────────────────────────────────
{
  const before = modelCalls;
  const readsBefore = reads;
  await new Promise((r) => setTimeout(r, 150));
  ok(modelCalls === before && reads === readsBefore,
    'time passing costs nothing: there is no timer, no alarm and no background tab');
}

// ── stopping it ─────────────────────────────────────────────────────────────
{
  const r = await Validation.unwatch({ id: watchId });
  ok(r.stopped === true, 'the person can stop watching');
  ok((await Validation.watches()).length === 0, 'and it is off the register');

  const before = modelCalls;
  PAGE = pageWith('$99', '1 seat left');
  const after = await Validation.observe(7);
  ok(modelCalls === before, 'a stopped watch reads nothing, however far the value moves');
  ok(after.skipped === 'no validation run in progress',
    'and with no run and no watch, a settle is skipped on one storage read');

  ok((await Validation.unwatch({ id: 'w-nothing' })).stopped === false,
    'stopping a watch that was never set says so rather than pretending');
}

// ── a watch is bounded, because nobody re-consents to a standing one ────────
{
  await Validation.start('a flight to LAX in October under $500');
  PAGE = pageWith('$487', '3 seats left');
  for (let i = 0; i < Watch.MAX_WATCHES; i += 1) {
    await Validation.watch({ nodeId: `2.${i}`, widget: `Q${i}`, quote: '- text: $487' });
  }
  ok((await Validation.watches()).length === Watch.MAX_WATCHES,
    `${Watch.MAX_WATCHES} watches stand at once`);
  const over = await Validation.watch({ nodeId: '9.9', widget: 'one too many', quote: '- text: $487' });
  ok(over.watching === false && /as many as I will keep track of/.test(over.why),
    'and the next one is refused out loud rather than quietly evicting an older one');

  const again = await Validation.watch({ nodeId: '2.0', widget: 'Q0', quote: '- text: $487' });
  ok(again.watching === true && again.replaced === true,
    'pressing the same button twice is one intention, not two watches');

  await Watch.clear();
  Watch.setWatchTiming({ horizonMs: -1 });
  const w = await Validation.watch({ nodeId: '3.3', widget: 'expires now', quote: '- text: $487' });
  ok(w.watching === true, 'a watch is set');
  ok(!(await Validation.watches()).some((x) => x.id === w.id),
    'and stops standing once its horizon has passed, without a timer to expire it');
  Watch.setWatchTiming({ horizonMs: 30 * 24 * 60 * 60 * 1000 });
}

// ── the finding a press comes from carries what the press needs ─────────────
{
  const findings = R.toFindings({
    alignedNodes: ['2.4'], noticed: [],
    answers: [{ node: '2.4', question: 'Watch it instead of booking?',
                answer: 'The fare is $487.', quote: '- text: $487',
                verify: 'verified_exact', cluster: 'watch', moment: 'Now',
                confidence: 0.8 }],
  }, 'Compare the results');
  ok(findings[0].control.action === 'watch-value',
    'a watch finding offers the watch control its card specifies');
  ok(findings[0].control.node === '2.4' && findings[0].control.widget === 'Watch it instead of booking?',
    'carrying the node AND the question, because the overlay hands back the control and nothing else');
}

await Validation.stop();
await Watch.clear();


// ── a watch that runs out says so ───────────────────────────────────────────
//
// live() filters expired watches out, so before this a watch simply stopped
// looking and never mentioned it. Someone who asked for a price to be watched
// went on believing it was being watched. An unflagged absence is the failure
// this layer exists to surface, so it cannot be the layer's own behaviour.
{
  await Watch.clear();
  Watch.setWatchTiming({ horizonMs: 50 });
  const added = await Watch.add({ label: 'the price', widget: 'Watching the price',
    question: 'what is the price?', baseline: { answer: '$40.00', quote: '$40.00' } });
  const id = added.watch.id;

  ok((await Watch.lapsed()).length === 0, 'a fresh watch has not lapsed');
  ok((await Watch.live()).length === 1, 'and it is live');

  await new Promise((r) => setTimeout(r, 80));

  const out = await Watch.lapsed();
  ok(out.length === 1 && out[0].id === id, 'once the horizon passes it is reported as lapsed');
  ok((await Watch.live()).length === 0, 'and it has dropped out of the live set');

  await Watch.markLapsed(id);
  ok((await Watch.lapsed()).length === 0,
    'told once and not again - a watch that ran out is news exactly one time');
  ok((await Watch.all()).some((w) => w.id === id),
    'the record of it stays, so what was watched can still be looked up');
  Watch.setWatchTiming({ horizonMs: 30 * 24 * 60 * 60 * 1000 });
}

console.log(`\n${pass}/${pass + fail} - a value can be watched across time, it outlives the run, and it costs nothing while nobody is looking.`);
if (fail) process.exit(1);
