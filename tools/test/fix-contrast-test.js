// Fix Contrast — jsdom tests for fixLowContrast. The workshop store found the
// bug these cover: callers pass the element's own computed background, which
// for most text is "rgba(0, 0, 0, 0)" (the real background is an ancestor's).
// Read as a color it has no luminance, the fallback picked white, and grey
// text on a white page turned invisible. The fix must read the background
// actually behind the text and never apply a color that fails.
//
// Run: node tools/test/fix-contrast-test.js
import { JSDOM } from 'jsdom';
import { fixLowContrast } from '../adapters/fix-contrast.js';
import { getContrastRatio } from '../utils/color.js';

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra === undefined ? '' : extra); } }

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.getComputedStyle = (el) => dom.window.getComputedStyle(el);
  return dom.window.document;
}

async function run() {
  // Grey text in a transparent box on a white card, background passed as transparent.
  {
    const doc = mount('<div style="background-color: rgb(255, 255, 255)"><span id="t" style="color: rgb(187, 187, 187)">Ships from</span></div>');
    const el = doc.getElementById('t');
    const color = await fixLowContrast(el, 'rgb(187, 187, 187)', 'rgba(0, 0, 0, 0)');
    const ratio = getContrastRatio(el.style.color, 'rgb(255, 255, 255)');
    check('contrast: a transparent background is resolved to the white behind it', ratio >= 4.5, { color, ratio });
    check('contrast: grey text on white is darkened, not turned white', el.style.color !== 'rgb(255, 255, 255)' && color !== '#ffffff', color);
  }

  // Same text on a dark band: the fix goes light, and still passes.
  {
    const doc = mount('<div style="background-color: rgb(32, 32, 32)"><span id="t" style="color: rgb(80, 80, 80)">Deal</span></div>');
    const el = doc.getElementById('t');
    await fixLowContrast(el, 'rgb(80, 80, 80)', 'rgba(0, 0, 0, 0)');
    const ratio = getContrastRatio(el.style.color, 'rgb(32, 32, 32)');
    check('contrast: on a dark ancestor the fixed color passes against it', ratio >= 4.5, { color: el.style.color, ratio });
  }

  // No background anywhere: the page default is white.
  {
    const doc = mount('<p id="t" style="color: rgb(200, 200, 200)">fine print</p>');
    const el = doc.getElementById('t');
    await fixLowContrast(el, 'rgb(200, 200, 200)', undefined);
    check('contrast: with no background anywhere the text passes against white', getContrastRatio(el.style.color, 'rgb(255, 255, 255)') >= 4.5, el.style.color);
  }
}

run().then(() => {
  console.log(`\nfix-contrast: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
