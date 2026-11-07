/** A stand-in for Ken's toolkit-backed preference provider. */
export function createFixturePreferenceProvider(preferences = {}) {
  return { async getPreferences() { return { ...preferences }; } };
}
