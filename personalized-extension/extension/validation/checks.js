// The checks: page facts against what the person asked for.
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
const search = (F, c) => {
  const S = F.resultSet?.value;
  if (!S) return [];
  const out = [];

  out.push({
    widget: 'Count-first opener',
    say: `${S.count} products on this page` +
         (S.sponsoredInFirstTen ? `, and ${S.sponsoredInFirstTen} of the first ten are ads.` : '.'),
    from: F.resultSet.from, answerable: false,
  });

  const lim = cap(c);
  if (S.priceLow != null && S.priceHigh != null) {
    const inside = lim && S.priceHigh <= lim;
    out.push({
      widget: 'Price sweep on demand',
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
      say: `The one carrying the shop's ${badged.badge} label isn't the best rated. ` +
           `The best rated has ${S.bestRated.rating} stars from ` +
           `${S.bestRated.ratingCount.toLocaleString()} ratings.`,
      from: `${badged.badge} vs best-rated`, answerable: true,
    });
  }

  // A high score from almost no ratings outranks a real one on stars alone.
  const thin = S.bestRatedThin;
  if (thin?.rating && S.bestRated && thin.rating > S.bestRated.rating) {
    out.push({
      widget: 'Stars never alone',
      say: `Something here shows ${thin.rating} stars, but from only ` +
           `${thin.ratingCount} rating${thin.ratingCount === 1 ? '' : 's'}. ` +
           `That's a thin record, not a better product.`,
      from: `${thin.ratingCount} ratings`, answerable: false,
    });
  }

  if (S.count && S.noPhoto === S.count) {
    out.push({
      widget: 'Unseen-photo stand-in',
      say: `None of the ${S.count} has a photo your screen reader can reach. ` +
           `The pictures are there; they just aren't announced.`,
      from: 'no image entries in any tile', answerable: false,
    });
  }

  const now = F.priceNow?.value, typ = F.priceTypical?.value;
  if (now && typ && typ > now * 1.4) {
    out.push({
      widget: 'Typical-price truth check',
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
  const size = F.cartLineSize?.value;

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
  Search: search, 'Check item': checkItem, 'Add to cart': addToCart,
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
export function checkPage(facts, phase, contract) {
  const fn = CHECKS[phase];
  if (!fn) return [];
  return fn(facts, contract).map((f) => ({ phase, contradicts: false, answerable: true, ...f }));
}
