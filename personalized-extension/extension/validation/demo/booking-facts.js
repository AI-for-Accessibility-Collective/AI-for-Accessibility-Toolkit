// Booking.com page facts, read off the live DOM.
//
// Every selector here was taken from the rehearsal DOM dumps
// (assets/booking-recon/dom-*.html in the Verification Affordances project),
// not guessed, and every extractor degrades to null rather than throwing -
// the director treats a null as "relation not readable" and the beat's
// rehearsal fallback carries the line. Text scans run on innerText because
// booking's class names churn while its visible words do not.

const $ = (doc, sel) => doc.querySelector(sel);
const $$ = (doc, sel) => [...doc.querySelectorAll(sel)];
const tid = (name) => `[data-testid="${name}"]`;
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

// The page's words without its code. textContent on booking's body is mostly
// inline JSON - the visible sentence "Free cancellation before Sep 14" sits
// past a 100k wall of script - and innerText needs layout, which a parsed
// document does not have. The walker reads only text whose parent renders,
// and never mutates the page it reads.
function visibleText(root, cap = 200000) {
  if (!root) return '';
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/
      .test(n.parentElement?.tagName || '')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let out = '';
  let node;
  while ((node = walker.nextNode())) {
    out += `${node.data} `;
    if (out.length > cap) break;
  }
  return out.replace(/\s+/g, ' ');
}

