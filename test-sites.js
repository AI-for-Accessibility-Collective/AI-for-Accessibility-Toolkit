/**
 * Test script to run axe-core on real websites and verify handler coverage
 * Run with: node test-sites.js
 */

const { chromium } = require('playwright');

// 100 REAL content pages (not homepages) for realistic testing
const TEST_SITES = [
  // Reddit posts
  'https://www.reddit.com/r/technology/comments/1d5m2xz/microsoft_will_switch_off_recall_by_default/',
  'https://www.reddit.com/r/AskReddit/comments/1d4z8k5/what_is_something_that_was_considered_normal_20/',
  'https://old.reddit.com/r/programming/top/?t=week',

  // News articles
  'https://www.bbc.com/news/articles/cd11gzejgz4o',
  'https://www.cnn.com/2024/05/15/tech/openai-gpt-4o-announcement/index.html',
  'https://www.nytimes.com/2024/01/15/technology/ai-chatbot-hallucination.html',
  'https://www.theguardian.com/technology/2024/may/14/openai-chatgpt-4o-launch',
  'https://www.npr.org/sections/health-shots/',
  'https://arstechnica.com/ai/2024/05/what-is-openais-new-gpt-4o-model/',
  'https://www.theverge.com/2024/5/13/24155493/google-ai-overview-search-results-page',

  // Wikipedia articles
  'https://en.wikipedia.org/wiki/Accessibility',
  'https://en.wikipedia.org/wiki/Web_Content_Accessibility_Guidelines',
  'https://en.wikipedia.org/wiki/Screen_reader',

  // eBay product pages
  'https://www.ebay.com/itm/256147283841',
  'https://www.ebay.com/b/Cell-Phones-Smartphones/9355/bn_320094',

  // Amazon product pages (might have CSP issues)
  'https://www.amazon.com/dp/B0BSHF7WHW',

  // Etsy products
  'https://www.etsy.com/listing/1484635374/',
  'https://www.etsy.com/search?q=handmade%20jewelry',

  // Stack Overflow questions
  'https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git',
  'https://stackoverflow.com/questions/292357/what-is-the-difference-between-git-pull-and-git-fetch',
  'https://stackoverflow.com/questions/tagged/javascript?tab=votes',

  // YouTube video pages
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',

  // GitHub repos/issues
  'https://github.com/microsoft/vscode/issues',
  'https://github.com/facebook/react/blob/main/README.md',

  // IMDB movie pages
  'https://www.imdb.com/title/tt0111161/',
  'https://www.imdb.com/title/tt0468569/',
  'https://www.imdb.com/name/nm0000151/',

  // Yelp business pages
  'https://www.yelp.com/biz/tartine-bakery-san-francisco',
  'https://www.yelp.com/search?find_desc=restaurants&find_loc=San+Francisco',

  // Recipe pages
  'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
  'https://www.foodnetwork.com/recipes/ina-garten/perfect-roast-chicken-recipe-1940592',
  'https://www.epicurious.com/recipes/food/views/pasta-alla-gricia-56390024',

  // Health articles
  'https://www.webmd.com/cold-and-flu/default.htm',
  'https://www.mayoclinic.org/diseases-conditions/common-cold/symptoms-causes/syc-20351605',
  'https://www.healthline.com/nutrition/how-much-water-should-you-drink-per-day',

  // Sports articles/scores
  'https://www.espn.com/nba/standings',
  'https://www.espn.com/nfl/player/_/id/3139477/patrick-mahomes',
  'https://bleacherreport.com/nba',

  // Finance articles
  'https://www.investopedia.com/terms/s/sp500.asp',
  'https://www.marketwatch.com/investing/index/spx',
  'https://finance.yahoo.com/quote/AAPL/',

  // Travel pages
  'https://www.tripadvisor.com/Hotel_Review-g60763-d93450-Reviews-The_Plaza-New_York_City_New_York.html',
  'https://www.tripadvisor.com/Attractions-g60763-Activities-New_York_City_New_York.html',
  'https://www.booking.com/hotel/us/the-plaza.html',

  // Documentation
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
  'https://docs.python.org/3/tutorial/index.html',
  'https://react.dev/learn',
  'https://vuejs.org/guide/introduction.html',

  // Forums/Q&A
  'https://www.quora.com/What-is-the-best-programming-language-to-learn-in-2024',
  'https://news.ycombinator.com/item?id=40358041',

  // Blogs
  'https://medium.com/tag/programming',
  'https://dev.to/t/javascript',
  'https://css-tricks.com/guides/',

  // E-commerce category pages
  'https://www.target.com/c/electronics/-/N-5xtg6',
  'https://www.walmart.com/browse/electronics/3944',
  'https://www.bestbuy.com/site/computers-pcs/laptop-computers/abcat0502000.c',
  'https://www.ikea.com/us/en/cat/desks-computer-desks-20649/',
  'https://www.homedepot.com/b/Tools/N-5yc1vZc1xy',

  // Maps/Directions
  'https://www.google.com/maps/place/San+Francisco,+CA/',

  // Government forms/info
  'https://www.irs.gov/forms-pubs/about-form-1040',
  'https://www.ssa.gov/benefits/retirement/',
  'https://www.usa.gov/passport',

  // Weather
  'https://www.weather.gov/sfo/',
  'https://weather.com/weather/today/l/San+Francisco+CA',

  // Education courses
  'https://www.coursera.org/learn/machine-learning',
  'https://www.khanacademy.org/math/algebra',
  'https://www.edx.org/learn/computer-science',

  // Job listings
  'https://www.linkedin.com/jobs/search/?keywords=software%20engineer',
  'https://www.indeed.com/jobs?q=software+engineer&l=remote',
  'https://www.glassdoor.com/Job/software-engineer-jobs-SRCH_KO0,17.htm',

  // Real estate
  'https://www.zillow.com/san-francisco-ca/',
  'https://www.realtor.com/realestateandhomes-search/San-Francisco_CA',
  'https://www.redfin.com/city/17151/CA/San-Francisco',

  // Social media profiles/pages
  'https://twitter.com/OpenAI',
  'https://www.instagram.com/natgeo/',
  'https://www.facebook.com/NASA',

  // Music
  'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX',
  'https://soundcloud.com/discover',
  'https://bandcamp.com/tag/electronic',

  // Gaming
  'https://store.steampowered.com/app/1245620/ELDEN_RING/',
  'https://www.ign.com/reviews/games',
  'https://www.gamespot.com/reviews/',

  // News aggregators
  'https://news.google.com/',
  'https://flipboard.com/',
  'https://feedly.com/i/welcome',

  // Misc content
  'https://www.goodreads.com/book/show/5907.The_Hobbit',
  'https://www.rottentomatoes.com/m/the_godfather',
  'https://letterboxd.com/film/parasite-2019/',
  'https://www.pinterest.com/search/pins/?q=home%20office%20ideas',
  'https://www.flickr.com/explore',
  'https://unsplash.com/s/photos/nature',
  'https://www.pexels.com/search/nature/',
  'https://archive.org/details/texts',
];

