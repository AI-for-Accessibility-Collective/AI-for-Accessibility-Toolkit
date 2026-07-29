// What the person said, turned into something the checks can hold the page to.
//
// Every check that compares the page against the person's intent needs that
// intent as data: a size to compare a variant against, a budget to compare a
// price against, the words that have to appear in a title. Without it those
// checks cannot fire at all — they are not lenient, they are absent. So this
// file is the difference between a layer that verifies and a layer that
// narrates.
//
// Two things it must do, and one it must not:
//
//   * read an ordinary sentence, because nobody types a form. "flat sandals for
//     my daughter, size 5, nothing over $40" is the input, not {size: "5"}.
//   * say what it could NOT determine. A missing field silently disables the
//     checks that depend on it, and silence is exactly the failure this whole
//     layer exists to prevent. `gaps()` names them so they can be asked about.
//   * never guess. An invented size is worse than an absent one: absent means
//     the size check stays quiet, invented means it confidently checks the
//     wrong thing.

/** Lead-ins people type or say before the actual request. */
const OPENERS = /^\s*(?:can you |could you |please |i(?:'m| am)? ?(?:looking for|need|want|'d like)|find(?: me)?|get(?: me)?|buy(?: me)?|order(?: me)?|search for|shop for|help me (?:find|buy|get)|look for)\b[:,]?\s*/i;

// Packaging around the thing, dropped from anywhere: "a pair of sandals" is
// sandals.
const PACKAGING = /^\s*(?:an?|the|some)?\s*(?:pair|set|couple|bunch)\s+of\s+/i;

// A bare article is dropped from the ITEM only. Requirements are read aloud,
// and "strap behind the heel" reads like a telegram where "a strap behind the
// heel" reads like a person. The article costs one word and buys the whole
// difference in how the layer sounds.
const LEAD_ARTICLE = /^\s*(?:an?|the|some)\s+/i;

