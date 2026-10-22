// Color Blind Mode - applies color correction filters
import { announce } from '../utils/ai.js';

// The filters used to show how a color-blind person sees the page (a
// simulation): on a store the red blanket turned green and the sage bottle
// grey, so they made colors harder to tell apart, not easier. They now
// correct instead ("daltonization"): the part of each color the person can't
// see is worked out and moved into a color they can. Reds and greens keep
// their look and differ in how blue they are, which every type of red-green
// color blindness still sees.
//
// How each type sees red, green and blue, from Machado, Oliveira and
// Fernandes (2009), full strength. One row per output channel, for colors
// in linear RGB, which is what an SVG filter works in.
const SEES = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};
// Where the lost part goes. Red-green types lose red against green, so it
// goes into blue. The usual recipe also puts some into green, but that made
// reds paler and greens darker (the red blanket came out a washed-out pink).
// Tritanopia loses blue against yellow, so it goes into red and out of
// green: the red-green difference, which tritanopia still sees.
const RED_GREEN_SHIFT = [[0, 0, 0], [0, 0, 0], [0.7, 0, 1]];
const BLUE_YELLOW_SHIFT = [[1, 0, 0.7], [0, -1, -0.7], [0, 0, 0]];
// How much of the lost part is moved. All of it turned reds magenta. Half
// keeps them red, and red and green text still look clearly further apart
// to someone with the color blindness it is set for.
const STRENGTH = 0.5;

// corrected = I + STRENGTH x shift x (I - sees). Every row adds up to 1, so
// whites, greys and blacks stay as they are.
function correctionMatrix(mode) {
  const sees = SEES[mode];
  if (!sees) return null;
  const shift = mode === 'tritanopia' ? BLUE_YELLOW_SHIFT : RED_GREEN_SHIFT;
  const lost = sees.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
  return [0, 1, 2].map(i => [0, 1, 2].map(j =>
    (i === j ? 1 : 0) + STRENGTH * shift[i].reduce((sum, w, k) => sum + w * lost[k][j], 0)));
}

// The 3x3 matrix as feColorMatrix values: 4x5, alpha left alone.
function matrixValues(m) {
  const f = v => (Math.round(v * 1e4) / 1e4).toFixed(4);
  return m.map(row => `${row.map(f).join(' ')} 0 0`).concat('0 0 0 1 0').join('\n            ');
}

// dark-mode, reduce-brightness and color-blind all filter <html>, and one
// filter declaration replaces another: with two of them on, one silently did
// nothing (dark mode + dim gave a dimmed, light page). Each sets its own
// variable instead, and the same rule in each stylesheet combines whichever
// are set, in a fixed order.
const PAGE_FILTER = 'html { filter: var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,) !important; }';

export const ColorBlindMode = {
  styleId: 'ai4a11y-color-blind-styles',
  filterId: 'ai4a11y-svg-filters',
  enabled: false,
  currentMode: 'none',

  filters: {
    protanopia: 'url(#ai4a11y-protanopia-filter)',
    deuteranopia: 'url(#ai4a11y-deuteranopia-filter)',
    tritanopia: 'url(#ai4a11y-tritanopia-filter)'
  },

  enable(mode = 'protanopia') {
    if (!this.filters[mode]) {
      console.warn('[AI4A11y] Invalid color blind mode:', mode);
      return;
    }

    this.currentMode = mode;
    this.enabled = true;
    this.injectSvgFilters();

    document.getElementById(this.styleId)?.remove();
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      html {
        --ai4a11y-filter-color: ${this.filters[mode]};
      }
      ${PAGE_FILTER}
    `;
    document.head.appendChild(style);

    console.log('[AI4A11y] Color Blind Mode enabled:', mode);
    announce(`Color blind correction applied: ${mode}`);
  },

  disable() {
    this.enabled = false;
    this.currentMode = 'none';
    document.getElementById(this.styleId)?.remove();
    document.getElementById(this.filterId)?.remove();
    console.log('[AI4A11y] Color Blind Mode disabled');
    announce('Color blind correction removed');
  },

  injectSvgFilters() {
    if (document.getElementById(this.filterId)) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = this.filterId;
    svg.setAttribute('style', 'position:absolute;width:0;height:0');
    svg.innerHTML = `
      <defs>
        ${Object.keys(SEES).map(mode => `
        <filter id="ai4a11y-${mode}-filter">
          <feColorMatrix type="matrix" values="
            ${matrixValues(correctionMatrix(mode))}
          "/>
        </filter>`).join('')}
      </defs>
    `;
    document.body.appendChild(svg);
  },

  setMode(mode) {
    if (mode === 'none') {
      this.disable();
    } else {
      this.enable(mode);
    }
  },

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
};

if (typeof window !== 'undefined') window.__ai4a11yColorBlindMode = ColorBlindMode;
