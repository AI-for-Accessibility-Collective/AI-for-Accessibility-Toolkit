// Unit tests for tools/adapters/generate-labels.js
// Run: node tools/test/generate-labels-test.js
import { JSDOM } from 'jsdom';
import {
  isJunkName,
  isValidLabel,
  generateLinkLabel,
  generateButtonLabel,
  generateIframeTitle,
  generateFormLabel,
  axeHandlers
} from '../adapters/generate-labels.js';
import { setAIProvider } from '../utils/ai.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL:', name, extra === undefined ? '' : extra);
  }
}

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0 };
  };
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

// Set mock AI provider
setAIProvider({
  inferLabel: async ({ elementType }) => elementType === 'link' ? 'AI Link Label' : 'AI Button Label'
});

async function run() {
  // ── isJunkName ─────────────────────────────────────────────────────────────
  check('isJunkName: empty or null names are junk', isJunkName('') && isJunkName(null) && isJunkName(undefined));
  check('isJunkName: single-letter query/search parameters are junk', isJunkName('q') && isJunkName('s'));
  check('isJunkName: CSRF tokens and internal IDs are junk', isJunkName('token') && isJunkName('csrf_token') && isJunkName('id'));
  check('isJunkName: meaningful form names are not junk', !isJunkName('email') && !isJunkName('postalCode') && !isJunkName('firstName'));

  // ── isValidLabel ───────────────────────────────────────────────────────────
  check('isValidLabel: valid concise text passes', isValidLabel('Search catalog'));
  check('isValidLabel: empty or non-string rejected', !isValidLabel('') && !isValidLabel(null) && !isValidLabel(123));
  check('isValidLabel: text with newline rejected', !isValidLabel('Line 1\nLine 2'));
  check('isValidLabel: text over 60 chars rejected', !isValidLabel('A'.repeat(61)));
  check('isValidLabel: AI refusal phrases rejected', !isValidLabel('I cannot determine this label') && !isValidLabel('sorry, no idea'));

  // ── generateButtonLabel ────────────────────────────────────────────────────
  {
    const doc = mount('<button type="button" class="icon-btn btn-close"></button>');
    const btn = doc.querySelector('button');
    const label = await generateButtonLabel(btn);
    check('button: pattern matches btn-close to Close', label === 'Close' && btn.getAttribute('aria-label') === 'Close');
    check('button: marked as done', btn.dataset.ai4a11yProcessed === 'done');
  }

  {
    // SVG role="button" should not throw when reading className
    const doc = mount('<svg role="button" class="btn-close" width="24" height="24"></svg>');
    const svg = doc.querySelector('svg');
    let threw = false;
    let label = null;
    try {
      label = await generateButtonLabel(svg);
    } catch {
      threw = true;
    }
    check('button: SVG role=button does not throw and infers label from class', !threw && label === 'Close');
  }

  {
    const doc = mount('<button type="button" class="custom-action"></button>');
    const btn = doc.querySelector('button');
    const label = await generateButtonLabel(btn);
    check('button: non-pattern button falls back to AI inference', label === 'AI Button Label' && btn.getAttribute('aria-label') === 'AI Button Label');
  }

  {
    const doc = mount('<button type="button">Already Named</button>');
    const btn = doc.querySelector('button');
    const label = await generateButtonLabel(btn);
    check('button: already named button is untouched', label === null && !btn.hasAttribute('aria-label'));
  }

  // ── generateLinkLabel ──────────────────────────────────────────────────────
  {
    const doc = mount('<a href="/checkout" class="cart-icon"></a>');
    const link = doc.querySelector('a');
    const label = await generateLinkLabel(link);
    check('link: empty link receives AI generated label', label === 'AI Link Label' && link.getAttribute('aria-label') === 'AI Link Label');
  }

  {
    const doc = mount('<a href="/home">Home Page</a>');
    const link = doc.querySelector('a');
    const label = await generateLinkLabel(link);
    check('link: link with existing content is untouched', label === null && !link.hasAttribute('aria-label'));
  }

  // ── generateIframeTitle ────────────────────────────────────────────────────
  {
    const doc = mount('<iframe src="https://maps.google.com/embed?q=loc"></iframe>');
    const iframe = doc.querySelector('iframe');
    const title = await generateIframeTitle(iframe);
    check('iframe: pattern matches Google Maps', title === 'Google Maps' && iframe.getAttribute('title') === 'Google Maps');
  }

  {
    const doc = mount('<iframe src="https://player.vimeo.com/video/123"></iframe>');
    const iframe = doc.querySelector('iframe');
    const title = await generateIframeTitle(iframe);
    check('iframe: pattern matches Vimeo video', title === 'Vimeo video' && iframe.getAttribute('title') === 'Vimeo video');
  }

  {
    const doc = mount('<iframe src="https://cdn.example.org/embed/widget"></iframe>');
    const iframe = doc.querySelector('iframe');
    const title = await generateIframeTitle(iframe);
    check('iframe: hostname extracted as fallback', title === 'Embedded content from cdn.example.org' && iframe.getAttribute('title') === 'Embedded content from cdn.example.org');
  }

  {
    const doc = mount('<iframe src="about:blank"></iframe>');
    const iframe = doc.querySelector('iframe');
    const title = await generateIframeTitle(iframe);
    check('iframe: about:blank produces "Embedded content" without trailing space', title === 'Embedded content' && iframe.getAttribute('title') === 'Embedded content');
  }

  {
    const doc = mount('<iframe src="https://example.com" title="Existing Frame Title"></iframe>');
    const iframe = doc.querySelector('iframe');
    const title = await generateIframeTitle(iframe);
    check('iframe: already titled iframe is untouched', title === null && iframe.getAttribute('title') === 'Existing Frame Title');
  }

  // ── generateFormLabel ──────────────────────────────────────────────────────
  {
    const doc = mount('<input type="text" placeholder="Search products">');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: input placeholder used as aria-label', label === 'Search products' && input.getAttribute('aria-label') === 'Search products');
  }

  {
    const doc = mount('<input type="text" name="user_billing_address">');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: input snake_case name formatted as label', label === 'user billing address' && input.getAttribute('aria-label') === 'user billing address');
  }

  {
    const doc = mount('<select name="shippingCountry"><option value="US">US</option></select>');
    const select = doc.querySelector('select');
    const label = await generateFormLabel(select);
    check('form: select camelCase name formatted as label', label === 'shipping country' && select.getAttribute('aria-label') === 'shipping country');
  }

  {
    const doc = mount('<div><span>Zip Code:</span><input type="text"></div>');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: nearby sibling text used as label', label === 'Zip Code' && input.getAttribute('aria-label') === 'Zip Code');
  }

  {
    const doc = mount('<div><button type="submit">Submit</button><input type="text"></div>');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: sibling button text is not used as input label', label === null && !input.hasAttribute('aria-label'));
  }

  {
    const doc = mount('<div><script>var x = 1;</script><input type="text"></div>');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: sibling script text is not used as input label', label === null && !input.hasAttribute('aria-label'));
  }

  {
    const doc = mount('<input type="hidden" name="token">');
    const input = doc.querySelector('input');
    const label = await generateFormLabel(input);
    check('form: hidden input is skipped', label === null && !input.hasAttribute('aria-label'));
  }

  // ── axeHandlers mapping ───────────────────────────────────────────────────
  check('axeHandlers: includes link-name', typeof axeHandlers['link-name'] === 'function');
  check('axeHandlers: includes button-name', typeof axeHandlers['button-name'] === 'function');
  check('axeHandlers: includes frame-title', typeof axeHandlers['frame-title'] === 'function');
  check('axeHandlers: includes label', typeof axeHandlers['label'] === 'function');
  check('axeHandlers: includes select-name', typeof axeHandlers['select-name'] === 'function');

  console.log(`\ngenerate-labels test: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
