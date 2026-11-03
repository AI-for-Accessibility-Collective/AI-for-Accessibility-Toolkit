// The person's settings on one site, from what the toolkit derived from their
// profile and what they set themselves (personal.js has the whole story).
// Pure and free of the profile's derivation, so the blocks bundle the browser
// runtime injects stays small.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** What each personal key means, for the docs. */
export const PERSONAL_KEYS = Object.freeze({
  speechRate: 'Speaking rate, 0.5-2. speech.say({ speechRate }) uses the profile\'s over yours.',
  fontScale: 'Text size in percent, 100-200. Tooltips and panels scale their text by it (their `fontScale`).',
  textSizeMethod: "'zoom' (the browser's zoom) or 'font' (the text size only): how the person wants text made bigger. Unset: your default.",
  lineHeight: 'Line spacing, 1-3 (times the font size).',
  letterSpacing: 'Letter spacing in em, 0-0.5.',
  targetSize: 'Smallest size of a clickable control, in CSS pixels, 24-64.',
  motionReducer: 'true when the profile asks for reduced motion. Bands and scrolling stop animating, as with the system setting.',
  contrastMode: "'light' or 'yellow-black' when the profile asks for more contrast; 'none' when the person turned it off.",
  darkMode: 'true when the profile asks for a dark theme.',
  readingLevel: "'plain', 'easy-read' or a grade 1-12 (the profile's reading level, or plain language). ai.text({ readingLevel }) uses the profile's over yours.",
});

/** The personal keys an adapter may record for the person (profile.set): the ones that are settings. */
export const SETTABLE_KEYS = Object.freeze(['speechRate', 'fontScale', 'textSizeMethod', 'lineHeight', 'letterSpacing', 'targetSize', 'motionReducer', 'contrastMode', 'darkMode']);

/**
 * Settings-vocabulary values as personal values: in range, of the right
 * type, and only what is actually asked for (false and 'none' are "not
 * asked for", except where an explicit false must win, see keepOff).
 * @param {object} settings
 * @param {{keepOff?: boolean}} [opts]  keep explicit off values (false, 'none'), so they override the needs
 */
export function personalFromSettings(settings, { keepOff = false } = {}) {
  const s = settings || {};
  const out = {};
  if (s.speechRate !== undefined && s.speechRate !== null && Number.isFinite(Number(s.speechRate))) out.speechRate = clamp(Number(s.speechRate), 0.5, 2);
  if (s.fontScale !== undefined && s.fontScale !== null && Number.isFinite(Number(s.fontScale))) out.fontScale = clamp(Math.round(Number(s.fontScale)), 100, 200);
  if (s.textSizeMethod === 'zoom' || s.textSizeMethod === 'font') out.textSizeMethod = s.textSizeMethod;
  const num = (k, lo, hi, round) => {
    if (s[k] === undefined || s[k] === null || !Number.isFinite(Number(s[k]))) return;
    const v = clamp(Number(s[k]), lo, hi);
    out[k] = round ? Math.round(v) : Math.round(v * 100) / 100;
  };
  num('lineHeight', 1, 3);
  num('letterSpacing', 0, 0.5);
  num('targetSize', 24, 64, true);
  for (const k of ['motionReducer', 'darkMode']) {
    if (s[k] === true) out[k] = true;
    else if (keepOff && s[k] === false) out[k] = false;
  }
  if (typeof s.contrastMode === 'string') {
    if (s.contrastMode !== 'none') out.contrastMode = s.contrastMode;
    else if (keepOff) out.contrastMode = 'none';
  }
  return out;
}

/** A site as the Librarian names it in an `origin:` scope: the hostname, lower-case, without "www.". */
export function siteOf(hostOrUrl) {
  let host = String(hostOrUrl || '');
  try { if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) host = new URL(host).hostname; } catch { /* a hostname already */ }
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * What the person set themselves, from listMemories: the active
 * "user-explicit" setting records, for every site (`general`) and per site.
 * @param {Array<object>} memories
 * @returns {{general: object, sites: Record<string, object>}}
 */
export function explicitFromMemories(memories) {
  const general = {};
  const sites = {};
  const at = {};
  for (const r of memories || []) {
    if (!r || r.source !== 'user-explicit' || r.status !== 'active' || !r.settings || !/^setting\./.test(r.aspect || '')) continue;
    const scope = String(r.scope || 'general');
    let target;
    if (scope === 'general') target = general;
    else if (scope.startsWith('origin:')) target = (sites[scope.slice(7)] ||= {});
    else continue; // categories and contexts are not what an adapter sets
    for (const [k, v] of Object.entries(personalFromSettings(r.settings, { keepOff: true }))) {
      // The newest record wins within a scope, as in getEffectivePreferences.
      const id = `${scope} ${k}`;
      if (at[id] !== undefined && at[id] > (r.updatedAt || 0)) continue;
      at[id] = r.updatedAt || 0;
      target[k] = v;
    }
  }
  return { general, sites };
}

/**
 * The person's settings on one site: the profile's, then what they set for
 * every site, then what they set for this one. An explicit off (false,
 * 'none') turns off what the profile asked for, and stays in the result, so
 * an adapter can tell "the person turned it off here" from "never set".
 * @param {object} personal  personalFromProfile()
 * @param {{general?: object, sites?: Record<string, object>}} explicit  explicitFromMemories()
 * @param {string} host
 */
export function personalForSite(personal, explicit, host) {
  const site = siteOf(host);
  return { ...(personal || {}), ...(explicit?.general || {}), ...((site && explicit?.sites?.[site]) || {}) };
}
