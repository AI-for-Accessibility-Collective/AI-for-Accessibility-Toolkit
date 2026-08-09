/**
 * Measuring a narrower search on whatever site the task is on.
 *
 * `probeNarrower()` exists because the model, asked how many results a narrower
 * search would return, answered "Estimated results: ~2,000". A count the page
 * never said is exactly the claim this layer exists to replace, so the probe
 * opens each candidate in a background tab and reads the real number. That rule
 * is right anywhere.
 *
 * Its implementation was not. It built `${origin}/s?k=${query}` and read the
 * count with `/([\d,]+)\s+results/i` — Amazon's search grammar and Amazon's
 * wording. Off Amazon it opened a URL the site does not have and missed the
 * regex, so it failed honestly and measured nothing, on `refine`, which is 21
 * of the 242 gold questions.
 *
 * Both hardcoded halves are now read rather than assumed, and neither reading
 * guesses:
 *
 *   - how a search is written here comes from the URL the agent is already on.
 *     A results page reached by searching carries the words that were searched
 *     for in one of its own parameters; that is what makes it a results page.
 *     A site whose search is a POST, or an app that keeps it out of the URL,
 *     produces no parameter and is reported as such.
 *   - how many results comes from the pattern first, because it is free and
 *     exact where it fits, and then from one reasoner call scoped to the count,
 *     which carries a verbatim quote and answers null when the page states no
 *     total.
 *
 * Run: node test/probe-test.mjs
 */
let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const P = await import('../extension/validation/probe.js');

// ── how a search is written on this site, read rather than assumed ──────────
{
  const amazon = 'https://www.amazon.com/s?k=girls+flat+sandals&ref=nb_sb_noss';
  const p = P.searchParamOf(amazon, 'girls flat sandals size 5');
  ok(p?.key === 'k', 'on Amazon the search parameter is found, not assumed to be k');
  ok(P.narrowerUrl(amazon, 'k', 'girls flat sandals size 5')
     === 'https://www.amazon.com/s?k=girls+flat+sandals+size+5',
    'and the narrower URL is the same search on the same path the hand-written '
    + 'version built, down to a space being written + instead of %20');

  const other = 'https://example.gov/search?category=forms&query=passport+renewal&page=2';
  const q = P.searchParamOf(other, 'passport renewal for a minor');
  ok(q?.key === 'query', 'on a site that names it something else, that name is found');
  ok(P.narrowerUrl(other, 'query', 'passport renewal minor')
     === 'https://example.gov/search?query=passport+renewal+minor',
    'and pagination and sort state are dropped, because they measure a different question');

  ok(P.searchParamOf('https://www.google.com/travel/flights', 'a flight to LAX') === null,
    'an app that keeps the search out of the URL produces no parameter');
  ok(P.searchParamOf('https://example.gov/search?page=2', 'passport renewal') === null,
    'and neither does a URL whose parameters carry none of what was asked for');
  ok(P.searchParamOf('not a url at all', 'passport') === null,
    'nor does a string that is not a URL');
  ok(P.searchParamOf(amazon, '') === null,
    'and with nothing asked for there is nothing to match on');

  ok(P.NO_SEARCH_GRAMMAR.length > 0 && !/error/i.test(P.NO_SEARCH_GRAMMAR),
    'what happens instead is a sentence the person can act on, not an error');
}

// ── the candidates themselves are unchanged ────────────────────────────────
{
  const qs = P.narrowerQueries('girls flat sandals',
    { mustHaves: ['waterproof'], size: '5' });
  ok(qs.length === 2 && qs[0] === 'girls flat sandals waterproof'
     && qs[1] === 'girls flat sandals size 5',
    'narrower still means a term of the ask the query does not carry yet');
  ok(P.narrowerQueries('girls flat sandals waterproof size 5',
    { mustHaves: ['waterproof'], size: '5' }).length === 0,
    'and an ask already fully in the query leaves nothing to narrow with');
}

// ── how many, read rather than matched ─────────────────────────────────────
{
  ok(P.countIn('- text: 1-16 of over 3,000 results for "sandals"') === '3,000',
    'Amazon\'s own wording still reads exactly as it did');
  ok(P.countIn('Showing 1-20 of 340 items') === '340',
    'and so does a site that words it differently');
  ok(P.countIn('- heading "Passport forms"') === null,
    'a page with no total stated matches nothing');

  let asked = 0;
  const askPage = async (q, text) => {
    asked += 1;
    return /340 matching/.test(text)
      ? { ok: true, answer: '340', quote: '340 matching records' }
      : { ok: true, answer: null, quote: null };
  };

  const free = await P.countOn('1-16 of over 3,000 results', askPage);
  ok(free.count === '3,000' && asked === 0,
    'the free pattern is tried first, so the common case costs no model call');

  const read = await P.countOn('Your query returned 340 matching records', askPage);
  ok(read.count === '340' && read.quote === '340 matching records',
    'a wording the pattern misses is read off the page, with the page\'s own words');
  ok(read.from === 'read off the page',
    'and where the number came from travels with it');

  const none = await P.countOn('- heading "Passport forms"', askPage);
  ok(none.count === null && /does not state a total/.test(none.from),
    'a page that states no total is reported as stating none, never as zero');

  const noModel = await P.countOn('- heading "Passport forms"', null);
  ok(noModel.count === null && !/error/i.test(noModel.from),
    'and with nothing wired up to read it, the patterns are the whole measurement');

  const broken = await P.countOn('anything', async () => { throw new Error('no key'); });
  ok(broken.count === null && /could not read/.test(broken.from),
    'a reader that throws is a page not read, never a count of nothing');
}

console.log(`\n${pass}/${pass + fail} - a narrower search is measured on whatever site it is, or honestly not measured at all.`);
if (fail) process.exit(1);