// Our handled violations
const HANDLED_VIOLATIONS = new Set([
  // Image alt
  'image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'object-alt', 'area-alt', 'image-redundant-alt',
  // Links/buttons
  'link-name', 'button-name', 'aria-command-name', 'aria-input-field-name', 'aria-toggle-field-name',
  'aria-meter-name', 'aria-progressbar-name', 'aria-tab-name', 'aria-tooltip-name', 'aria-treeitem-name',
  'aria-dialog-name',
  // Forms
  'label', 'select-name', 'input-button-name', 'autocomplete-valid', 'form-field-multiple-labels',
  // Contrast
  'color-contrast', 'color-contrast-enhanced', 'link-in-text-block',
  // Document
  'html-has-lang', 'html-lang-valid', 'valid-lang', 'html-xml-lang-mismatch', 'document-title',
  'meta-viewport', 'meta-viewport-large', 'meta-refresh', 'meta-refresh-no-exceptions',
  // ARIA
  'aria-hidden-body', 'aria-valid-attr', 'aria-roles', 'aria-allowed-role', 'aria-deprecated-role',
  'aria-required-attr', 'aria-hidden-focus', 'presentation-role-conflict',
  'aria-prohibited-attr', 'aria-conditional-attr', 'aria-allowed-attr', 'aria-valid-attr-value', 'label-title-only',
  // Keyboard
  'tabindex', 'accesskeys', 'scrollable-region-focusable', 'frame-focusable-content',
  // Frames
  'frame-title', 'frame-title-unique',
  // Obsolete
  'blink', 'marquee',
  // IDs
  'duplicate-id', 'duplicate-id-aria', 'duplicate-id-active',
  // Text
  'empty-heading', 'empty-table-header', 'summary-name',
  // Tables
  'scope-attr-valid', 'table-duplicate-name',
  // Styling
  'avoid-inline-spacing',
  // Landmarks
  'landmark-one-main', 'bypass', 'landmark-unique', 'page-has-heading-one', 'skip-link',
  // Media
  'no-autoplay-audio', 'video-caption', 'audio-caption',
  // Additional ARIA
  'aria-braille-equivalent',
]);

