/**
 * Scale fuzz: matchDomain against the dataset it will actually face.
 *
 * The shipped retrieval index (validation/htas/index.json) carries 3 domains.
 * The research pipeline's dataset carries ~109, and every one of them is headed
 * for this index. So the matcher's two safety rules — two distinct word hits,
 * twice the runner-up — are here scored against the full set, because the
 * failure that matters (retrieving hotel's model for an apartment query) only
 * exists once the near-neighbours are all present.
 *
 * Three properties:
 *   1. SAFETY   — a domain's own task line must retrieve that domain or
 *                 nothing, never a different domain. A wrong tier-1 match is
 *                 the exact failure the generated path was built to end.
 *   2. COVERAGE — the 3 shipped domains must still retrieve on natural
 *                 phrasings when 100+ other domains are competing.
 *   3. OFF-DOMAIN — 40 queries outside every domain must all fall through to
 *                 generation (null).
 *
 * Deterministic: no randomness anywhere; the "fuzz" is the dataset itself.
 * Depends on the research dataset on David's machine; when it is absent the
 * test SKIPS loudly and exits 0 rather than failing a machine that simply
 * does not have the corpus.
 *
 * MEASURED 2026-08-20 at 109 domains: safety holds perfectly (109/109
 * self-retrieval, 0 collisions, 0 false hits on 40 off-domain queries) and
 * COVERAGE IS 0/9 — the retrieval tier never fires. The cause is the
 * document-frequency weighting itself: at 109 domains every discriminative
 * word is shared with neighbours (hotel df=4, doctor df=4, appointment df=6,
 * book df=9, booking df=17), so even "book a doctor appointment on zocdoc"
 * scores 1.53 against MATCH_MIN_SCORE=2. The coverage FAILs below are that
 * finding, not a broken test; they encode the requirement the matcher has to
 * meet before the pipeline's other 106 HTAs ship. Numbers and the tuning
 * trap (lowering the threshold retrieves twofa for "two nights") are in the
 * research repo: notes/utility-model/SCALE-VERIFY.md.
 *
 * Run: node test/scale-fuzz-test.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import('../extension/validation/generate.js');

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

// ── the real index, from the research dataset ───────────────────────────────
// Note the trailing space in "Ideation " — it is real, not a typo.
const RESEARCH = join(homedir(), 'Stanford/Summer Project Ideation /Verification Affordances');
const GOLD = join(RESEARCH, 'taskmodel/gold-v4/domains');
const FANOUT = join(homedir(), 'Downloads/va-fanout');

/** TASK.txt body with the DRAFT header line stripped, whitespace collapsed. */
function taskFrom(raw) {
  return String(raw).split('\n')
    .filter((l) => !/^DRAFT\b/.test(l.trim()))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first paragraph of the body — the task line, without the Variants. */
function taskLineFrom(raw) {
  const body = String(raw).split('\n')
    .filter((l) => !/^DRAFT\b/.test(l.trim()))
    .join('\n').trim();
  return (body.split(/\n\s*\n/)[0] || '').replace(/\s+/g, ' ').trim();
}

/** Up to the first period that ends a sentence (a space or the end follows —
 *  so "Booking.com" does not end one). */
function firstSentence(line) {
  const m = line.match(/^[\s\S]*?\.(?=\s|$)/);
  return (m ? m[0] : line).trim();
}

function harvest(dir, index, lines) {
  if (!existsSync(dir)) return 0;
  let found = 0;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name, 'TASK.txt');
    try {
      if (!statSync(join(dir, name)).isDirectory() || !existsSync(p)) continue;
    } catch { continue; }
    if (index[name]) continue;   // gold wins; fanout only fills gaps
    const raw = readFileSync(p, 'utf8');
    const task = taskFrom(raw);
    if (!task) continue;
    index[name] = task;
    lines[name] = taskLineFrom(raw);
    found += 1;
  }
  return found;
}

const fullIndex = {};
const taskLines = {};
harvest(GOLD, fullIndex, taskLines);
harvest(FANOUT, fullIndex, taskLines);
const domains = Object.keys(fullIndex).sort();

if (domains.length < 50) {
  console.log(`SKIP scale-fuzz: found only ${domains.length} domains with a TASK.txt `
    + `(need 50+). This test depends on the research dataset at\n  ${GOLD}\n  ${FANOUT}\n`
    + 'and that dataset lives on David\'s machine, not in this repository.');
  process.exit(0);
}
console.log(`index built: ${domains.length} domains\n`);

