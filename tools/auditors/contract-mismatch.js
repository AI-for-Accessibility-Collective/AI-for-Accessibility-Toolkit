// Contract mismatch — finds where the page stopped matching what the person
// asked for.
//
// An auditor, and deliberately a different KIND of auditor from the others
// here. `missing-alt` and `poor-contrast` ask "is this page accessible?", a
// question with one right answer for everybody. This one asks "is this page
// still the thing YOU asked for?", which has no answer at all until somebody
// says what they wanted. That is why it takes a contract: size 5, under $40, a
// strap behind the heel.
//
// It exists because delegating changes what goes wrong. A person doing their
// own shopping sees the size reset to 5 Big Kid when they click. A person who
// delegated it sees a summary saying the sandals were added to the cart, and
// both statements are true. Nothing in a WCAG audit catches that, because
// nothing is broken — the page is fine, it is just no longer yours.
//
// Pairs with the `agent-watch` adapter, which renders these findings on the
// page and hands back the control needed to act on each one.
//
// Each one is small and specific, because the failures they exist for are
// specific. This is not a generic comparison engine — a rule that fires on
// "anything that differs" would speak constantly and mean nothing.
//
// Every check declares two things the policy needs and cannot infer:
//
//   contradicts  does this conflict with something the person explicitly
//                stated? Those stop even when reversible, because a wrong
//                variant is technically returnable and still the most
//                expensive thing to let through.
//   answerable   can they act on it here? A stop with nothing to decide is a
//                dead end, so those are demoted rather than blocking.
//
// A check may also confirm. A run of nothing but problems reads as an
// interrogation, and — more to the point — it leaves no way to tell "checked
// and fine" from "never checked", which is the failure the whole layer exists
// to prevent.

