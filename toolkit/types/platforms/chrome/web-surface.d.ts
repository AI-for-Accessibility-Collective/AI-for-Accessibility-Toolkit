/**
 * Build the web surface from the host's settingsMeta (AA_TOOLS.settingsMeta).
 * Every registry key is natively representable; numeric keys additionally
 * range-check so an out-of-range cross-app value is reported, not silently
 * clamped away.
 * @param {Record<string, {type:string, range?:[number,number]}>} settingsMeta
 * @returns {ReturnType<typeof createSurfaceAdapter>}
 */
export function createWebSurface(settingsMeta?: Record<string, {
    type: string;
    range?: [number, number];
}>): ReturnType<typeof createSurfaceAdapter>;
/**
 * Derive baseline web settings from an AbilityModel. Returns
 * `{ settings, strengthByKey, unmet }`. Empty `needs[]` (every current user)
 * returns the empty triple, the inertness short-circuit. On a collision the
 * stronger need wins (ties: last need wins). `unmet` lists ability needs whose
 * dimension has NO web rendering (e.g. a cross-app dimension), that is the
 * genuine web cannot-satisfy signal. Values are left raw; the caller clamps.
 */
export function deriveWebSettings(abilityModel: any): {
    settings: Record<string, any>;
    strengthByKey: Record<string, string>;
    unmet: any[];
};
/**
 * Resolve the web surface's view of the user's preferences. Composes the
 * authoritative merge (`getEffectivePreferences`, UNCHANGED) with the derived
 * ability baseline UNDER it, then runs the result through the web
 * SurfaceAdapter for an honest cannot-satisfy verdict.
 *
 * Identity by construction: the response starts from the authoritative merge
 * VERBATIM and never drops or alters a key the merge produced, so for today's
 * empty-needs data, `settings === prefs.settings` exactly (same keys, values,
 * and order), regardless of whether a key is in the registry, a string-typed
 * numeric, etc. The derived baseline only FILLS keys the merge did NOT set (a
 * real record at any strength beats it; derived values are clamped to range).
 * `surface.unmet` reports ABILITY NEEDS the web can't render, NOT arbitrary
 * merge keys, so it is empty for every current user and the content.js
 * cannot-satisfy branch stays silent. Full strength-aware composition (a derived
 * FLOOR tightening a soft pref) is deferred until structured needs exist.
 *
 * @param {{ librarian: object, settingsMeta: object, url: string, contexts?: string[] }} args
 */
export function resolveWebPreferences({ librarian, settingsMeta, url, contexts }: {
    librarian: object;
    settingsMeta: object;
    url: string;
    contexts?: string[];
}): Promise<any>;
export namespace WEB_DERIVATION {
    function textSize(v: any): {
        fontScale: number;
    };
    function lineSpacing(v: any): {
        lineHeight: number;
    };
    function letterSpacing(v: any): {
        letterSpacing: number;
    };
    function reduceMotion(v: any): {
        motionReducer: boolean;
    };
    function darkTheme(v: any): {
        darkMode: boolean;
    };
    function captions(v: any): {
        showCaptions: boolean;
        liveCaptions: boolean;
        autoCaptions: boolean;
    };
    function simplify(v: any): {
        autoSimplify: boolean;
    };
    function contrast(v: any): {
        contrastMode: any;
    };
    function dyslexiaFont(v: any): {
        dyslexiaFont: boolean;
    };
    function readAloudRate(v: any): {
        speechRate: number;
    };
    function readAloud(v: any): {
        readAloud: boolean;
    };
    function describeImages(v: any): {
        autoDescribe: boolean;
    };
    function labelControls(v: any): {
        autoFixLabels: boolean;
    };
    function repairLandmarks(v: any): {
        fixLandmarks: boolean;
    };
    function announceUpdates(v: any): {
        announceUpdates: boolean;
    };
    function spaAnnounce(v: any): {
        spaFocus: boolean;
    };
    function skipLinks(v: any): {
        skipLinks: boolean;
    };
    function pageStructure(v: any): {
        pageOutline: boolean;
    };
    function keyboardAccess(v: any): {
        keyboardNav: boolean;
    };
}
export default createWebSurface;
import { createSurfaceAdapter } from '../../core/surface.js';
//# sourceMappingURL=web-surface.d.ts.map