// The reader: page facts, pulled from the accessibility tree.
//
// This is the layer everything else waits on. A validator can only speak if
// something hands it a value, and the value has to come from the page rather
// than from the agent's account of the page — that separation is the whole
// point, so the reader consumes the same accessibility tree a screen-reader
// user gets and nothing else.
//
// Two consequences worth stating, because they shape every extractor here:
//
//   * If a fact is not in the tree, the reader cannot return it, and it must
//     say so rather than guess. `null` means "not present in what the page
//     exposes" — which is itself a finding, not a failure.
//   * Anything the reader CAN see, a screen-reader user could also have
//     reached. So the layer can never report a fact from a channel that person
//     does not have.
//
// Every extractor is written against real captured page trees and verified by
// reader.test.js. An extractor with no fixture is marked untested rather than
// quietly trusted.

import { parseAria, byRole, find, findAll, capture, money, count,
         hasFlag, flagValue } from './aria-parse.js';

/**
 * @typedef {Object} Read
 * @property {*} value        what the page says, or null when absent
 * @property {string} from    the line it came from, for showing your working
 * @property {boolean} [absent] true when the page simply does not carry it
 */

const got = (value, from) => ({ value, from });
const missing = (why) => ({ value: null, from: why, absent: true });

// ───────────────────────────────────────────────────────────── result tiles
//
// A results page is not a flat list of facts, it is a list of PRODUCTS, and
// almost everything the analysis asks about Search is a relationship between
// them: this price against the others, this rating against the best available,
// this tile against the one the agent picked. Reading the tree as one flat run
// cannot express any of that -- it produced a "discount" by comparing one
// tile's price against a different tile's reference price.
//
// So the tree is grouped first. A tile is a listitem that contains a product
// heading and a price, and everything nested under it belongs to it.
export function tiles(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.role === 'listitem') {
      // A new listitem at or above the depth of the current one ends it.
      if (cur && l.depth <= cur.depth) { if (isProduct(cur)) out.push(cur); cur = null; }
      if (!cur) cur = { depth: l.depth, lines: [] };
      continue;
    }
    if (cur && l.depth > cur.depth) cur.lines.push(l);
    else if (cur) { if (isProduct(cur)) out.push(cur); cur = null; }
  }
  if (cur && isProduct(cur)) out.push(cur);
  return out.map(readTile);
}

const isProduct = (t) => t.lines.some((l) => /\$[\d,]+/.test(l.name))
                      && t.lines.some((l) => l.role === 'heading' && l.name.length > 8);

