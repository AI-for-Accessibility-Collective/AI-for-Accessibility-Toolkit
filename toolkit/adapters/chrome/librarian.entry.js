// esbuild entry → built to personalized-extension/extension/lib/librarian.js
// (classic IIFE). Constructs the Librarian against chrome-backed ports +
// the already-loaded globalThis.Datastore / globalThis.AA_TAXONOMY, and
// assigns globalThis.Librarian. Gemini is injected afterwards by background.js
// via globalThis.Librarian.setGeminiCaller(fn) (unchanged seam).
//
// Guarded so a re-import is a no-op — matching the original's "install the
// alarms once" behaviour (alarm registration happens inside createLibrarian).
import { createLibrarian } from '../../core/librarian.js';
import { chromeClock, chromeScheduler, chromeConsent, chromeDemo } from './ports.js';

if (!globalThis.Librarian) {
  globalThis.Librarian = createLibrarian({
    datastore: globalThis.Datastore,
    taxonomy: globalThis.AA_TAXONOMY,
    clock: chromeClock(),
    scheduler: chromeScheduler(),
    consent: chromeConsent(),
    demo: chromeDemo(),
  });
}