const money = (n) => `$${Number(n).toFixed(2)}`;
const listOf = (a) => (a.length <= 1 ? a[0] || ''
  : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const cap = (c) => {
  const n = Number(String(c.budget ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Product titles run 60+ words of search-keyword stuffing. Spoken, the brand
 *  is what identifies an item. */
const shortName = (t) => {
  const words = String(t).replace(/[,:].*$/, '').split(/\s+/);
  const stop = words.findIndex((w, i) => i > 0 &&
    /^(baby|girls?'?|boys?'?|toddler|kids?|womens?|mens?|open|slide|sport|water|buckle|everyday|unisex)$/i.test(w));
  return words.slice(0, stop > 0 ? stop : Math.min(words.length, 3)).join(' ')
    .replace(/['’]s?$/, '');
};

// ── Search ───────────────────────────────────────────────────────────────────
// Everything here is a relationship between products. A person choosing needs
// the shape of the set, which is what a sighted person gets free from the
// page's layout and a screen-reader user gets not at all.
// Where a result count sits on the scale a person judges it by. Supplied by
// the host with the analysis; without it the gauge does not draw, because a
// needle on an invented scale is a confident claim about nothing.
let COUNT_ZONES = null;

/** @param {Array<{to:number,label:string}>} zones from the analysis */
export function setCountZones(zones) {
  COUNT_ZONES = Array.isArray(zones) && zones.length ? zones : null;
}

// ── many products at once ───────────────────────────────────────────────────
//
// Everything else here assumes one product. The real reason to delegate is
// breadth — open eight, read the specs and the reviews for each, decide from
// all of it — and that changes the kind of loss entirely.
//
// With one product the failure is OMISSION: nobody opened the photos. With
// eight it is COMPRESSION: the agent looked at three hundred things and said
// one sentence, and the discarding is invisible. Breadth makes the reporting
// problem worse in exact proportion to how much it helps the decision.
//
// Four losses that only exist once there is more than one candidate, and none
// of which any single-product check can see:
//
//   the discard pile   candidates that vanished without trace
//   uneven depth       40 reviews read for one, none for four — the comparison
//                      LOOKS symmetric, and that symmetry is itself a claim
//   the missing cell   on screen a blank is visible; by ear, silence is
//                      indistinguishable from "not reached yet"
//   staleness spread   a set gathered over minutes, presented as a snapshot
const manyProducts = (F, c) => {
  const S = F.resultSet?.value;
  if (!S || !(S.count > 1)) return [];
  const lim = cap(c);
  const out = [];

  // The discard pile. A sighted person sees the grid and knows roughly what was
  // skipped; delegated, the skipped leave no trace at all.
  if (lim && S.priceHigh != null && S.priceHigh > lim) {
    const over = (S.prices || []).filter((p) => p > lim).length;
    if (over) {
      out.push({
        widget: 'Discard pile',
        say: `${over} of the ${S.count} are over your ${money(lim)}. `
           + `They are not in what I'd suggest.`,
        from: `${S.count} product prices`, answerable: false,
        paradigmHint: 4,
      });
    }
  }

  // Uneven depth. Reporting a comparison across candidates read to different
  // depths presents an asymmetry as a symmetry.
  if (S.noPhoto != null && S.noPhoto > 0 && S.noPhoto < S.count) {
    out.push({
      widget: 'Uneven depth',
      say: `I could see photos for ${S.count - S.noPhoto} of the ${S.count}. `
         + `The rest I have only read about.`,
      from: `${S.noPhoto} tiles with no reachable image`, answerable: false,
    });
  }

  // Where the variance actually is. An attribute every candidate shares costs
  // N cells to say and settles nothing; only the spread can change a decision.
  // Where the variance is — measured against the other dimensions, not against
  // a number chosen here.
  //
  // This used to fire when prices spanned 2x or more, and 2x was invented: it
  // decided that a $10-to-$20 spread "is the thing most likely to decide this"
  // and a $10-to-$19 spread is not. The claim the analysis actually makes is
  // comparative — report the dimension with the most decisive spread — which
  // needs no threshold at all, only something to compare against.
  const spreads = [];
  if (S.priceLow > 0 && S.priceHigh != null) {
    spreads.push({ what: 'price', span: S.priceHigh / S.priceLow,
                   says: `${money(S.priceLow)} to ${money(S.priceHigh)}` });
  }
  const rs = (S.ratings || []).filter((r) => r > 0);
  if (rs.length > 1) {
    spreads.push({ what: 'rating', span: Math.max(...rs) / Math.min(...rs),
                   says: `${Math.min(...rs)} to ${Math.max(...rs)} stars` });
  }
  if (spreads.length > 1) {
    spreads.sort((a, b) => b.span - a.span);
    const [top, next] = spreads;
    // Only worth saying when one dimension actually separates them more than
    // the others do. Equal spreads decide nothing, and saying so would be the
    // same arbitrary call in a different costume.
    if (top.span > next.span) {
      out.push({
        widget: 'Widest gap',
        say: `They differ most on ${top.what}: ${top.says}. `
           + `On ${next.what} they are closer together.`,
        from: `${S.count} products compared`, answerable: true,
      });
    }
  }
  return out;
};

const search = (F, c) => {
  const S = F.resultSet?.value;
  if (!S) return [];
  const out = [];

  out.push({
    widget: 'Count-first opener',
    // The tutor's rule, from the video corpus: a few hundred means the query
    // landed; four figures means it matched half the shop. The count is only
    // A proportion when there are ads to count — how many of the first ten
    // are paid placement is a ratio, and a ratio needs no threshold to mean
    // something. Otherwise the count against the one reference the analysis
    // supplies, drawn as a reference and attributed, never as a verdict.
    shape: S.sponsoredInFirstTen
      ? { part: S.sponsoredInFirstTen, whole: Math.min(10, S.count),
          partLabel: `${S.sponsoredInFirstTen} of the first ${Math.min(10, S.count)} are ads`,
          action: 'skip-ads', actionLabel: 'Skip past the ads' }
      : (COUNT_ZONES?.[1]
          ? { value: S.count, display: String(S.count),
              mark: COUNT_ZONES[1].to, markLabel: `${COUNT_ZONES[1].to}`,
              source: 'a screen-reader tutor’s rule: past here, a query is matching too much' }
          : null),
    say: `${S.count} products on this page` +
         (S.sponsoredInFirstTen ? `, and ${S.sponsoredInFirstTen} of the first ten are ads.` : '.'),
    from: F.resultSet.from, answerable: false,
  });

  const lim = cap(c);
  if (S.priceLow != null && S.priceHigh != null) {
    const inside = lim && S.priceHigh <= lim;
    out.push({
      widget: 'Price sweep on demand',
      shape: lim ? { rows: [{ asked: `under ${money(lim)}`,
                              found: `${money(S.priceLow)} – ${money(S.priceHigh)}`,
                              match: inside }] } : null,
      say: `They run ${money(S.priceLow)} to ${money(S.priceHigh)}.` +
           (inside ? ` All inside your ${money(lim)}.` : ''),
      from: `${S.count} product prices`, answerable: false, confirming: !!inside,
    });
  }

  // The badge is the shop's own label, and it is not the best-rated product.
  const badged = (S.withBadge || [])[0];
  if (badged && S.bestRated && badged.title !== S.bestRated.title) {
    out.push({
      widget: 'Badge decoder',
      // Two voices on one question, and they disagree: the shop's label and
      shape: {
        claim: `${badged.badge} — the best one here`,
        sources: [
          { who: 'the shop', said: `${badged.badge} label`, agrees: true },
          { who: 'buyers', said: `${S.bestRated.rating}★ from ` +
              `${S.bestRated.ratingCount.toLocaleString()} goes to a different one`,
            agrees: false },
        ],
      },
      say: `The one carrying the shop's ${badged.badge} label isn't the best rated. ` +
           `The best rated has ${S.bestRated.rating} stars from ` +
           `${S.bestRated.ratingCount.toLocaleString()} ratings.`,
      from: `${badged.badge} vs best-rated`, answerable: true,
    });
  }

  // The highest rated and the most rated, when they are not the same product.
  //
  // No verdict on which is better — that used to be decided here by a hidden
  // 50-rating floor, so a 4.8 from 40 quietly stopped counting as "the best
  // rated" and nobody was told the rule existed. Both numbers, side by side,
  // is the whole finding: a score means something different from three
  // ratings than from three thousand, and which matters is not ours to settle.
  const best = S.bestRated, most = S.mostRated;
  if (best && most && best.title !== most.title) {
    out.push({
      widget: 'Stars never alone',
      say: `Highest rated: ${best.rating} stars from `
         + `${(best.ratingCount || 0).toLocaleString()}. `
         + `Most reviewed: ${most.rating} stars from `
         + `${(most.ratingCount || 0).toLocaleString()}.`,
      from: 'two different products on this page', answerable: true,
      paradigmHint: 12,
    });
  }

  if (S.count && S.noPhoto === S.count) {
    out.push({
      widget: 'Unseen-photo stand-in',
      shape: { parts: [{ what: 'photos', checked: 0, of: S.count }] },
      say: `None of the ${S.count} has a photo your screen reader can reach. ` +
           `The pictures are there; they just aren't announced.`,
      from: 'no image entries in any tile', answerable: false,
    });
  }

  // A "typical" price is worth questioning when it is above every price this
  // page is actually charging — that is a fact about the page, not a ratio
  // chosen here. The old test fired at 1.4x, which decided that a 40% claimed
  // saving is suspicious and a 39% one is fine.
  const now = F.priceNow?.value, typ = F.priceTypical?.value;
  if (now && typ && S && typ > (S.priceHigh ?? now)) {
    out.push({
      widget: 'Typical-price truth check',
      shape: { points: [{ value: money(typ), when: 'claimed usual' },
                        { value: money(now), when: 'now' }] },
      say: `The first one shows ${money(now)} against a claimed usual of ${money(typ)}. ` +
           `That's the shop's own reference, not a price I've seen.`,
      from: F.priceTypical.from, answerable: false,
    });
  }
  return out;
};

// ── Check item ───────────────────────────────────────────────────────────────
const checkItem = (F, c) => {
  const out = [];

  const title = F.title?.value;
  if (title && c.mustHaves?.length) {
    const low = title.toLowerCase();
    const missing = c.mustHaves.filter((m) => !String(m).toLowerCase()
      .replace(/^(a|an|the) /, '').split(/\s+/).every((w) => low.includes(w)));
    if (missing.length) {
      out.push({
        widget: 'Word match',
        say: `The title doesn't say ${listOf(missing)}. That came from somewhere ` +
             `else on the page, or nowhere yet.`,
        from: title.slice(0, 60), contradicts: false, answerable: true,
      });
    }
  }

  const price = F.buyBoxPrice?.value, lim = cap(c);
  if (price && lim) {
    if (price <= lim) {
      out.push({ widget: 'Budget line', say: `${money(price)}, inside your ${money(lim)}.`,
                 from: F.buyBoxPrice.from, confirming: true, answerable: false });
    } else {
      out.push({ widget: 'Budget line',
                 say: `${money(price)}. That's over the ${money(lim)} you set.`,
                 from: F.buyBoxPrice.from, contradicts: true, answerable: true });
    }
  }

  if (F.returnsBadge?.value) {
    out.push({ widget: 'The returns rules', say: 'Free returns on this one.',
               from: F.returnsBadge.from, confirming: true, answerable: false });
  }

  const size = F.selectedSize?.value;
  if (size && c.size && String(size).trim().toLowerCase() !== String(c.size).trim().toLowerCase()) {
    out.push({
      widget: 'No Exact Match',
      say: `The size selected here is "${size}". You said ${c.size}.`,
      from: F.selectedSize.from,
      // Explicitly stated, so this stops even though nothing is committed yet.
      contradicts: true, answerable: true,
      // Declared here, not left to the signal map. This check's signal is a
      // readback with no control of its own, but the remedy is obvious and it
      // is the one the person is being held for — a gate that can only offer
      // "go on or stop" is asking them to accept or abandon, when what they
      // actually want is the third option.
      control: { label: 'Change the size', action: 'pick-size' },
    });
  }
  // The page contradicting itself is a finding in its own right.
  if (F.selectedSize?.labelDisagrees) {
    out.push({
      widget: 'Two answers about size 5',
      say: `The page says "${F.selectedSize.labelDisagrees}" above the sizes but has ` +
           `"${size}" selected. Those are different, and the one selected is what ships.`,
      from: F.selectedSize.from, answerable: true,
    });
  }

  const stock = F.stockLine?.value;
  if (stock && /only \d+ left/i.test(stock)) {
    out.push({ widget: 'The stock line, spoken', say: `The buy box says: ${stock}.`,
               from: F.stockLine.from, answerable: false });
  }
  return out;
};

// ── Add to cart ──────────────────────────────────────────────────────────────
const addToCart = (F, c) => {
  const out = [];
  const size = String(F.cartLineSize?.value || '').trim();

  // The highest-value catch in the corpus: the product page says what is
  // selected, only the cart says what was actually bought.
  if (size && c.size) {
    const same = String(size).trim().toLowerCase() === String(c.size).trim().toLowerCase();
    out.push(same
      ? { widget: 'Size First', say: `Size ${size} went in, which is what you asked for.`,
          from: F.cartLineSize.from, confirming: true, answerable: false }
      : { widget: 'Size First',
          say: `That went in as "${size}". You asked for size ${c.size}.`,
          from: F.cartLineSize.from, contradicts: true, answerable: true });
  }

  if (F.addConfirmation?.value === null || F.addConfirmation?.absent) {
    out.push({ widget: 'Did It Land',
               say: `The add didn't confirm. Nothing on the page says it landed.`,
               from: 'no add confirmation in the tree', contradicts: true, answerable: true });
  }

  const n = F.cartCount?.value;
  if (n != null) {
    out.push({ widget: 'The Count, Out Loud', say: `Cart count: ${n}.`,
               from: F.cartCount.from, confirming: true, answerable: false });
  }
  return out;
};

// ── Review order ─────────────────────────────────────────────────────────────
const reviewOrder = (F, c) => {
  const out = [];
  const n = F.itemCount?.value, want = c.quantity;

  if (n && want != null && n > want) {
    const lines = F.orderLines?.value || [];
    const extras = lines.length > 1 ? lines.slice(1).map(shortName) : [];
    out.push({
      widget: 'Extra items list',
      say: `Order says ${n} items. You asked for ${want}.` +
           (extras.length ? ` The other ${extras.length === 1 ? 'one is' : `${extras.length} are`} ` +
                            `${listOf(extras)} — not from today.` : ''),
      from: F.itemCount.from, contradicts: true, answerable: true,
    });
  }

  const total = F.orderTotal?.value, lim = cap(c);
  if (total && lim && total > lim) {
    out.push({ widget: 'The spending cap',
               say: `${money(total)} order. Over the ${money(lim)} you set.`,
               from: F.orderTotal.from, contradicts: true, answerable: true });
  }

  if (F.cardLabel?.value && !F.cardLastFour?.value) {
    out.push({ widget: 'Last-four out loud',
               say: `The page names a card but not its digits, so I can't tell you which one.`,
               from: F.cardLabel.from, answerable: false });
  }
  if (F.arrivalDate?.value) {
    out.push({ widget: 'Arrives-in-time check', say: `Arriving ${F.arrivalDate.value}.`,
               from: F.arrivalDate.from, confirming: true, answerable: false });
  }
  return out;
};

// ── Confirm ──────────────────────────────────────────────────────────────────
const confirm = (F) => {
  const out = [];
  const h = F.outcomeHeading;
  if (h?.value) {
    out.push({ widget: 'Success message first',
               say: `"${h.value}" — the page's own words.` +
                    (h.level >= 4 ? ` It's filed as a minor heading, so I've moved it up.` : ''),
               from: h.from, confirming: true, answerable: false });
  }
  if (F.orderNumber && F.orderNumber.absent) {
    out.push({ widget: '"No number here" honesty line',
               say: `No order number on this page. That's normal here — it lives in ` +
                    `Your Orders and in the email.`,
               from: F.orderNumber.from, answerable: false });
  }
  if (F.cancelControl && F.cancelControl.absent) {
    out.push({ widget: 'The human cancel path',
               say: `I can't find a cancel control on this page.`,
               from: F.cancelControl.from, answerable: true });
  }
  return out;
};

export const CHECKS = {
  Search: (F, c) => search(F, c).concat(manyProducts(F, c)), 'Check item': checkItem, 'Add to cart': addToCart,
  'Review order': reviewOrder, Confirm: confirm,
};

/**
 * Run the checks for one phase against facts the reader produced.
 *
 * @param {Object} facts    from read()
 * @param {string} phase
 * @param {Object} contract what the person asked for
 * @returns {Array<Object>} findings, each carrying what the policy needs
 */
// Which shape each widget's finding wants, keyed by widget name.
//
// Injected, never written here. The assignment is derived from the analysis by
// a generator that lives with the analysis, because a paradigm chosen by hand
// drifts from the corpus it claims to implement — measured at 31% agreement
// the one time it was tried. This file therefore knows how to USE a map and
// nothing about what is in one; with no map, findings fall back to their
// sentence, which is the honest default rather than a guessed shape.
let PARADIGMS = {};

/** @param {Object<string, {paradigm: number}>} map by widget name */
export function setParadigmMap(map) {
  PARADIGMS = map || {};
}

/**
 * The widgets the analysis specifies but no hand-written check covers.
 *
 * Each one names the extractors it needs and carries its sentence with the
 * readings punched out as slots. If every extractor read something and the
 * slots fill exactly, it speaks in the analysis's own words with today's
 * values. If anything is missing it stays silent.
 *
 * Silence is the correct failure here. A sentence half-filled with today's
 * numbers and half with the recording it was written from is a false claim,
 * and this layer exists because a confident false claim is worse than nothing.
 * The plan already carries what could not be read, so nothing goes unaccounted
 * for — it is reported as unread, not as checked.
 */
function fromAnalysis(facts, phase, already) {
  const out = [];
  for (const [widget, w] of Object.entries(PARADIGMS)) {
    if (w.phase !== phase || already.has(widget)) continue;
    if (!w.needs?.length || !w.template) continue;

    const values = w.needs.map((n) => facts[n]).filter((f) => f && !f.absent);
    if (values.length !== w.needs.length) continue;      // something was unreadable
    if (w.slots !== values.length) continue;             // arity does not line up

    // The slot remembers what it was. A template built from "$19.50" leaves a
    // slot that must render as money — filling it with the bare number turned
    // "$19.99 now, typical $23.99" into "19.99 now, typical 23.99", which
    // reads as a quantity rather than a price.
    let i = 0;
    const say = w.template.replace(/\{(\d+)\}/g, () => {
      const v = values[i];
      const wasMoney = (w.slotKinds || [])[i] === 'money';
      i += 1;
      return wasMoney && typeof v.value === 'number' ? money(v.value) : String(v.value);
    });
    if (/\{\d+\}/.test(say)) continue;                   // a slot went unfilled

    out.push({
      widget,
      say,
      from: values.map((v) => v.from).filter(Boolean)[0] || null,
      answerable: false,
      // Generated readbacks state what the page says. They do not contradict
      // the person — only a hand-written comparison can know that — so they
      // never hold the agent.
      contradicts: false,
    });
  }
  return out;
}

// Which part of the ask a finding rests on. Read off the widget's own wording,
// because a check that mentions the size is a check about the size — and the
// alternative, a hand-kept table, would fall out of date the first time a
// check was reworded.
function against(f) {
  const t = `${f.widget} ${f.say}`.toLowerCase();
  if (/\bsize\b/.test(t)) return 'size';
  if (/budget|\$|price|cost|spend/.test(t)) return 'budget';
  if (/arriv|deliver|by (mon|tue|wed|thu|fri|sat|sun)|in time/.test(t)) return 'deadline';
  if (/title|strap|flat|feature|must/.test(t)) return 'mustHaves';
  return null;
}

export function checkPage(facts, phase, contract) {
  const fn = CHECKS[phase];
  const written = fn ? fn(facts, contract) : [];
  const covered = new Set(written.map((f) => f.widget));
  return written.concat(fromAnalysis(facts, phase, covered)).map((f) => {
    // The shape is attached here, from the map, so no check has to know its
    // own paradigm — the assignment belongs to the analysis, not to the code
    // that happens to produce the finding.
    const p = PARADIGMS[f.widget];
    return {
      phase, contradicts: false, answerable: true,
      paradigm: p?.paradigm ?? null,
      // Which field of the ask this was checked against, so editing that field
      // can retire exactly the findings that stop being true — and only those.
      checkedAgainst: against(f),
      ...f,
    };
  });
}
