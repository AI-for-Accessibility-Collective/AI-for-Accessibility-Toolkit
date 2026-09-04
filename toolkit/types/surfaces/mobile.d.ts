/**
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns mobile OS accessibility settings:
 *   { text: {scalePercent, lineSpacing, boldText},
 *     display: {darkMode, highContrast, reduceTransparency},
 *     motion: {reduceMotion},
 *     media: {captions},
 *     speech: {rate},
 *     simplifyLanguage,
 *     touch: {largeTargets, minTargetPt} }
 *   A neutral (empty-needs) model renders every value at its OS default:
 *   no phantom adaptations.
 */
export function renderMobileSettings(model: import("../core/ability.js").AbilityModel): {
    text: {
        scalePercent: number;
        lineSpacing: number;
        boldText: boolean;
    };
    display: {
        darkMode: boolean;
        highContrast: boolean;
        reduceTransparency: boolean;
    };
    motion: {
        reduceMotion: boolean;
    };
    media: {
        captions: boolean;
    };
    speech: {
        rate: number;
    };
    simplifyLanguage: boolean;
    touch: {
        largeTargets: boolean;
        minTargetPt: number;
    };
};
export default renderMobileSettings;
//# sourceMappingURL=mobile.d.ts.map