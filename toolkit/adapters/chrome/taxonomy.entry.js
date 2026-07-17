// Chrome adapter — taxonomy. Bundled by personalized-extension/build.js to
// extension/lib/taxonomy.js (classic script). Assigns globalThis.AA_TAXONOMY
// exactly as the pre-toolkit file did, so background.js (importScripts) and
// extension pages (script tags) are unchanged.
import { TAXONOMY } from '../../core/taxonomy.js';

globalThis.AA_TAXONOMY = TAXONOMY;
