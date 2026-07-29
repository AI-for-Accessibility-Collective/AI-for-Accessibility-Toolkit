// Count-first opener.
//
// When an agent runs a search, it tends to report what it picked, not what it
// searched through. The result count is the first evidence the query actually
// worked and the first hint of whether it was a good query — and it is exactly
// the kind of number that never survives into a summary.
//
// Who this is for. A sighted person reads the count off the top of the page
// without trying. A screen-reader user hears it as the page heading. A
// screen-reader user working through an agent gets neither: the agent's log
// does not contain it, and there is no page to fall back on.
//
// Why speak it rather than let them ask: an unusually large count is the signal
// that a query is too loose, and you cannot ask about a number you were never
// told. Speaking it costs about a second, against the minutes a full readback
// of a results page would take.

const LOOSE = 1000;   // above this, a specific request is probably too broad

export const CountFirst = {
  id: 'count-first',
  name: 'Count-first opener',
  signal: 'Search|How many results?',
  breakdown: 'the agent never says the result count',
  infoType: 'magnitude',
  // A sighted person already has this for free.
  personas: ['B', 'SA', 'BA'],

  triggers: (f) => f.signal === 'Search|How many results?' && f.observed != null,

  say: (f) => {
    const n = f.observed.count;
    const ads = f.observed.sponsoredInFirstTen;
    const adPart = ads ? ` ${ads} of the first 10 are ads.` : '';
    if (n > LOOSE) {
      return `Over ${LOOSE.toLocaleString()} results — that's broad enough that ` +
             `most of them won't match what you asked for.${adPart}`;
    }
    return `${n.toLocaleString()} results.${adPart}`;
  },

  choices: (f) => {
    const base = [
      { label: 'sounds right, keep going', tell: 'continue with this search' },
      { label: 'read me the query exactly as typed',
        tell: 'read the search box back word for word' },
    ];
    if (f.observed.count > LOOSE) {
      base.unshift({
        label: 'narrow it first',
        tell: 'stop and help me tighten the search before picking anything',
        rule: true,
      });
    }
    return base;
  },
};
