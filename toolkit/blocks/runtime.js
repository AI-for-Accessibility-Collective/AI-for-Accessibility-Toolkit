// The bundle the browser runtime injects before each adapter
// (extension/vendor/blocks.js, built by `npm run build:extension`). It puts
// one `createBlocks` on the USER_SCRIPT world all adapters share; the first
// copy wins, so every adapter's blocks share one live region, one voice and
// one page filter.

import { createBlocks, setPersonal } from './create.js';
import { BLOCKS_VERSION } from './names.js';

if (!globalThis.__ai4a11yBlocks) {
  Object.defineProperty(globalThis, '__ai4a11yBlocks', {
    configurable: true,
    value: Object.freeze({
      version: BLOCKS_VERSION,
      create: (options) => createBlocks({ ...options, win: globalThis }),
      setPersonal: (personal, explicit) => setPersonal(globalThis, personal, explicit),
    }),
  });
}