const MONEY = /\$\s?([\d,]+(?:\.\d\d)?)/;
export const money = (s) => {
  const m = String(s || '').match(MONEY);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** 'home' | 'results' | 'property' | 'checkout' | 'unknown' */
export function classify(doc, url) {
  const u = String(url || '');
  if (/\/searchresults/.test(u) || $(doc, tid('property-card'))) return 'results';
  if (/\/book(?:ing)?\.html|\/book\//.test(u)
      || $(doc, tid('booking-details-date-summary'))
      || $(doc, tid('cancellation-timeline-item'))) return 'checkout';
  if (/\/hotel\//.test(u) || $(doc, '[class*="hprt-table"]')) return 'property';
  if ($(doc, 'input[name="ss"]')) return 'home';
  return 'unknown';
}

function homeFacts(doc) {
  // The destination autocomplete - and ONLY it. Booking's home page keeps
  // other listboxes in the DOM while closed (pickers, recent searches), and
  // counting those fired the stanfords widget before the agent had typed a
  // letter, whose hold then blocked the agent's own type action. So: only
  // the container the destination input names via aria-controls (or the
  // autocomplete testid), only elements that actually render, and only
  // while the box holds a typed query.
  const box = $(doc, 'input[name="ss"]');
  const destQuery = (box?.value || '').trim();
  const owned = box?.getAttribute('aria-controls');
  const root = (owned && doc.getElementById(owned))
    || $(doc, tid('autocomplete-results'));
  const items = root ? [...root.querySelectorAll('li')] : [];
  const destOptions = items
    .filter((li) => li.getClientRects().length > 0)
    .map((li) => {
      const lines = [...li.querySelectorAll('div,span')].map(text).filter(Boolean);
      return { main: lines[0] || text(li), sub: lines.find((l, i) => i > 0 && l !== lines[0]) || null };
    }).filter((o) => o.main);
  return { destQuery, destOptions };
}

function resultsFacts(doc) {
  const h1 = text($(doc, 'h1'));
  const countM = String(h1 || '').match(/([\d,]+)\s+(?:properties|exact matches|search results)/i);
  // The property-type facet count lives in the filter's accessible text as
  // "Hotels: 64 properties" (the visible label is just "Hotels").
  let hotelFacet = null;
  const facetM = visibleText(doc.body, 250000).match(/Hotels:?\s*([\d,]+)\s+propert/i)
    || String(doc.body?.innerHTML || '').match(/Hotels:\s*([\d,]+)\s+propert/i);
  if (facetM) hotelFacet = Number(facetM[1].replace(/,/g, ''));
  const cards = $$(doc, tid('property-card')).map((card) => {
    const units = text(card.querySelector(tid('recommended-units')));
    return {
      name: text(card.querySelector(tid('title'))),
      distance: text(card.querySelector(tid('distance'))),
      address: text(card.querySelector(tid('address-link'))),
      price: money(text(card.querySelector(tid('price-and-discounted-price')))),
      rating: (() => {
        const m = text(card.querySelector(tid('review-score')))?.match(/(\d\.\d)/);
        return m ? Number(m[1]) : null;
      })(),
      units,
      beds: units?.match(/\d+\s+(?:full|queen|king|twin|single|double)\s+beds?|1\s+king\s+bed/gi) || [],
      // Booking marks sponsored tiles with a literal "Ad" badge and an
      // Advertisement aria-label (verified in dom-pa-results.html).
      isAd: !!(card.querySelector('[aria-label="Advertisement"]')
        || [...card.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Ad')),
    };
  });
  return {
    resultCount: countM ? Number(countM[1].replace(/,/g, '')) : null,
    hotelFacet,
    cards,
    adCount: cards.filter((c) => c.isAd).length,
  };
}

function propertyFacts(doc) {
  const rows = $$(doc, '[class*="hprt-table"] tbody tr');
  const rooms = [];
  for (const tr of rows) {
    const typeCell = tr.querySelector(tid('hprt-table-cell-roomtype'))
      || tr.querySelector('[class*="roomtype"]');
    // Booking rowspans the room-type cell, so follow-on rate rows for the
    // same room have no type cell - those rows only re-price the same beds.
    if (!typeCell) continue;
    const t = text(typeCell) || '';
    rooms.push({
      type: text(typeCell.querySelector('a, .hprt-roomtype-icon-link')) || t.slice(0, 60),
      beds: t.match(/\d+\s+(?:full|queen|king|twin|single|double)\s+beds?|1\s+(?:king|queen|full)\s+bed/gi) || [],
      price: money(text(tr)),
      maxPeople: (() => {
        const occ = tr.querySelector('[class*="hprt-occupancy"]');
        const m = (occ?.getAttribute('aria-label') || text(occ) || '').match(/(\d+)/);
        return m ? Number(m[1]) : null;
      })(),
    });
  }
  return { hotelName: text($(doc, 'h2')), rooms };
}

function checkoutFacts(doc) {
  const body = visibleText(doc.body);
  const total = (() => {
    const m = body.match(/Total[\s\S]{0,120}?\$([\d,]+\.\d\d)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  })();
  const cancelM = body.match(/Free cancellation (?:before|until) ([A-Z][a-z]{2,8} \d{1,2})/);
  // "After 12:00 AM on Sep 14   $368.44" - the penalty rides the timeline
  // row after the free window (verified in dom-zen-book.html).
  const penaltyM = body.match(/(?:After|From) [^$]{0,60}\$([\d,]+\.\d\d)/);
  const occM = body.match(/(\d+) adults?, (\d+) child/);
  return {
    total,
    taxLine: (body.match(/Includes \$[\d,.]+ in taxes and fees/) || [null])[0],
    freeCancelBefore: cancelM ? cancelM[1] : null,
    penalty: penaltyM ? Number(penaltyM[1].replace(/,/g, '')) : null,
    occupancy: occM ? { adults: Number(occM[1]), children: Number(occM[2]) } : null,
    hasForm: !!$(doc, 'input[name="firstname"], #firstname'),
    // The whole fill, not the first field: gating on firstname alone froze
    // the agent mid-form (typing fires no mutations; the heartbeat caught
    // field one), and an autofilled firstname tripped the gate on arrival.
    formFilled: (() => {
      const first = ($(doc, 'input[name="firstname"], #firstname')?.value || '').trim();
      const email = ($(doc, 'input[name="email"], #email, input[type="email"]')?.value || '').trim();
      return !!first && email.length > 3;
    })(),
    hasArrival: $$(doc, 'select').some((s) =>
      /arrival/i.test(s.name + s.id + (s.getAttribute('aria-label') || ''))) || /arrival time/i.test(body),
    hasSpecialRequests: /Special requests/i.test(body),
  };
}

/** Everything the director needs from this page, in one read. */
export function readPage(doc, url) {
  const page = classify(doc, url);
  const base = { page, url: String(url || ''), at: Date.now() };
  try {
    if (page === 'home') return { ...base, ...homeFacts(doc) };
    if (page === 'results') return { ...base, ...resultsFacts(doc) };
    if (page === 'property') return { ...base, ...propertyFacts(doc) };
    if (page === 'checkout') return { ...base, ...checkoutFacts(doc) };
  } catch (e) {
    return { ...base, readError: String(e?.message || e) };
  }
  return base;
}
