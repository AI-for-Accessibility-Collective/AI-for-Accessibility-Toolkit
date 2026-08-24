// esbuild entry → a Chrome host bundles this into its own lib/librarian.js
// (classic IIFE). Constructs the Librarian against chrome-backed ports +
// the already-loaded globalThis.Datastore / globalThis.AA_TAXONOMY, and
// assigns globalThis.Librarian. Gemini is injected afterwards by background.js
// via globalThis.Librarian.setGeminiCaller(fn) (unchanged seam).
//
// Guarded so a re-import is a no-op — matching the original's "install the
// alarms once" behaviour (alarm registration happens inside createLibrarian).
//
// Also assigns globalThis.Grants: the cross-app grants module's audience-
// ceiling + audit-trail helpers (toolkit/sync/grants.js). Enforcement and
// audit writes now live IN core/librarian.js itself (requestGrant's accept
// path, revokeGrant, exportAbilityModel, the cross-app-insight accept path),
// so background.js's grant routes are thin pass-throughs and don't need
// these directly anymore — only the read-only librarianShareAudit route
// (getShareAudit) still reaches for this bridge. Bundled here (not a
// separate entry) since core/librarian.js already imports grants.js — this
// just re-exposes what's already in the bundle.
import { createLibrarian } from '../../core/librarian.js';
import { chromeClock, chromeScheduler, chromeConsent, chromeDemo } from './ports.js';
import { AUDIENCES, audienceAllowed, recordShareAudit, getShareAudit } from '../../sync/grants.js';

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

if (!globalThis.Grants) {
  globalThis.Grants = { AUDIENCES, audienceAllowed, recordShareAudit, getShareAudit };
}