const CANNOT_FIX = new Set([
  'region', 'list', 'listitem', 'definition-list', 'dlitem',
  'aria-required-children', 'aria-required-parent', 'nested-interactive',
  'heading-order', 'landmark-banner-is-top-level', 'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level', 'landmark-no-duplicate-banner', 'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main', 'landmark-complementary-is-top-level',
  'th-has-data-cells', 'td-headers-attr', 'server-side-image-map',
  'target-size', 'identical-links-same-purpose', 'css-orientation-lock',
  'focus-order-semantics', 'hidden-content', 'p-as-heading', 'td-has-header',
]);

async function testSite(browser, url) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${url}`);
  console.log('='.repeat(60));

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Inject axe-core
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.2/axe.min.js' });

    // Wait for axe to load
    await page.waitForFunction(() => typeof axe !== 'undefined', { timeout: 5000 });

    // Run axe
    const results = await page.evaluate(async () => {
      return await axe.run();
    });

    const violations = results.violations;
    console.log(`\nFound ${violations.length} violation types:\n`);

    let handled = 0;
    let cannotFix = 0;
    let unknown = 0;

    for (const v of violations) {
      const status = HANDLED_VIOLATIONS.has(v.id) ? '✓ HANDLED' :
                     CANNOT_FIX.has(v.id) ? '⊘ CANNOT FIX' : '✗ UNKNOWN';

      if (HANDLED_VIOLATIONS.has(v.id)) handled++;
      else if (CANNOT_FIX.has(v.id)) cannotFix++;
      else unknown++;

      console.log(`  ${status.padEnd(14)} ${v.id.padEnd(30)} (${v.nodes.length} elements) - ${v.impact}`);
    }

    console.log(`\nSummary:`);
    console.log(`  Handled:    ${handled}`);
    console.log(`  Cannot fix: ${cannotFix}`);
    console.log(`  Unknown:    ${unknown}`);

    if (unknown > 0) {
      console.log(`\n⚠️  Unknown violations need handlers!`);
    }

    return { url, violations: violations.length, handled, cannotFix, unknown };

  } catch (e) {
    console.log(`Error: ${e.message}`);
    return { url, error: e.message };
  } finally {
    await context.close();
  }
}

async function main() {
  console.log('AI4A11y Extension - Handler Coverage Test');
  console.log('=========================================\n');

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const url of TEST_SITES) {
    const result = await testSite(browser, url);
    results.push(result);
  }

  await browser.close();

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('OVERALL SUMMARY');
  console.log('='.repeat(60));

  let totalViolations = 0;
  let totalHandled = 0;
  let totalCannotFix = 0;
  let totalUnknown = 0;

  for (const r of results) {
    if (!r.error) {
      totalViolations += r.violations;
      totalHandled += r.handled;
      totalCannotFix += r.cannotFix;
      totalUnknown += r.unknown;
    }
  }

  console.log(`\nAcross ${results.filter(r => !r.error).length} sites:`);
  console.log(`  Total violation types: ${totalViolations}`);
  console.log(`  Handled:              ${totalHandled} (${(totalHandled/totalViolations*100).toFixed(1)}%)`);
  console.log(`  Cannot fix:           ${totalCannotFix} (${(totalCannotFix/totalViolations*100).toFixed(1)}%)`);
  console.log(`  Unknown:              ${totalUnknown} (${(totalUnknown/totalViolations*100).toFixed(1)}%)`);

  if (totalUnknown > 0) {
    console.log(`\n⚠️  Add handlers for unknown violations!`);
  } else {
    console.log(`\n✓ All violations are handled or intentionally skipped!`);
  }
}

main().catch(console.error);