// ── 1. SAFETY: a domain's own words retrieve it, or nothing ─────────────────
{
  const collisions = [];
  let self = 0; let none = 0;
  for (const d of domains) {
    const q = firstSentence(taskLines[d]);
    const m = G.matchDomain(q, fullIndex);
    if (m === d) self += 1;
    else if (m === null) none += 1;
    else collisions.push({ domain: d, got: m, query: q });
  }
  console.log(`safety: ${self} retrieve themselves, ${none} fall through to generation, `
    + `${collisions.length} collide`);
  for (const c of collisions) {
    console.log(`  COLLISION ${c.domain} -> ${c.got}\n    query: "${c.query.slice(0, 110)}..."`);
  }
  ok(collisions.length === 0,
    `no domain's own task line retrieves a DIFFERENT domain (${collisions.length} collisions)`);
}

// ── 2. COVERAGE: the 3 built domains still retrieve at full scale ───────────
{
  const shippedPath = join(ROOT, 'extension/validation/htas/index.json');
  const shipped = JSON.parse(readFileSync(shippedPath, 'utf8'));
  const phrasings = {
    doctor: [
      'book a doctor appointment on zocdoc for a skin check',
      'i need to book a doctor appointment online for next week',
    ],
    hotel: [
      'book a hotel room in tokyo for two nights',
      'reserve a hotel on booking.com for next weekend',
      'compare hotel rates and book a room with free cancellation',
    ],
    privacy: [
      'change my privacy settings so my activity history is off',
      'make my instagram account private',
    ],
  };
  for (const want of Object.keys(shipped)) {
    ok(!!fullIndex[want], `shipped domain "${want}" exists in the full dataset index`);
    const qs = phrasings[want] || [];
    let hits = 0;
    for (const q of qs) {
      const m = G.matchDomain(q, fullIndex);
      if (m === want) hits += 1;
      else console.log(`  MISS ${want}: "${q}" -> ${m}`);
    }
    ok(hits === qs.length,
      `${want}: ${hits}/${qs.length} natural phrasings retrieve it against all ${domains.length} domains`);
  }

  // The documented limit of lexical matching, pinned so a regression in
  // either direction is loud. "turn off ad personalization in my google
  // account settings" contains not one word that names the privacy TASK -
  // matching it needs meaning, not words, which is the LLM-judge upgrade the
  // design holds for when a real user query misses. What must hold today is
  // that it falls through to generation rather than loading a wrong model.
  const beyond = G.matchDomain(
    'turn off ad personalization in my google account settings', fullIndex);
  ok(beyond === null || beyond === 'privacy',
    `the beyond-lexical phrasing generates or retrieves privacy, never a wrong model (got ${beyond})`);
  // Same class, second case: "dermatologist" appears in no task line at all
  // and every other word is shared six ways, so words alone cannot place it.
  const beyond2 = G.matchDomain(
    'find a dermatologist who takes my insurance and book an appointment', fullIndex);
  ok(beyond2 === null || beyond2 === 'doctor',
    `the specialist phrasing generates or retrieves doctor, never a wrong model (got ${beyond2})`);
}

// ── 3. OFF-DOMAIN: forty queries outside every domain ───────────────────────
{
  const offDomain = [
    // pure knowledge questions
    'when was the eiffel tower finished',
    'what is the capital of mongolia',
    'why is the sky blue',
    'who won the world cup in 2022',
    'how do magnets work',
    'how tall is mount everest',
    'is a tomato a fruit or a vegetable',
    'history of the roman empire',
    'what does carpe diem mean',
    'why do cats purr',
    'the difference between affect and effect',
    'how far is the moon from earth',
    'what year did the berlin wall fall',
    'how many bones are in the human body',
    'the plot of hamlet in one paragraph',
    'the first ten digits of pi',
    'what rhymes with orange',
    'spell the word necessary',
    'convert 5 kilometers to miles',
    'how many cups are in a liter',
    'what time is it in london',
    // physical-world tasks no browser agent performs
    'water my plants while i am away',
    'fix a leaky kitchen faucet',
    'paint my bedroom wall blue',
    'learn to juggle three balls',
    'practice long division by hand',
    'how do i tie a bowline knot',
    'give me a workout i can do without equipment',
    'plan a surprise birthday party at home',
    'how long should i nap in the afternoon',
    // conversational asks
    'tell me a joke about penguins',
    'write a poem about autumn leaves',
    'read me a bedtime story',
    'sing happy birthday',
    'summarize this in one sentence',
    'what should i name my new puppy',
    'set an alarm for seven in the morning',
    // domain words in non-task senses
    'hotel california lyrics',
    'doctor who episode guide',
    'appointment to the supreme court',
  ];
  ok(offDomain.length === 40, `forty off-domain queries (${offDomain.length})`);
  const falseHits = [];
  for (const q of offDomain) {
    const m = G.matchDomain(q, fullIndex);
    if (m) falseHits.push(`"${q}" -> ${m}`);
  }
  for (const h of falseHits) console.log(`  FALSE HIT ${h}`);
  ok(falseHits.length === 0,
    `all 40 off-domain queries fall through to generation (${falseHits.length} false hits)`);
}

console.log(`\n${pass}/${pass + fail} - the matcher at ${domains.length}-domain scale.`);
if (fail) process.exit(1);