/** A trailing "for my daughter" / "for work" is who or why, not what. */
const TAIL_FOR = /\s+for\s+(?:my|our|her|his|their|the|a|an)?\s*[\w' ]{1,24}$/i;

const BUDGET = [
  /\bunder\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bbelow\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bless than\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bno more than\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bnothing over\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bat most\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bmax(?:imum)?\s*(?:of\s*)?\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\bbudget(?:\s+is)?\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
  /\$\s*(\d[\d,]*(?:\.\d\d)?)\s*or less\b/i,
];

// Sizes are not always numbers — "size medium", "size 8.5", "size 5 wide".
// The trailing qualifier is kept because a size check that compares "5" to
// "5 Wide" should see both.
const SIZE = [
  /\bsize\s*:?\s*(\d+(?:\.\d+)?(?:\s?[a-z]{1,5})?)\b/i,
  /\bsize\s*:?\s*(x{0,2}(?:small|medium|large)|s|m|l|xl|xxl)\b/i,
  /\b(\d+(?:\.\d+)?)\s+in\s+(?:kids?|women'?s?|men'?s?)\b/i,
];

// When they need it by. The corpus's own example — "friday would be good" —
// is how people say this: a weekday, not a date. Without it the arrives-in-time
// check has nothing to compare the delivery date against, so it cannot fire at
// all, and a parcel arriving after the day it was needed reads as a success.
const DEADLINE = [
  /\bby\s+(today|tomorrow|tonight|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
  /\b(today|tomorrow|tonight)\b/i,
  /\bbefore\s+(mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
  /\bin\s+(\d+\s+days?)\b/i,
  /\bby\s+the\s+(\d+(?:st|nd|rd|th))\b/i,
];

const QUANTITY = [
  /\b(\d+)\s*(?:pairs?|packs?|boxes|units?|of them)\b/i,
  /\bqty\s*:?\s*(\d+)\b/i,
  /\b(two|three|four|five|six)\s+(?:pairs?|packs?|of them)\b/i,
];

const WORD_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Words that introduce a requirement rather than a new thing. */
const SPLIT_CLAUSE = /\s*(?:,|\band\b|\bwith\b|\bthat has\b|\bthat's\b|\bplus\b)\s*/i;

const first = (patterns, text) => {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { value: m[1], matched: m[0] };
  }
  return null;
};

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,;.]+|[\s,;.]+$/g, '');

/**
 * Parse an ordinary request into the contract the checks read.
 *
 * @param {string} text  what the person said or typed
 * @returns {{item: string, mustHaves: string[], size: string|null,
 *            budget: string|null, quantity: number, said: string}}
 */
export function contractFromAsk(text) {
  const said = String(text || '');
  let rest = said;

  // Pull the structured fields out, removing each as it is found so it cannot
  // also be read as a requirement. "size 5" must not become a must-have.
  const budget = first(BUDGET, rest);
  if (budget) rest = rest.replace(budget.matched, ' ');

  const size = first(SIZE, rest);
  if (size) rest = rest.replace(size.matched, ' ');

  const qty = first(QUANTITY, rest);
  if (qty) rest = rest.replace(qty.matched, ' ');

  const by = first(DEADLINE, rest);
  if (by) rest = rest.replace(by.matched, ' ');

  rest = tidy(rest.replace(OPENERS, ''));

  // The first clause names the thing; the rest constrain it.
  const clauses = rest.split(SPLIT_CLAUSE).map(tidy).filter(Boolean);
  const head = clauses.shift() || '';

  const item = tidy(head.replace(PACKAGING, '').replace(LEAD_ARTICLE, '').replace(TAIL_FOR, ''));

  // A "for my daughter" cut from the item is not a requirement either — it is
  // who it is for. Anything else in a later clause is, and it keeps its article
  // because it will be spoken.
  const mustHaves = clauses
    .map((c) => tidy(c.replace(PACKAGING, '')))
    .filter((c) => c && !/^for\b/i.test(c) && c.length > 1);

  const q = qty ? (WORD_NUM[String(qty.value).toLowerCase()] || parseInt(qty.value, 10)) : 1;

  return {
    item: item || tidy(said) || 'something',
    mustHaves,
    size: size ? tidy(size.value) : null,
    budget: budget ? `$${String(budget.value).replace(/,/g, '')}` : null,
    quantity: Number.isFinite(q) && q > 0 ? q : 1,
    deadline: by ? tidy(by.value) : null,
    said,
  };
}

// What each field switches on. Used to explain the cost of leaving one blank,
// rather than asking for it because a form has a slot.
const NEEDS = {
  size: ['the size actually selected on the page', 'a size that sold out mid-task'],
  budget: ['whether a price is inside what you said', 'shipping pushing the total over'],
  mustHaves: ['whether the item really has the features you asked for',
              'a substitution that drops one of them'],
  deadline: ['whether it arrives in time', 'a delivery date that slipped past the day'],
};

/**
 * What could not be determined, and what stays unchecked because of it.
 *
 * Phrased as something to ask, because that is what it is for: the layer can
 * only verify what it was told, so the honest move is to say which checks are
 * dark and offer to turn them on.
 *
 * @returns {Array<{field: string, ask: string, unchecked: string[]}>}
 */
export function gaps(c) {
  const out = [];
  if (!c.size) {
    out.push({ field: 'size', ask: 'What size do you need?', unchecked: NEEDS.size });
  }
  if (!c.budget) {
    out.push({ field: 'budget', ask: "What's the most you want to spend?",
               unchecked: NEEDS.budget });
  }
  if (!c.mustHaves?.length) {
    out.push({ field: 'mustHaves', ask: 'Anything it has to have?',
               unchecked: NEEDS.mustHaves });
  }
  if (!c.deadline) {
    out.push({ field: 'deadline', ask: 'When do you need it by?',
               unchecked: NEEDS.deadline });
  }
  return out;
}

/**
 * An answer to one interview question, read the way the person meant it.
 *
 * People answer a question the way they would answer a person: "forty-ish",
 * "she's a 5", "friday would be good". Storing that verbatim gives a contract
 * that says "under forty-ish", which no check can compare a price against.
 *
 * Returns the value AND how it was read, because the reading is a decision:
 * the analysis has the agent say "I'll treat $40 as the ceiling, not a
 * target", and a person who meant something else can only correct it if they
 * are told.
 *
 * @returns {{value: any, note: string|null}}
 */
export function readAnswer(field, said) {
  const t = tidy(said);
  if (!t) return { value: null, note: null };

  if (field === 'budget') {
    const m = t.match(/(\d[\d,]*(?:\.\d\d)?)/);
    if (!m) return { value: null, note: null };
    const v = `$${m[1].replace(/,/g, '')}`;
    return { value: v, note: `I’ll treat ${v} as the ceiling, not a target.` };
  }

  if (field === 'size') {
    // "she's a 5", "size 5", "a 5" — the number or word is the answer.
    const parsed = first(SIZE, /\bsize\b/i.test(t) ? t : `size ${t}`);
    const v = parsed ? tidy(parsed.value) : t;
    return { value: v, note: null };
  }

  if (field === 'deadline') {
    const parsed = first(DEADLINE, /\b(by|before|in)\b/i.test(t) ? t : `by ${t}`);
    return { value: parsed ? tidy(parsed.value) : t, note: null };
  }

  if (field === 'mustHaves') {
    const parts = t.split(/,\s*|\s+and\s+/).map(tidy).filter(Boolean);
    return { value: parts,
             note: parts.length > 1
               ? `${parts.join(' and ')}. Those are deal-breakers, then.`
               : `${parts[0]}. That’s a deal-breaker, then.` };
  }

  return { value: t, note: null };
}

/** One line for the panel and for reading back aloud. */
export function describe(c) {
  const bits = [c.item];
  if (c.mustHaves?.length) bits.push(c.mustHaves.join(' and '));
  if (c.size) bits.push(`size ${c.size}`);
  if (c.budget) bits.push(`under ${c.budget}`);
  if (c.quantity > 1) bits.push(`${c.quantity} of them`);
  return `${bits.filter(Boolean).join(', ')}.`;
}

/**
 * The task the agent runs, assembled from the fields.
 *
 * Assembled, not written: every line is a field the person answered or a rule
 * they have standing, so the agent's instructions and the checks it will be
 * held to come from the same place and cannot disagree. A prompt written by
 * hand somewhere else is a second contract that drifts from the first.
 *
 * The last two lines are not preferences. They exist because of failures in
 * the recorded runs — an agent that reported "all checks passed" instead of
 * what it saw, and a Buy Now button sitting next to Add to Cart.
 *
 * @param {object} c        the contract
 * @param {Array<{text,on}>} rules standing rules currently in force
 */
export function toPrompt(c, rules = []) {
  const lines = [`Buy: ${c.item}.`];
  if (c.mustHaves?.length) lines.push(`Must have: ${c.mustHaves.join(', ')}.`);
  if (c.size) lines.push(`Size: ${c.size}.`);
  if (c.budget) lines.push(`Budget: under ${c.budget}.`);
  lines.push(`Quantity: ${c.quantity || 1}. Do not order more.`);
  if (c.deadline) lines.push(`Needed by: ${c.deadline}.`);

  for (const r of rules) {
    if (r?.on !== false && r?.text) lines.push(`${cap(r.text)}.`);
  }

  lines.push('Never place the order yourself — bring it to me and wait.');
  lines.push('Read facts from the page in its own words. Never say a check '
           + 'passed; say what you saw.');
  return lines.join('\n');
}

const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1).replace(/\.$/, '');

