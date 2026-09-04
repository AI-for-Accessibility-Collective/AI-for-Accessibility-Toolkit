/**
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @param {object} [sensors]
 * @param {number} [sensors.fovDegrees=90]        - headset horizontal FOV
 * @param {number} [sensors.viewingDistanceM=1.5] - typical UI panel distance
 * @returns XR rendering parameters
 */
export function renderXRSettings(model: import("../core/ability.js").AbilityModel, sensors?: {
    fovDegrees?: number | undefined;
    viewingDistanceM?: number | undefined;
}): {
    text: {
        angularSizeDeg: number;
        worldHeightM: number;
        lineSpacing: number;
        font: string;
    };
    ui: {
        maxEccentricityDeg: number;
        largeTargets: boolean;
        highContrast: boolean;
        darkEnvironmentPreferred: boolean;
    };
    captions: {
        enabled: boolean;
        placement: string;
        distanceM: number;
    };
    describeScene: boolean;
    motion: {
        reduced: boolean;
        comfortVignette: boolean;
        snapTurning: boolean;
    };
    speech: {
        rate: number;
    };
    simplifyLanguage: boolean;
};
//# sourceMappingURL=xr.d.ts.map