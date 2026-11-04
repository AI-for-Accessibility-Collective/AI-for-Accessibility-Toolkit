import { rankOf } from '../../toolkit/index.js';

function validateTextSize(value, unit) {
  if ((unit !== undefined && unit !== 'ratio') || typeof value !== 'number' ||
      !Number.isFinite(value) || value < 0.8 || value > 2.5) {
    throw new Error('textSize must be a ratio between 0.8 and 2.5');
  }
}

// Prototype for synthetic data in a trusted, single-user host only. This direct
// Librarian access does not enforce cross-app grants, and the setter is unsafe
// if profile edits or acting-user switches can run concurrently. See the notes
// in captionflow/TOOLKIT_PREFERENCES.md before integrating with real profiles.
export function createToolkitPreferenceProvider({ librarian }) {
  return {
    async getPreferences() {
      const model = await librarian.getAbilityModel();
      let chosen;
      for (const need of model.needs) {
        if (need.dimension === 'textSize' && (!chosen || rankOf(need.strength) >= rankOf(chosen.strength))) chosen = need;
      }
      if (!chosen) return {};
      // The toolkit's neutral textSize is a multiplier; CaptionFlow accepts
      // 0.8–2.5. Refuse unsupported units or invalid values instead of guessing.
      validateTextSize(chosen.value, chosen.unit);
      return { fontScale: chosen.value };
    },
    // This is for an explicit user choice, not an inferred or AI change.
    async setTextSize({ value, unit } = {}) {
      validateTextSize(value, unit);
      const profile = await librarian.getProfile();
      const needs = profile.fields?.needs ?? [];
      if (!Array.isArray(needs)) throw new Error('profile needs must be an array');
      const retained = needs.filter(need =>
        !(need?.dimension === 'textSize' && need.source === 'captionflow-user' && need.strength !== 'floor'));
      await librarian.setProfileField('fields.needs', [
        ...retained, { dimension: 'textSize', value, unit: 'ratio', strength: 'preference', source: 'captionflow-user' },
      ]);
    },
  };
}
