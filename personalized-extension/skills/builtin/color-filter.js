import { announce } from '../../utils/ai.js';
import { registerSweep } from '../../utils/observe.js';

// LMS-daltonization correction matrices (error-redistribution method).
//
// Pipeline: sRGB → LMS (Viénot 1999 via HPE/D65) → simulate CVD → compute
// error vs original → redistribute error into visible channels → back to sRGB.
// Collapsed to a single 3×3: C = I + LMS_to_sRGB × E_redist × (I − M_sim) × sRGB_to_LMS
//
// Simulation matrices from Viénot et al. 1999 (complete dichromacy, LMS space).
// Error redistribution: [[0,0,0],[0.7,1,0],[0.7,0,1]] per type (joergdietrich/daltonize).
// Computed offline; see docs/adapter-robustness-plan.md Phase 3 for derivation.
//
// feColorMatrix row format: [R_from_R, R_from_G, R_from_B, 0, 0, ...]
// Values outside [0,1] are clamped by the SVG renderer — expected for
// hue-shifting corrections (e.g. red → reddish-purple to distinguish from green).
const CORRECTION_FILTERS = [
  // Protanopia (L-cone deficiency): red shifts toward blue/purple, green keeps hue.
  // Protanopes can distinguish blue/yellow but not red/green; this makes reds
  // distinguishable from greens by encoding the red-green error in the blue channel.
  {
    id: 'ai4a11y-protanopia-filter',
    values: '0.894199 0.105801 0 0 0  -0.457456 1.457453 -0.000001 0 0  5.29178 -5.291746 1.000007 0 0  0 0 0 1 0'
  },
  // Deuteranopia (M-cone deficiency): similar redistribution for green-blind users.
  {
    id: 'ai4a11y-deuteranopia-filter',
    values: '0.250147 0.749856 0.000001 0 0  0.469881 0.530117 0 0 0  -2.629482 2.629491 1.000002 0 0  0 0 0 1 0'
  },
  // Tritanopia (S-cone deficiency): blue-yellow deficiency; smaller correction needed.
  {
    id: 'ai4a11y-tritanopia-filter',
    values: '0.849386 0.150616 0 0 0  0.133021 0.866977 0 0 0  -0.013636 0.013636 1 0 0  0 0 0 1 0'
  }
];

export const ColorFilter = {
  styleId: 'ai4a11y-color-blind-styles',
  filterId: 'ai4a11y-svg-filters',
  enabled: false,
  currentMode: 'none',
  _unwatchSweep: null,

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

    // Anchor SVG defs on <html> so they survive body re-renders (SPAs that
    // wholesale replace document.body would remove body-anchored filters).
    this._injectSvgFilters();

    document.getElementById(this.styleId)?.remove();
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      html {
        filter: ${this.filters[mode]} !important;
      }
    `;
    document.head.appendChild(style);

    // Re-inject the SVG filter defs if a body replacement removes them.
    if (this._unwatchSweep) this._unwatchSweep();
    this._unwatchSweep = registerSweep('color-filter', () => {
      if (this.enabled && !document.getElementById(this.filterId)) {
        this._injectSvgFilters();
      }
    });

    console.log('[AI4A11y] Color Blind Mode correction enabled:', mode);
    announce(`Color vision correction applied: ${mode}`);
  },

  disable() {
    this.enabled = false;
    this.currentMode = 'none';
    document.getElementById(this.styleId)?.remove();
    document.getElementById(this.filterId)?.remove();
    if (this._unwatchSweep) { this._unwatchSweep(); this._unwatchSweep = null; }
    console.log('[AI4A11y] Color Blind Mode disabled');
    announce('Color vision correction removed');
  },

  _injectSvgFilters() {
    if (document.getElementById(this.filterId)) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = this.filterId;
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    svg.setAttribute('aria-hidden', 'true');

    for (const f of CORRECTION_FILTERS) {
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.id = f.id;
      const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', f.values);
      filter.appendChild(matrix);
      svg.appendChild(filter);
    }

    // Anchor on documentElement (survives body re-renders).
    document.documentElement.appendChild(svg);
  },

  setMode(mode) {
    if (mode === 'none') {
      this.disable();
    } else {
      this.enable(mode);
    }
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

window.__ai4a11yColorBlindMode = ColorFilter;

// Exported for unit tests.
export { CORRECTION_FILTERS };
