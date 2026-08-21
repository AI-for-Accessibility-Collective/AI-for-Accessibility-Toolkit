/**
 * The retrieval tier: a built HTA answers a matching query in milliseconds.
 *
 * The match must be conservative - a wrong tier-1 match checks one task's
 * pages against another task's questions, which is the exact failure the
 * generated path was built to end. So what is tested is as much what does
 * NOT match as what does:
 *
 *   - a clearly-on-domain query retrieves the built model
 *   - an off-domain query retrieves nothing and falls through to generation
 *   - a query two domains tie on retrieves nothing
 *   - the shipped index and models agree and flatten cleanly
 *
 * Run: node test/retrieve-test.mjs
 */
import fs from 'node:fs';

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const G = await import('../extension/validation/generate.js');
const R = await import('../extension/validation/reasoner.js');

// ── the match rule, on a pool built for the edges ───────────────────────────

const INDEX = {
  doctor: 'book a doctor appointment online through a patient portal',
  hotel: 'book a hotel room online with dates and a budget',
  privacy: 'change privacy or account settings and verify they took effect',
};

ok(G.matchDomain('book a hotel room in tokyo', INDEX) === 'hotel',
  'an on-domain query matches its built domain');
ok(G.matchDomain('schedule a doctor appointment for tuesday', INDEX) === 'doctor',
  'and so does an appointment query');
ok(G.matchDomain('order a pepperoni pizza', INDEX) === null,
  'an off-domain query matches nothing');
ok(G.matchDomain('buy sandals size 5 under $40', INDEX) === null,
  'a shopping query does not get shoehorned into a booking domain');
// One hit each on two domains: "book" alone must not pick either.
ok(G.matchDomain('book something', INDEX) === null,
  'a query two domains tie on matches nothing');
ok(G.matchDomain('', INDEX) === null, 'an empty query matches nothing');

// ── retrieveModel, with a fake fetcher ──────────────────────────────────────

{
  const files = {
    'validation/htas/index.json': INDEX,
    'validation/htas/hotel.json': { task: INDEX.hotel,
      tree: { id: '0', label: 'root', children: [
        { id: '1', label: 'Search hotels', questions: [{ question: 'Right dates?', moment: 'Now' }] }] } },
  };
  const fetcher = async (p) => {
    if (!(p in files)) throw new Error(`no ${p}`);
    return files[p];
  };
  const hit = await G.retrieveModel('book a hotel room in tokyo', fetcher);
  ok(hit?.domain === 'hotel', 'a matching query retrieves the built model');
  ok(hit?.source === 'validation/htas/hotel.json',
    'with the extension path a worker restart can refetch');
  ok((await G.retrieveModel('order a pizza', fetcher)) === null,
    'no match retrieves nothing');
  ok((await G.retrieveModel('book a doctor appointment', fetcher)) === null,
    'a match whose model file is missing retrieves nothing rather than throwing');
}

// ── the shipped files ───────────────────────────────────────────────────────

{
  const idx = JSON.parse(fs.readFileSync('extension/validation/htas/index.json', 'utf8'));
  ok(Object.keys(idx).length >= 3, 'the shipped index has at least the three built domains');
  for (const [domain, task] of Object.entries(idx)) {
    const m = JSON.parse(fs.readFileSync(`extension/validation/htas/${domain}.json`, 'utf8'));
    ok(m.task === task, `the shipped ${domain} model and the index tell the same task`);
    const flat = R.flattenModel(m);
    ok(flat.questions.length >= 100,
      `the shipped ${domain} model flattens with its full question bank (${flat.questions.length})`);
    ok(flat.questions.some((q) => q.moment === 'Now'),
      `and its questions carry moments the router can read`);
  }
  ok(G.matchDomain('book a hotel room for two nights', idx) === 'hotel',
    'against the shipped index a hotel query retrieves hotel');
}

console.log(`\n${pass}/${pass + fail} - a built task loads instantly and an unbuilt one `
  + 'is never mistaken for it.');
if (fail) process.exit(1);
