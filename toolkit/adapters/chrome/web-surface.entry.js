// esbuild entry → built to personalized-extension/extension/lib/web-surface.js
// (classic IIFE). Exposes the web SurfaceAdapter + the abilityModel→webSettings
// derivation + the resolveWebPreferences composer as a service-worker global,
// so background.js can route the `librarianEffectivePreferences` response
// through the surface (honest cannot-satisfy) without importing ES modules.
import { createWebSurface, deriveWebSettings, resolveWebPreferences } from './web-surface.js';

globalThis.WebSurface = { createWebSurface, deriveWebSettings, resolveWebPreferences };
