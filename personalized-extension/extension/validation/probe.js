// Measuring a narrower search instead of asking the model to guess one.
//
// `probeNarrower()` in background.js exists because the model, asked how many
// results a narrower search would return, answered "Estimated results: ~2,000".
// A count the page never said is exactly the claim this layer exists to
// replace, so the probe opens each candidate in a background tab and reads the
// real number off the page.
//
// The rule generalises. The implementation did not: it built
// `${origin}/s?k=${query}` and read the count with `/([\d,]+)\s+results/i`,
// which is Amazon's search grammar and Amazon's wording. Off Amazon it opened a
// URL the site does not have, missed the regex, and returned a null count — it
// failed honestly and measured nothing, on `refine`, which is 21 of the 242
// gold questions.
//
// Two things here replace the two hardcoded halves, and neither one guesses.
//
// ── how a search is written on this site ────────────────────────────────────
//
// Read it off the URL the agent is already on rather than assume it. A results
// page reached by searching carries the words that were searched for in one of
// its own parameters — that is what makes it a results page. So look for the
// parameter whose value shares words with what the person asked for, and rewrite
// THAT one.
//
// This is evidence, not a convention: `k` is never assumed, and a site whose
// search is a POST, or an app that keeps the query in a URL fragment or in no
// URL at all, produces no match. Then the probe says it cannot tell how a
// search is written here and measures nothing, which is the same honest failure
// as before but with a reason attached instead of a broken tab.
//
// ── how many results the page says ──────────────────────────────────────────
//
// The regex first, because it is free and exact where it fits. The reasoner
// second, when the regex misses: one `askPage` call scoped to the count, which
// carries a verbatim quote like every other answer in this layer and returns
// null when the page does not state a count at all. So a site that words it
// "Showing 1-20 of 340 items" is measured, and a site that states no count is
// reported as stating no count rather than as zero.

/** Words short enough to be noise are not evidence of anything. */
const WORDS = /[\p{L}\p{N}]{3,}/gu;

const wordsOf = (s) => String(s || '').toLowerCase().match(WORDS) || [];

/**
 * Which URL parameter carries the search on this site.
 *
 * @param {string} url      the page the agent is on
 * @param {string} askText  what the person asked for, in their own words
 * @returns {{key: string, value: string, hits: number}|null}
 */
export function searchParamOf(url, askText) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const want = new Set(wordsOf(askText));
  if (!want.size) return null;

  let best = null;
  for (const [key, value] of u.searchParams) {
    const val = String(value || '');
    // A parameter long enough to be a payload is not a search box.
    if (!val || val.length > 200) continue;
    const hits = wordsOf(val).filter((w) => want.has(w)).length;
    if (!hits) continue;
    if (!best || hits > best.hits
        || (hits === best.hits && val.length > best.value.length)) {
      best = { key, value: val, hits };
    }
  }
  return best;
}

/**
 * The same search, narrower.
 *
 * Origin and path from the page we are on, the identified parameter rewritten,
 * everything else dropped. Dropping the rest is deliberate: the leftovers of a
 * results URL are pagination, session crumbs and sort state, and carrying them
 * onto a different query measures something other than the query. On Amazon
 * this produces exactly the URL the old code built by hand.
 */
export function narrowerUrl(url, key, query) {
  try {
    const u = new URL(String(url));
    // http and https only. A file: or chrome: URL has an opaque origin, so
    // `u.origin` is the STRING "null" and `new URL('null/Users/...')` threw a
    // TypeError from outside the old try — it escaped probeNarrower and left
    // the panel on "Trying narrower searches" forever. There is also nothing
    // to measure on those schemes.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const out = new URL(u.origin + u.pathname);
    out.searchParams.set(key, query);
    return out.toString();
  } catch { return null; }
}