/**
 * What the interview still has to ask, in the order the analysis asks it.
 *
 * Four questions, not eleven. The standing tier is not asked up front — there
 * is no delivery preference to state until checkout offers a choice — so those
 * are reached when the task reaches them and promoted at that moment.
 */
export function interview(c, unlocks = {}) {
  const ASK = {
    mustHaves: 'Anything that would make you say no to one?',
    size: 'What size?',
    budget: 'What’s your ceiling on price?',
    deadline: 'When do you need it by?',
  };
  // In the order the analysis asks them, which is not the order gaps() finds
  // them in. Must-haves first is deliberate: it is the question that makes the
  // person describe the thing rather than fill a field, and answering it often
  // supplies the others in passing.
  const ORDER = ['mustHaves', 'size', 'budget', 'deadline'];
  return gaps(c)
    .slice()
    .sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field))
    .map((g) => ({
      field: g.field,
      ask: ASK[g.field] || g.ask,
      unchecked: g.unchecked,
      unlocks: (unlocks[g.field] || []).length,
      examples: (unlocks[g.field] || []).slice(0, 3),
    }));
}

/** A search query, for when the agent needs one and was given a sentence. */
export function toQuery(c) {
  return [c.item, ...(c.mustHaves || [])].join(' ').replace(/\s+/g, ' ').trim();
}
