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

/**
 * @param {object} [options]
 * @param {Window} [options.win]  the window the blocks work in
 * @param {string} [options.adapter]  the adapter's id, for element ids
 * @param {object} [options.personal]  the person's settings (personalFromProfile)
 * @param {(request: {kind: 'text'|'vision', task: string, input: string, options: object, image?: object, rect?: object}) => Promise<{text: string|null, reason?: string}>} [options.ai]
 *   runs the model: builds the prompt (ai/prompts.js), calls it and gates the answer. Without it, every AI call is null.
 * @param {(el: Element) => Promise<{mimeType: string, data: string}|null>} [options.capture]  an image of an element; by default what the page can draw itself
 */
export function createBlocks({ win = globalThis, adapter = 'adapter', personal = {}, ai = null, capture } = {}) {
  if (!win || !win.document) throw new Error('createBlocks needs a window with a document.');
  const env = {
    win, doc: win.document, shared: sharedState(win), adapter,
    personal: Object.freeze({ ...(personal || {}) }),
    transport: { ai: typeof ai === 'function' ? ai : null },
    capture: typeof capture === 'function' ? capture : (el) => captureInPage(el, win),
  };
  env.page = pageBlock(env);
  env.announce = announcer(env);
  watchInput(env);
  return Object.freeze({
    session: (config) => createSession(env, config),
    page: env.page,
    personal: env.personal,
    blocks: BLOCK_NAMES,
    version: BLOCKS_VERSION,
  });
}
