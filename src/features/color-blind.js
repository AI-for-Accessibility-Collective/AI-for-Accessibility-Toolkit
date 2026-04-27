// Color Blind Mode - applies color correction filters
import { announce } from '../utils/messaging.js';

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
        filter: ${this.filters[mode]} !important;
      }
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

window.__ai4a11yColorBlindMode = ColorBlindMode;
