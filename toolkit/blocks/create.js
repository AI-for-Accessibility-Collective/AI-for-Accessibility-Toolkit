// createBlocks: the blocks for one adapter in one window. index.js is the
// package's entry; this file stays free of the documentation (catalog.js),
// so the bundle the browser runtime injects is small.

import { sharedState } from './shared.js';
import { createSession } from './session.js';
import { pageBlock } from './page.js';
import { announcer } from './announce.js';
import { watchInput } from './watch.js';
import { captureInPage } from './ai.js';
import { BLOCK_NAMES, BLOCKS_VERSION } from './names.js';
import { personalForSite } from './personal-sites.js';

const EMPTY = Object.freeze({});

/**
 * The person's settings for every adapter in this page, as of now: from the
 * runtime before its adapters run, and again when they change (a setting
 * saved in another tab, a profile edited in the console), without turning
 * the adapters off and on. Adapters that follow changes use profile.onChange
 * or watch.prefs. A change the person made in this page that the new
 * settings now carry is no longer kept apart.
 */
export function setPersonal(win, personal, explicit) {
  const shared = sharedState(win);
  const before = shared.personalBase ? personalForSite(shared.personalBase, { general: shared.personalOverrides || {} }, '') : {};
  const base = Object.freeze(explicit ? personalForSite(personal, explicit, win.location && win.location.hostname) : { ...(personal || {}) });
  shared.personalBase = base;
  if (shared.personalOverrides) {
    const left = Object.fromEntries(Object.entries(shared.personalOverrides).filter(([k, v]) => base[k] !== v && !(base[k] === undefined && (v === false || v === 'none'))));
    shared.personalOverrides = Object.keys(left).length ? left : undefined;
  }
  const after = personalForSite(base, { general: shared.personalOverrides || {} }, '');
  const changed = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[k] !== after[k]) changed[k] = after[k];
  if (Object.keys(changed).length && shared.personalListeners) {
    for (const fn of [...shared.personalListeners]) { try { fn(after, changed); } catch { /* one listener's error */ } }
  }
}

/**
 * @param {object} [options]
 * @param {Window} [options.win]  the window the blocks work in
 * @param {string} [options.adapter]  the adapter's id, for element ids
 * @param {object} [options.personal]  the person's settings (personalFromProfile), for the whole page; leave it out where the runtime sets them (setPersonal)
 * @param {{general?: object, sites?: object}} [options.explicit]  what they set themselves (explicitFromMemories); this page's site is picked
 * @param {(request: {kind: 'text'|'vision', task: string, input: string, options: object, image?: object, rect?: object}) => Promise<{text: string|null, reason?: string}>} [options.ai]
 *   runs the model: builds the prompt (ai/prompts.js), calls it and gates the answer. Without it, every AI call is null.
 * @param {(el: Element) => Promise<{mimeType: string, data: string}|null>} [options.capture]  an image of an element; by default what the page can draw itself
 * @param {(request: {op: 'set', changes: object, scope: 'site'|'all'}) => Promise<{saved: boolean, reason?: string}>} [options.profile]
 *   records a setting the person chose (profile.set). Without it, a change applies in the page only.
 * @param {(request: {op: 'get'|'set'|'restore', factor?: number}) => Promise<{ok?: boolean, factor?: number}>} [options.zoom]
 *   the browser's zoom for this tab. Without it, zoom.supported is false.
 * @param {(request: {text: string, speechRate: number, pitch: number, lang: string, voice: string|null}, onEvent: (e: {type: string, charIndex?: number, length?: number}) => void) => {stop(): void, pause(): void, resume(): void}} [options.speak]
 *   the host's speech (the extension's chrome.tts). Without it, speech.say uses the page's speechSynthesis.
 */
export function createBlocks({ win = globalThis, adapter = 'adapter', personal, explicit = null, ai = null, capture, profile = null, zoom = null, speak = null } = {}) {
  if (!win || !win.document) throw new Error('createBlocks needs a window with a document.');
  const shared = sharedState(win);
  const fn = (f) => (typeof f === 'function' ? f : null);
  const env = {
    win, doc: win.document, shared, adapter,
    transport: { ai: fn(ai), profile: fn(profile), zoom: fn(zoom), speak: fn(speak) },
    capture: typeof capture === 'function' ? capture : (el) => captureInPage(el, win),
  };
  // The person's settings are page-wide: given here, or by the runtime
  // (setPersonal) before its adapters run and again when they change.
  if (personal !== undefined || explicit) setPersonal(win, personal, explicit);
  // The person's settings here: those, with what they changed in this page
  // since (profile.set).
  let seenBase, seenOverrides, current = Object.freeze({});
  Object.defineProperty(env, 'personal', {
    enumerable: true,
    get() {
      const b = shared.personalBase || EMPTY;
      const o = shared.personalOverrides;
      if (b !== seenBase || o !== seenOverrides) {
        seenBase = b; seenOverrides = o;
        current = Object.freeze(o ? personalForSite(b, { general: o }, '') : b);
      }
      return current;
    },
  });
  env.page = pageBlock(env);
  env.announce = announcer(env);
  watchInput(env);
  return Object.freeze({
    session: (config) => createSession(env, config),
    page: env.page,
    get personal() { return env.personal; },
    blocks: BLOCK_NAMES,
    version: BLOCKS_VERSION,
  });
}
