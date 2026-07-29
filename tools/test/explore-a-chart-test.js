// Explore a Chart — jsdom test with a stub AI provider. Verifies chart
// detection + button injection, the extraction flow (canvas → data URL →
// provider), the accessible table (caption, column/row headers), the live
// region mirror, the failure fallback, and full reversal.
// Run: node tools/test/explore-a-chart-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { ExploreAChart } from '../adapters/explore-a-chart.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window; global.document = dom.window.document;
  return dom.window.document;
}
function stubAI(result) {
  const calls = { extract: [] };
  setAIProvider({
    extractChartData: async (src, ctx) => { calls.extract.push([src, ctx]); return result; },
    announce() {},
  });
  return calls;
}

async function run() {
  // Happy path: a <canvas> chart → button → provider → accessible table.
  {
    const doc = mount('<canvas id="chart" width="300" height="150" aria-label="Sales chart"></canvas><p>Some article text.</p>');
    const calls = stubAI({ caption: 'Sales by year', headers: ['Year', 'Sales'], rows: [['2020', '$2M'], ['2023', '$5M']] });
    // jsdom has no canvas backend — stub the pixel capture the flow relies on.
    doc.getElementById('chart').toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
    ExploreAChart.enable();

    const btn = doc.querySelector('.ai4a11y-chart-btn');
    check('chart: enable injects a View data table button next to a canvas chart', !!btn && btn.textContent === 'View data table');
    check('chart: enable creates a hidden live region', !!doc.getElementById('ai4a11y-chart-live'));

    btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await tick(); await tick();
    check('chart: the provider gets the canvas DATA URL plus the chart label as context', calls.extract.length === 1 && /^data:image\//.test(calls.extract[0][0]) && String(calls.extract[0][1]).includes('Sales chart'));
    const panel = doc.getElementById('ai4a11y-chart-panel');
    check('chart: a dialog panel appears', !!panel && panel.getAttribute('role') === 'dialog' && panel.style.display === 'block');
    const table = panel && panel.querySelector('table');
    check('chart: the panel renders a real table with a caption', !!table && table.querySelector('caption')?.textContent === 'Sales by year');
    const colHeads = table ? table.querySelectorAll('thead th[scope="col"]') : [];
    check('chart: two column headers with scope=col', colHeads.length === 2 && colHeads[0].textContent === 'Year' && colHeads[1].textContent === 'Sales');
    const rows = table ? table.querySelectorAll('tbody tr') : [];
    check('chart: data rows render with a row header and data cells', rows.length === 2 && rows[0].querySelector('th[scope="row"]')?.textContent === '2020' && rows[0].querySelector('td')?.textContent === '$2M' && rows[1].querySelector('td')?.textContent === '$5M');
    check('chart: the caption is mirrored to the live region', doc.getElementById('ai4a11y-chart-live').textContent.includes('Sales by year'));

    // Escape hides the panel.
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
    check('chart: Escape hides the panel', panel.style.display === 'none');

    // Alt+T on the last-hovered chart — the keyboard path.
    doc.getElementById('chart').dispatchEvent(new doc.defaultView.MouseEvent('mouseover', { bubbles: true }));
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { code: 'KeyT', key: 't', altKey: true }));
    await tick(); await tick();
    check('chart: Alt+T on the hovered chart reopens the table', calls.extract.length === 2 && panel.style.display === 'block');

    ExploreAChart.disable();
    check('chart: disable removes the button, panel, live region, and style', !doc.querySelector('.ai4a11y-chart-btn') && !doc.getElementById('ai4a11y-chart-panel') && !doc.getElementById('ai4a11y-chart-live') && !doc.getElementById('ai4a11y-chart-styles'));

    // Listeners are gone: Alt+T after disable does nothing.
    calls.extract.length = 0;
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { code: 'KeyT', key: 't', altKey: true }));
    await tick();
    check('chart: Alt+T after disable does nothing', calls.extract.length === 0 && !doc.getElementById('ai4a11y-chart-panel'));
  }

  // A null provider answer (e.g. no API key wired) shows the fallback message,
  // never a stuck "Reading chart data…" state.
  {
    const doc = mount('<canvas id="c2"></canvas>');
    stubAI(null);
    doc.getElementById('c2').toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
    ExploreAChart.enable();
    doc.querySelector('.ai4a11y-chart-btn').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await tick(); await tick();
    const panel = doc.getElementById('ai4a11y-chart-panel');
    check('chart: a null provider result shows the fallback message', !!panel && panel.textContent.includes("Couldn't read this chart's data"));
    ExploreAChart.disable();
  }

  // Idempotency + double-disable safety.
  {
    const doc = mount('<canvas></canvas>');
    stubAI(null);
    ExploreAChart.enable();
    ExploreAChart.enable();
    check('chart: idempotent enable (one button, one live region)', doc.querySelectorAll('.ai4a11y-chart-btn').length === 1 && doc.querySelectorAll('#ai4a11y-chart-live').length === 1);
    ExploreAChart.disable();
    ExploreAChart.disable();
    check('chart: double disable is safe', ExploreAChart.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
