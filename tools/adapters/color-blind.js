// Color Blind Mode - applies color correction filters
import { announce } from '../utils/ai.js';

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
        <filter id="ai4a11y-protanopia-filter">
          <feColorMatrix type="matrix" values="
            0.567, 0.433, 0.000, 0, 0
            0.558, 0.442, 0.000, 0, 0
            0.000, 0.242, 0.758, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
        <filter id="ai4a11y-deuteranopia-filter">
          <feColorMatrix type="matrix" values="
            0.625, 0.375, 0.000, 0, 0
            0.700, 0.300, 0.000, 0, 0
            0.000, 0.300, 0.700, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
        <filter id="ai4a11y-tritanopia-filter">
          <feColorMatrix type="matrix" values="
            0.950, 0.050, 0.000, 0, 0
            0.000, 0.433, 0.567, 0, 0
            0.000, 0.475, 0.525, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
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