/**
 * Candidate narrower searches: terms of the ask that the current query does not
 * carry yet. Unchanged in substance from the original — only the base query now
 * comes from the identified parameter rather than from `k`.
 *
 * @param {string} base       the query as the URL currently carries it
 * @param {{mustHaves?: string[], size?: string}} contract
 */
export function narrowerQueries(base, contract = {}, limit = 3) {
  const have = new Set(String(base || '').toLowerCase().split(/\s+/));
  const terms = [
    ...(Array.isArray(contract.mustHaves) ? contract.mustHaves : []),
    contract.size ? `size ${contract.size}` : null,
  ].filter(Boolean)
   .filter((t) => !String(t).toLowerCase().split(/\s+/).every((w) => have.has(w)));
  return terms.slice(0, limit).map((t) => `${base} ${t}`);
}

// ── the count ───────────────────────────────────────────────────────────────

/** Free and exact where it fits. Tried before anything costs a model call. */
const COUNT_PATTERNS = [
  /of\s+(?:over\s+|about\s+|more than\s+)?([\d,]+)\s+(?:results|items|matches)/i,
  /([\d,]+)\s+(?:results|items|matches)\b/i,
];

// Phrases that carry a number and a countable noun and are NOT a result total.
// A cart badge, a review count and a basket line all match "N items", and the
// second pattern above takes the first one on the page — so on any site that
// does not word its total as "of N results", a header like "4 items in your
// cart" was reported as the size of the search, with `from: 'the page states
// it'` and no quote. That is the free path, so it was the common case, and it
// is exactly the off-Amazon situation this module was rewritten for.
const NOT_A_TOTAL = /\b(cart|basket|bag|order|wish\s*list|saved|recently viewed|review|rating|comment)\b/i;

export function countIn(text) {
  const s = String(text || '');
  for (const re of COUNT_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    // The words either side of the match decide whether this is a total.
    const around = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    if (NOT_A_TOTAL.test(around)) continue;
    return m[1];
  }
  return null;
}

/** What the reasoner is asked when the patterns miss. One question, one page. */
export const COUNT_QUESTION =
  'How many results, items or matches does this page say it found? Answer with '
  + 'just the number, written the way the page writes it. If the page does not '
  + 'state a total, the answer is null.';

/**
 * What one probed page measured.
 *
 * `from` says where the number came from, because "the page said 340" and "I
 * could not find a total" have to look different to whoever reads this.
 *
 * @param {string} pageText
 * @param {(q: string, text: string) => Promise<Object>} [askPage] the reasoner,
 *   when one is wired up. Absent, the patterns are the whole measurement.
 */
export async function countOn(pageText, askPage) {
  const direct = countIn(pageText);
  if (direct) return { count: direct, from: 'the page states it', quote: null };
  if (typeof askPage !== 'function') {
    return { count: null, from: 'no total in the page text', quote: null };
  }
  try {
    const r = await askPage(COUNT_QUESTION, pageText);
    if (r && r.ok && r.answer) {
      // The quote is checked for containment; the ANSWER is not. Without this,
      // a model could answer "about 2,000" against a quote reading
      // `Results for "girls flat sandals"` and the layer would speak it as the
      // count — which is the invented number this module was written to
      // replace, arriving back through the path built to prevent it.
      const answer = String(r.answer).trim();
      const digits = answer.replace(/[^\d]/g, '');
      const inQuote = digits
        && String(r.quote || '').replace(/[^\d]/g, '').includes(digits);
      if (inQuote) {
        return { count: answer, from: 'read off the page', quote: r.quote };
      }
      return { count: null, quote: r.quote,
               from: 'the page does not state a total I could point at' };
    }
    return { count: null, from: 'the page does not state a total', quote: null };
  } catch {
    return { count: null, from: 'I could not read the page', quote: null };
  }
}

/** Why nothing was measured, in words a person can act on. */
export const NO_SEARCH_GRAMMAR =
  'I could not tell how a search is written on this site — the page address does '
  + 'not carry what was searched for — so I did not measure anything rather than '
  + 'guess at numbers.';