function readTile(t) {
  const L = t.lines;
  const txt = L.map((l) => l.name).join(' | ');
  const headings = L.filter((l) => l.role === 'heading' && l.name.length > 8);
  // The long heading is the product; a short one before it is the brand.
  const titleLine = headings.sort((a, b) => b.name.length - a.name.length)[0];
  const priceLine = L.find((l) => /^\$[\d,]+/.test(l.name));
  const ratingLine = L.find((l) => /out of 5 stars/i.test(l.name));
  // "4.4 out of 5 stars, rating details" also matches a naive /ratings?/ and
  // yields 4 as the count. The rating-count line is a link whose whole name is
  // the number and the word.
  const countLine = L.find((l) => /^[\d,]+\s+ratings?$/i.test(l.name.trim()));

  return {
    title: titleLine ? titleLine.name : null,
    brand: headings.find((h) => h !== titleLine)?.name || null,
    // "Sponsored" never appears as its own line. It is inside the ad-feedback
    // button's name, inside the link's name, or prefixed to the heading.
    sponsored: /sponsored/i.test(txt),
    price: priceLine ? money(priceLine.name.match(/^\$[\d,.]+/)[0]) : null,
    typical: /typical|list:/i.test(txt)
      ? money((txt.match(/(?:Typical(?:\s+price)?|List):\s*\$?([\d,.]+)/i) || [])[1]) : null,
    rating: ratingLine ? Number((ratingLine.name.match(/([\d.]+) out of 5/i) || [])[1]) : null,
    ratingCount: countLine ? count(countLine.name) : null,
    badge: (txt.match(/Overall Pick|Best Seller|Amazon's Choice|Limited [\w ]*deal/i) || [])[0] || null,
    // A product photo has no entry in the tile's accessibility tree at all.
    // The only images announced are the Prime badge and a brand logo, so a
    // screen reader hears a tile that sounds text-only. `hasPhoto` is
    // therefore almost always false, and that IS the finding.
    hasPhoto: L.some((l) => l.role === 'img'
      && !/^(prime|sponsored)$/i.test(l.name)
      && l.name.length > 12),
  };
}

// ─────────────────────────────────────────────────────────── search results
export const resultCount = (lines) => {
  // "1-48 of 944 results for" — the heading a screen reader speaks first.
  const l = find(lines, /of\s+[\d,]+\s+results/i);
  if (l) return got(count(capture([l], /of\s+([\d,]+)\s+results/i)), l.name);

  // "over 1,000 results" when the count is approximate.
  const over = find(lines, /over\s+[\d,]+\s+results/i);
  if (over) return { ...got(count(capture([over], /over\s+([\d,]+)/i)), over.name),
                     approximate: true };

  // "1-48 of 944" without the word results, or a bare "944 results".
  const range = find(lines, /\d+\s*-\s*\d+\s+of\s+[\d,]+/i);
  if (range) return got(count(capture([range], /of\s+([\d,]+)/i)), range.name);
  const bare = find(lines, /^[\d,]+\s+results/i);
  if (bare) return got(count(capture([bare], /^([\d,]+)/)), bare.name);

  // Genuinely absent: the main slot often carries no count at all, which is
  // itself the finding -- the first number a person would want is not on the
  // page in any form a screen reader reaches.
  return missing('no result count anywhere in this tree');
};

export const sponsoredCount = (lines) => {
  // Counting lines that read exactly "Sponsored" finds almost nothing: the
  // word lives inside an ad-feedback button's accessible name, or prefixed to
  // the product heading. It has to be counted per tile.
  const t = tiles(lines);
  if (!t.length) return missing('no product tiles found in this tree');
  const ads = t.filter((x) => x.sponsored).length;
  const firstTen = t.slice(0, 10).filter((x) => x.sponsored).length;
  return { ...got(ads, `${ads} of ${t.length} tiles carry a Sponsored marker`),
           ofFirstTen: firstTen, total: t.length };
};

export const firstOrganicIndex = (lines) => {
  const t = tiles(lines);
  const idx = t.findIndex((x) => !x.sponsored);
  return idx < 0 ? missing('every tile on this page is sponsored')
                 : got(idx + 1, `${t[idx].title?.slice(0, 40)}`);
};

export const tilePrices = (lines) => {
  // One price per product, not every dollar figure on the page. The flat scan
  // returned 123 numbers for a 48-result page by counting carousels, reference
  // prices and "also bought" strips.
  const p = tiles(lines).map((t) => t.price).filter((n) => n != null);
  return p.length ? got(p, `${p.length} product prices`) : missing('no tile prices');
};

export const tileRatings = (lines) => {
  const r = tiles(lines).map((t) => t.rating).filter((n) => n != null);
  return r.length ? got(r, `${r.length} product ratings`) : missing('no tile ratings');
};

export const tileRatingCounts = (lines) => {
  const c = tiles(lines).map((t) => t.ratingCount).filter((n) => n != null);
  return c.length ? got(c, `${c.length} rating counts`) : missing('no rating counts');
};

export const tileHasPhoto = (lines) => {
  // The finding this exists for: a result tile's photo often has NO entry in
  // the tree at all, so a screen reader announces a tile that sounds text-only.
  const imgs = byRole(lines, 'img');
  return got(imgs.length > 0, imgs.length ? `${imgs.length} images announced`
                                          : 'no image entry in the tile');
};

export const photoAltText = (lines) => {
  const alts = byRole(lines, 'img').map((l) => l.name).filter(Boolean);
  if (!alts.length) return missing('images carry no alternative text');
  const distinct = new Set(alts);
  // Seven photos all announcing "Product Image" is the same as none: the
  // gallery is unnavigable because nothing distinguishes one from another.
  return { ...got(alts, `${alts.length} images, ${distinct.size} distinct descriptions`),
           useless: distinct.size === 1 && alts.length > 1 };
};

export const filterNames = (lines) => {
  const boxes = byRole(lines, 'checkbox').map((l) => l.name).filter(Boolean);
  return boxes.length ? got(boxes, `${boxes.length} filter checkboxes`)
                      : missing('no filter checkboxes in the tree');
};

export const activeFilters = (lines) => {
  // Read from the page's own controls, never from memory of what was clicked.
  const on = byRole(lines, 'checkbox').filter((l) => hasFlag(l, 'checked')).map((l) => l.name);
  const removeLinks = findAll(lines, /^Remove .+ filter$/i)
    .map((l) => l.name.replace(/^Remove | filter$/gi, ''));
  const names = on.length ? on : removeLinks;
  return got(names, on.length ? 'checked checkboxes' : 'Remove-filter links in the sidebar');
};

export const sortOrder = (lines) => {
  const combo = byRole(lines, 'combobox').find((l) => /sort/i.test(l.name)) ||
                find(lines, /^(Featured|Price:|Avg\. Customer Review|Newest)/i);
  return combo ? got(combo.name.replace(/^Sort by:?\s*/i, ''), combo.name)
               : missing('no sort control in the tree');
};

export const sortOptions = (lines) => {
  const opts = byRole(lines, 'option').map((l) => l.name).filter(Boolean);
  return opts.length ? got(opts, `${opts.length} sort options`) : missing('no sort options');
};

/**
 * The result set as one object: how many, how they spread, what carries a
 * badge. This is what the Search phase actually needs — a person choosing
 * between products needs the shape of the set, not one product's facts.
 */
export const resultSet = (lines) => {
  const t = tiles(lines);
  if (!t.length) return missing('no product tiles in this tree');
  const prices = t.map((x) => x.price).filter((n) => n != null);
  const rated = t.filter((x) => x.rating != null);
  return got({
    count: t.length,
    sponsored: t.filter((x) => x.sponsored).length,
    sponsoredInFirstTen: t.slice(0, 10).filter((x) => x.sponsored).length,
    priceLow: prices.length ? Math.min(...prices) : null,
    priceHigh: prices.length ? Math.max(...prices) : null,
    // Ranking by stars alone crowns a 5.0 from 5 ratings over a 4.4 from
    // 2,715 -- which is the failure the analysis records, not a ranking. A
    // rating needs enough behind it to mean anything, so thin records are
    // reported separately rather than winning.
    bestRated: rated.filter((x) => (x.ratingCount || 0) >= 50)
      .sort((a, b) => b.rating - a.rating)[0] || null,
    bestRatedThin: rated.filter((x) => (x.ratingCount || 0) < 50)
      .sort((a, b) => b.rating - a.rating)[0] || null,
    withBadge: t.filter((x) => x.badge).map((x) => ({ badge: x.badge, title: x.title })),
    noPhoto: t.filter((x) => !x.hasPhoto).length,
  }, `${t.length} product tiles`);
};

export const badges = (lines) => {
  const b = findAll(lines, /overall pick|best seller|amazon.s choice|climate pledge/i)
    .map((l) => l.name);
  return got(b, b.length ? b.join(', ') : 'no badges in the tree');
};

export const priceNow = (lines) => {
  // On a results page this is the first PRODUCT's price. Taking the first
  // dollar figure anywhere compared one tile's price against another tile's
  // reference price and reported the difference as a discount.
  const t = tiles(lines);
  if (t.length) {
    const first = t.find((x) => x.price != null);
    return first ? got(first.price, `${first.title?.slice(0, 40)}`)
                 : missing('no tile carries a price');
  }
  const l = find(lines, /\$[\d,]+\.?\d*/);
  return l ? got(money(l.name), l.name) : missing('no price in the tree');
};

export const priceTypical = (lines) => {
  // "$12.60 Typical: $19.50" — the crossed-out reference price, which reads to
  // a screen reader as a second number with the word Typical in front of it.
  // Must come from the same tile as priceNow, or the "discount" is a
  // comparison between two different products.
  const t = tiles(lines);
  if (t.length) {
    const first = t.find((x) => x.price != null);
    return first?.typical != null
      ? got(first.typical, `${first.title?.slice(0, 34)}: $${first.price} vs $${first.typical}`)
      : missing('the first product shows no reference price');
  }
  const l = find(lines, /typical|list:/i);
  return l ? got(money(capture([l], /(?:Typical(?:\s+price)?|List):\s*\$?([\d,.]+)/i)), l.name)
           : missing('no typical price shown');
};

export const colorSwatches = (lines) => {
  const sw = findAll(lines, /^(Pink|Purple|White|Black|Blue|Silver|Beige|Gold|Red|Green)/i)
    .map((l) => l.name);
  return sw.length ? got(sw, `${sw.length} colour names`) : missing('no colour swatches');
};

export const hiddenColorCount = (lines) => {
  const l = find(lines, /\+\s*\d+|see more|more colou?rs/i);
  return l ? got(count(capture([l], /(\d+)/)), l.name) : missing('no hidden-colour link');
};

// ─────────────────────────────────────────────────────────── the product page
export const title = (lines) => {
  // "Product details" and landmark descriptions are also level-1 headings, and
  // taking the first one reported "Product summary presents key product
  // information" as the product's title. The product's own heading is the
  // longest of them: a real title is 60+ words of keyword stuffing, a section
  // label is two.
  const SECTION = /^(product details|about this item|top highlights|customer reviews|product summary|from the brand|product information)/i;
  const h1 = byRole(lines, 'heading')
    .filter((l) => flagValue(l, 'level') === '1' && l.name && !SECTION.test(l.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (h1) return got(h1.name, h1.name);
  const any = byRole(lines, 'heading').filter((l) => l.name && !SECTION.test(l.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return any ? got(any.name, any.name) : missing('no product heading on the page');
};

export const buyBoxPrice = (lines) => {
  // Read from the buy box only. A product page carries several numbers and the
  // one the button will charge is the only one that matters.
  const l = byRole(lines, 'text').find((t) => /^\$[\d,]+\.?\d*$/.test(t.name)) ||
            find(lines, /\$[\d,]+\.?\d*/);
  return l ? got(money(l.name), l.name) : missing('no price in the buy box');
};

export const rating = (lines) => {
  const l = find(lines, /out of 5 stars/i);
  return l ? got(Number(capture([l], /([\d.]+) out of 5/i)), l.name)
           : missing('no rating on the page');
};

export const ratingCount = (lines) => {
  const l = find(lines, /\d+\s*(Reviews|ratings)/i);
  return l ? got(count(capture([l], /([\d,]+)\s*(?:Reviews|ratings)/i)), l.name)
           : missing('no rating count on the page');
};

export const sizeOptions = (lines) => {
  // Exclude colour radios, whose labels are whole buy-box paragraphs carrying
  // a price. A size label is short and has no money in it.
  const radios = byRole(lines, 'radio').map((l) => l.name).filter(Boolean)
    .filter((n) => !/\$/.test(n) && n.split(/\s+/).length <= 4);
  return radios.length ? got(radios, `${radios.length} size radios`)
                       : missing('no size selector in the tree');
};

// Amazon renders several labelled values into one text node with no separator:
// "Size: 5 Big KidColor: White Beige". Splitting on whitespace cannot find the
// boundary because there is none -- the cut is where a capitalised word is
// immediately followed by a colon, which is the next label starting.
function cutAtNextLabel(v) {
  return String(v).replace(/([A-Z][a-z]+):\s*.*$/, '').trim();
}

export const selectedSize = (lines) => {
  // A product page carries several radiogroups. On a live page the first is
  // colour, and each of its options is the whole buy-box blob -- "Pink $11.81
  // $11.81 FREE Delivery Tomorrow In Stock". Taking the first checked radio
  // therefore returns a paragraph where a size was wanted.
  //
  // The checked radio wins over the page's own "Size:" text. Observed live:
  // the label read "Size: 11 Little Kid" while the checked radio was "12
  // Little Kid", and the cart received the 12 — so the label is the hover
  // state, not the selection. Trusting it would report a size that was never
  // bought, which is worse than reporting none.
  const checked = byRole(lines, 'radio').filter((l) => hasFlag(l, 'checked'));
  const sizey = checked.find((l) => l.name.split(/\s+/).length <= 4 && !/\$/.test(l.name));
  if (sizey) {
    const stated = find(lines, /^Size:\s*\S/i);
    const label = stated && cutAtNextLabel(stated.name.replace(/^Size:\s*/i, ''));
    return { ...got(sizey.name, `${sizey.name} [checked]`),
             // The page contradicting itself is a finding in its own right.
             labelDisagrees: label && label !== sizey.name ? label : null };
  }
  const stated = find(lines, /^Size:\s*\S/i);
  if (stated) return got(cutAtNextLabel(stated.name.replace(/^Size:\s*/i, '')), stated.name);
  return missing('no size stated, and no size-shaped radio is checked');
};

export const stockLine = (lines) => {
  // "In Stock" also appears inside each colour option's label, which says
  // nothing about the variant actually selected. The buy box's own line is a
  // short standalone one.
  const short = findAll(lines, /in stock|out of stock|only \d+ left|currently unavailable/i)
    .filter((l) => l.name.split(/\s+/).length <= 6 && !/\$/.test(l.name));
  if (short.length) return got(short[0].name, short[0].name);
  const low = find(lines, /only \d+ left/i);
  return low ? got(low.name, low.name) : missing('no standalone stock line by the buy box');
};

export const galleryCount = (lines) => {
  const imgs = byRole(lines, 'img').length || byRole(lines, 'radio')
    .filter((l) => /image/i.test(l.name)).length;
  return imgs ? got(imgs, `${imgs} gallery entries`) : missing('no gallery in the tree');
};

export const galleryAlt = (lines) => photoAltText(lines);

export const reviewCount = (lines) => ratingCount(lines);

export const reviewText = (lines) => {
  // Review bodies sit under headings; the tree gives them as plain text runs.
  const bodies = byRole(lines, 'text').filter((l) => l.name.split(/\s+/).length > 8)
    .map((l) => l.name);
  return bodies.length ? got(bodies, `${bodies.length} review passages`)
                       : missing('no review text in the tree');
};

export const deliveryDate = (lines) => {
  const l = find(lines, /delivery|arriv/i);
  if (!l) return missing('no delivery promise on the page');
  const d = capture([l], /(?:delivery|arriving)\s+([A-Z][a-z]+(?:day)?,?\s*[A-Z]?[a-z]*\s*\d{0,2})/i);
  return got(d ? d.replace(/[.,]$/, '') : l.name, l.name);
};

export const countdown = (lines) => {
  const l = find(lines, /order within|ends in|left to order/i);
  return l ? got(capture([l], /within\s+(.+?)(?:\.|$)/i) || l.name, l.name)
           : missing('no countdown on the page');
};

export const returnsBadge = (lines) => {
  const l = find(lines, /free returns|returnable|no returns/i);
  return l ? got(l.name, l.name) : missing('no returns badge on the page');
};

export const returnsPolicy = (lines) => {
  const l = find(lines, /\d+ days?|return window|refund/i);
  return l ? got(l.name, l.name) : missing('the policy text is behind a link');
};

export const specRows = (lines) => {
  const rows = byRole(lines, 'listitem').filter((l) => /[:‏‎]/.test(l.name))
    .map((l) => l.name.replace(/[‏‎]/g, '').replace(/\s*:\s*/, ': ').trim());
  return rows.length ? got(rows, `${rows.length} detail rows`)
                     : missing('no product details table');
};

export const detailsTable = specRows;

// ─────────────────────────────────────────────────────────── cart & checkout
export const addConfirmation = (lines) => {
  const l = find(lines, /added to (cart|basket)|added!/i);
  return l ? got(l.name, l.name) : missing('no add confirmation in the tree');
};

export const cartCount = (lines) => {
  // The count is not on the badge for a screen reader: it lives inside the
  // checkout button's label, e.g. "Proceed to checkout (3 items)".
  const l = find(lines, /\d+\s*items? in (cart|basket)/i) ||
            find(lines, /cart\b.*\d+|checkout.*\(\d+/i);
  return l ? got(count(capture([l], /(\d+)/)), l.name) : missing('no cart count in the tree');
};

export const cartLines = (lines) => {
  // Product lines are not where you would look for them. On the review page the
  // money listitems are the totals block -- Items (3), Shipping, Tax, Order
  // total -- and each actual product arrives as a LINK whose accessible name is
  // "Add gift options" followed by the whole product title. So a screen reader
  // announces every item as a gift-options control, and the product name is
  // the tail of that control's label.
  const GIFT = /^Add gift options\s+/i;
  const fromLinks = byRole(lines, 'link')
    .filter((l) => GIFT.test(l.name))
    .map((l) => l.name.replace(GIFT, '').trim());
  if (fromLinks.length) {
    return got(fromLinks, `${fromLinks.length} products, each named inside an "Add gift options" link`);
  }
  // Cart pages do use listitems; exclude the totals block there.
  const TOTALS = /^(items?\s*\(|shipping|estimated tax|order total|promotion|before tax|cash back|subtotal)/i;
  const items = byRole(lines, 'listitem')
    .filter((l) => /\$/.test(l.name) && !TOTALS.test(l.name.trim()))
    .map((l) => l.name);
  return items.length ? got(items, `${items.length} product lines`)
                      : missing('no product lines distinguishable from the totals');
};

export const cartLineSize = (lines) => {
  const l = find(lines, /size:/i);
  return l ? got(capture([l], /Size:\s*([^,]+)/i), l.name)
           : missing('no size in the cart line');
};

export const shipAddress = (lines) => {
  const l = find(lines, /deliver(ing)? to/i);
  return l ? got(l.name.replace(/^Deliver(ing)? to\s*/i, ''), l.name)
           : missing('no delivery address on the page');
};

export const deliveryOptions = (lines) => {
  const opts = byRole(lines, 'radio').map((l) => l.name).filter(Boolean);
  return opts.length ? got(opts, `${opts.length} delivery radios`)
                     : missing('no delivery options in the tree');
};

export const selectedDelivery = (lines) => {
  const c = byRole(lines, 'radio').find((l) => hasFlag(l, 'checked'));
  return c ? got(c.name, `${c.name} [checked]`) : missing('no delivery option selected');
};

export const formErrors = (lines) => {
  const errs = findAll(lines, /error|required|invalid|please (enter|correct)/i).map((l) => l.name);
  return got(errs, errs.length ? `${errs.length} error messages` : 'no errors on the form');
};

// ─────────────────────────────────────────────────────────── review & confirm
export const itemCount = (lines) => {
  const l = find(lines, /items?\s*\(\s*\d+\s*\)/i);
  return l ? got(count(capture([l], /\(\s*(\d+)\s*\)/)), l.name)
           : missing('no item count on the review page');
};

export const itemsSubtotal = (lines) => {
  const l = find(lines, /items?\s*\(\s*\d+\s*\)\s*:/i);
  return l ? got(money(capture([l], /:\s*\$?([\d,.]+)/)), l.name)
           : missing('no items subtotal');
};

export const orderTotal = (lines) => {
  const l = find(lines, /order total/i);
  return l ? got(money(capture([l], /:\s*\$?([\d,.]+)/)), l.name)
           : missing('no order total on the page');
};

export const tax = (lines) => {
  const l = find(lines, /tax/i);
  return l ? got(money(capture([l], /:\s*\$?([\d,.]+)/)), l.name) : missing('no tax line');
};

export const arrivalDate = (lines) => {
  const l = find(lines, /arriving|estimated delivery/i);
  return l ? got(l.name.replace(/^Arriving\s*/i, ''), l.name) : missing('no arrival date');
};

export const cardLabel = (lines) => {
  const l = find(lines, /paying with|payment method/i);
  return l ? got(l.name.replace(/^Paying with\s*/i, ''), l.name) : missing('no card named');
};

export const cardLastFour = (lines) => {
  const l = find(lines, /paying with/i);
  const four = l && capture([l], /(\d{4})\s*$/);
  // "Mastercard ****" — four literal asterisks, zero digits — is the observed
  // failure, so absence here is the finding rather than a parse problem.
  return four ? got(four, l.name)
              : missing(l ? `card named without digits: "${l.name}"` : 'no card on the page');
};

export const orderLines = (lines) => cartLines(lines);

export const outcomeHeading = (lines) => {
  const h = byRole(lines, 'heading').find((l) => /order placed|thank|confirm/i.test(l.name));
  if (!h) return missing('no outcome heading on the page');
  // The level matters: "Order placed, thanks!" marked up as a level-4 heading
  // is filed where nobody navigating by heading would skim.
  return { ...got(h.name, h.name), level: Number(flagValue(h, 'level')) || null };
};

export const orderNumber = (lines) => {
  const l = find(lines, /\d{3}-\d{7}-\d{7}/);
  return l ? got(capture([l], /(\d{3}-\d{7}-\d{7})/), l.name)
           : missing('no order number anywhere on this page');
};

export const confirmationEmail = (lines) => {
  const l = find(lines, /confirmation will be sent|sent to your email/i);
  return l ? got(l.name, l.name) : missing('no email promise on the page');
};

export const cancelControl = (lines) => {
  const l = find(lines, /cancel (items?|order)|view or edit order/i);
  return l ? got(l.name, l.name) : missing('no cancel control on the page');
};

export const orderStatus = (lines) => {
  const l = find(lines, /cancelled|shipped|delivered|preparing|not yet shipped/i);
  return l ? got(l.name, l.name) : missing('no order status on the page');
};

// ───────────────────────────────────────────────────────────────── the surface
export const EXTRACTORS = {
  resultSet,
  resultCount, sponsoredCount, firstOrganicIndex, tileHasPhoto, photoAltText,
  tilePrices, tileRatings, tileRatingCounts, filterNames, activeFilters,
  priceNow, priceTypical, colorSwatches, hiddenColorCount, sortOrder,
  sortOptions, badges, title, specRows, buyBoxPrice, rating, ratingCount,
  sizeOptions, selectedSize, stockLine, galleryCount, galleryAlt, reviewCount,
  reviewText, deliveryDate, countdown, returnsBadge, returnsPolicy,
  detailsTable, addConfirmation, cartCount, cartLineSize, cartLines,
  shipAddress, deliveryOptions, selectedDelivery, formErrors, itemCount,
  orderTotal, itemsSubtotal, tax, arrivalDate, cardLabel, cardLastFour,
  orderLines, outcomeHeading, orderNumber, confirmationEmail, cancelControl,
  orderStatus,
};

/**
 * Read every named signal from one page snapshot.
 *
 * @param {string} snapshot  indented accessibility text, from the harness or a
 *                           saved capture — the two are the same format
 * @param {string[]} want    extractor names, usually a signal's `reads`
 * @returns {Object<string, Read>}
 */
export function read(snapshot, want) {
  const lines = parseAria(snapshot);
  const out = {};
  for (const name of want) {
    const fn = EXTRACTORS[name];
    out[name] = fn ? fn(lines) : missing(`no extractor named ${name}`);
  }
  return out;
}
