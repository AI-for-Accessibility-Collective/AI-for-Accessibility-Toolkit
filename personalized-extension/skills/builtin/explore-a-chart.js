// Explore a Chart — the top BLV keystone. A chart rendered to <canvas>, inline
// SVG, or a bitmap is a black box to a screen reader: at best one line of alt
// text, at worst nothing. This adapter pulls the chart's underlying data OUT —
// vision reads a capture of the chart, and the numbers come back as a real,
// navigable HTML <table> (caption, column headers, row headers) the user can
// walk cell by cell. Each detected chart gets a "View data table" button;
// Alt+T runs it on the focused or last-hovered chart.
//
// Reversible: the injected buttons, the panel, the live region, the style, and
// every document listener are removed on disable.
import { extractChartData, announce } from '../../utils/ai.js';
import { imageToDataUrl } from '../../utils/image.js';
import { injectStyle } from './_primitives.js';

const CHART_HINT = /chart|graph|plot|diagram/i;
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MAX_CHARTS = 20;   // a dashboard with 200 sparklines should not get 200 buttons
const MAX_ROWS = 200;    // never let a runaway model answer freeze the panel

export const ExploreAChart = {
  styleId: 'ai4a11y-chart-styles',
  enabled: false,
  panel: null,
  live: null,
  charts: [],
  buttons: [],
  lastHover: null,
  _reqSeq: 0,
  _keyHandler: null,
  _moveHandler: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    injectStyle(this.styleId, `
      .ai4a11y-chart-btn {
        display: inline-block; margin: 4px 0; padding: 4px 10px;
        background: #1a73e8; color: #fff; border: none; border-radius: 6px;
        font: 13px/1.4 system-ui, sans-serif; cursor: pointer;
      }
      .ai4a11y-chart-btn:focus-visible { outline: 3px solid #8ab4f8; outline-offset: 2px; }
      #ai4a11y-chart-panel {
        position: fixed; bottom: 16px; right: 16px; max-width: 480px; max-height: 70vh;
        overflow: auto; z-index: 2147483647;
        background: #10141a; color: #f2f5f9; border: 2px solid #1a73e8; border-radius: 10px;
        padding: 12px 14px; font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
      }
      #ai4a11y-chart-panel h2 { font-size: 13px; margin: 0 0 6px; color: #8ab4f8; text-transform: uppercase; letter-spacing: .04em; }
      #ai4a11y-chart-panel .ai4a11y-chart-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #f2f5f9; font-size: 18px; cursor: pointer; }
      #ai4a11y-chart-panel table { border-collapse: collapse; width: 100%; margin-top: 4px; }
      #ai4a11y-chart-panel caption { text-align: left; font-weight: 600; margin-bottom: 6px; }
      #ai4a11y-chart-panel th, #ai4a11y-chart-panel td { border: 1px solid #3c4043; padding: 4px 8px; text-align: left; }
      #ai4a11y-chart-panel thead th { color: #8ab4f8; }
    `);

    // Screen-reader announcement channel (visually hidden, polite).
    this.live = document.createElement('div');
    this.live.id = 'ai4a11y-chart-live';
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    (document.body || document.documentElement).appendChild(this.live);

    this.charts = this.findCharts();
    for (const chart of this.charts) this.attachButton(chart);

    // Alt+T extracts the focused (or last-hovered) chart — the keyboard path.
    this._keyHandler = (e) => {
      // e.code (physical key), not e.key: on macOS Option+T composes '†', so
      // e.key === 't' never matches while Alt is held — the same trap
      // describe-on-demand hit with Alt+D.
      if (e.altKey && e.code === 'KeyT') { e.preventDefault(); this.open(this.target()); }
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this._keyHandler, true);

    // Track the last-hovered element so the keyboard path has a target even
    // when nothing is focused.
    this._moveHandler = (e) => { this.lastHover = e.target; };
    document.addEventListener('mouseover', this._moveHandler, true);

    announce(`Explore a chart ready. ${this.charts.length} chart${this.charts.length === 1 ? '' : 's'} found. Tab to a View data table button, or press Alt plus T on a chart.`);
  },

  // Chart candidates: anything that renders data visually but exposes no text.
  findCharts() {
    const seen = new Set();
    const out = [];
    const push = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
    document.querySelectorAll('canvas').forEach(push);
    document.querySelectorAll('svg[role="img"]').forEach(push);
    // An inline SVG with <text> nodes (axis labels, a legend) is almost always a chart.
    document.querySelectorAll('svg').forEach((s) => { if (s.querySelector('text')) push(s); });
    document.querySelectorAll('img').forEach((img) => {
      if (CHART_HINT.test(`${img.getAttribute('alt') || ''} ${img.getAttribute('src') || ''}`)) push(img);
    });
    document.querySelectorAll('[role="img"]').forEach(push);
    return out.slice(0, MAX_CHARTS);
  },

  attachButton(chart) {
    const parent = chart.parentElement;
    // An HTML button doesn't render inside a foreign (SVG/MathML) parent — a
    // chart nested that deep is covered by its outermost <svg>'s button.
    if (!parent || (parent.namespaceURI && parent.namespaceURI !== HTML_NS)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai4a11y-chart-btn';
    btn.textContent = 'View data table';
    const hint = this.contextText(chart);
    btn.setAttribute('aria-label', hint ? `View data table for chart: ${hint}` : 'View data table for this chart');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.open(chart); });
    chart.insertAdjacentElement('afterend', btn);
    this.buttons.push(btn);
  },

  target() {
    return this.chartFor(document.activeElement) || this.chartFor(this.lastHover);
  },

  // The tracked chart that el is (or is inside of), walking up the tree.
  chartFor(el) {
    while (el && el.nodeType === 1) {
      if (this.charts.includes(el)) return el;
      el = el.parentElement;
    }
    return null;
  },

  async open(chart) {
    if (!chart) {
      this.showMessage('No chart selected. Tab to a "View data table" button, or hover a chart and press Alt+T.');
      return;
    }
    const token = ++this._reqSeq; // a slow answer for an earlier chart must
                                  // not overwrite the answer for a newer one.
    this.showMessage('Reading chart data…');
    let data = null, errMsg = null;
    try {
      const dataUrl = await this.capture(chart);
      data = dataUrl ? await extractChartData(dataUrl, this.contextText(chart)) : null;
    } catch (e) { data = null; errMsg = (e && e.message) ? e.message : null; }
    if (token !== this._reqSeq || !this.enabled) return; // superseded, or disabled mid-flight
    if (data && Array.isArray(data.headers) && Array.isArray(data.rows)) {
      this.showTable(data);
    } else {
      // Prefer the provider's real reason (e.g. a missing API key) when there is one.
      this.showMessage(errMsg || "Couldn't read this chart's data. Check that your AI key is set in the extension settings.");
    }
  },

  // A data URL of the chart's pixels, whatever it is rendered with.
  async capture(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'canvas' && typeof el.toDataURL === 'function') {
      try { return el.toDataURL(); } catch { return null; } // tainted canvas
    }
    if (tag === 'svg') {
      try {
        const str = new XMLSerializer().serializeToString(el);
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(str)));
      } catch { return null; }
    }
    if (tag === 'img') return imageToDataUrl(el);
    // A [role="img"] wrapper: capture the visual element inside it.
    const inner = el.querySelector && el.querySelector('canvas, svg, img');
    return inner ? this.capture(inner) : null;
  },

  // Nearby text that anchors the extraction — the chart's label/alt/title plus
  // any <figcaption> — so the model knows what it is looking at.
  contextText(el) {
    const bits = [];
    const attr = (n) => (el.getAttribute && el.getAttribute(n)) || '';
    if (attr('aria-label')) bits.push(attr('aria-label'));
    if (attr('alt')) bits.push(attr('alt'));
    if (attr('title')) bits.push(attr('title'));
    const cap = el.closest && el.closest('figure')?.querySelector('figcaption');
    if (cap && cap.textContent.trim()) bits.push(cap.textContent.replace(/\s+/g, ' ').trim());
    return bits.join(' — ').slice(0, 300);
  },

  ensurePanel() {
    if (this.panel) return;
    this.panel = document.createElement('div');
    this.panel.id = 'ai4a11y-chart-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Chart data table');
    const close = document.createElement('button');
    close.className = 'ai4a11y-chart-close';
    close.setAttribute('aria-label', 'Close chart data table');
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    const h = document.createElement('h2');
    h.textContent = 'Chart data';
    const body = document.createElement('div');
    body.className = 'ai4a11y-chart-body';
    this.panel.append(close, h, body);
    (document.body || document.documentElement).appendChild(this.panel);
  },

  showMessage(text) {
    this.ensurePanel();
    const p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = text;
    this.panel.querySelector('.ai4a11y-chart-body').replaceChildren(p);
    this.panel.style.display = 'block';
    if (this.live) this.live.textContent = text;
  },

  // Model output goes in via textContent ONLY — never innerHTML.
  showTable(data) {
    this.ensurePanel();
    const caption = (typeof data.caption === 'string' && data.caption) ? data.caption : 'Chart data';
    const table = document.createElement('table');
    const cap = document.createElement('caption');
    cap.textContent = caption;
    table.appendChild(cap);
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const h of data.headers) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.textContent = String(h);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const rows = data.rows.slice(0, MAX_ROWS);
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const tr = document.createElement('tr');
      row.forEach((cell, i) => {
        // The first column doubles as the row header so a screen reader
        // announces it while the user arrows across a row.
        const c = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) c.setAttribute('scope', 'row');
        c.textContent = String(cell);
        tr.appendChild(c);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.panel.querySelector('.ai4a11y-chart-body').replaceChildren(table);
    this.panel.style.display = 'block';
    if (this.live) this.live.textContent = `${caption}. Table with ${rows.length} rows and ${data.headers.length} columns.`;
  },

  hide() {
    if (this.panel) this.panel.style.display = 'none';
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
    if (this._moveHandler) document.removeEventListener('mouseover', this._moveHandler, true);
    this._keyHandler = this._moveHandler = null;
    for (const btn of this.buttons) { try { btn.remove(); } catch { /* detached */ } }
    this.buttons = [];
    this.charts = [];
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    this.panel?.remove(); this.panel = null;
    this.live?.remove(); this.live = null;
    this.lastHover = null;
    announce('Explore a chart off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yExploreAChart = ExploreAChart;
