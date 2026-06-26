// esbuild entry → built to personalized-extension/extension/lib/taxonomy.js
// (classic IIFE). Re-exposes the portable taxonomy as the classic-script
// global the service worker (importScripts) and the popup (<script>) expect.
import { taxonomy } from '../../core/taxonomy.js';

globalThis.AA_TAXONOMY = taxonomy;
