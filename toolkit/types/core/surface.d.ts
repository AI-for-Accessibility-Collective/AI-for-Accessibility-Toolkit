/**
 * @typedef {Object} SurfaceSupport
 * @property {string} [unit]                         Canonical unit this surface expects for the key.
 * @property {(value:any)=>boolean} [representable]  True if this surface can render `value` as-is.
 * @property {(value:any)=>any} [degrade]            Best-effort fallback when not representable;
 *                                                   return undefined/null to give up (→ unmet).
 */
/**
 * @typedef {Object} UnmetSetting
 * @property {string} key
 * @property {any} value
 * @property {'unsupported'|'not-representable'} reason
 */
/**
 * @typedef {Object} SurfaceApplyResult
 * @property {Record<string, any>} applied     What this surface will actually render.
 * @property {UnmetSetting[]} unmet            Keys it could not render, and why.
 * @property {Record<string, any>} degradedTo  Keys whose value was lowered to a representable fallback.
 * @property {boolean} satisfied               True iff nothing was unmet (degraded still counts as met).
 */
/**
 * @param {Object} spec
 * @param {string} spec.id
 * @param {Record<string, SurfaceSupport>} spec.supports  Keys this surface can render.
 * @returns a SurfaceAdapter.
 */
export function createSurfaceAdapter(spec: {
    id: string;
    supports: Record<string, SurfaceSupport>;
}): {
    id: string;
    /** Keys this surface can render at all. */
    supportedKeys(): string[];
    /**
     * @param {Record<string, any>|null|undefined} settings  merged settings (canonical units).
     * @returns {SurfaceApplyResult}
     *   - applied: what this surface will actually render.
     *   - unmet:   [{key, value, reason: 'unsupported' | 'not-representable'}].
     *   - degradedTo: keys whose value was lowered to a representable fallback.
     *   - satisfied: true iff nothing was unmet (degraded still counts as met).
     */
    apply(settings: Record<string, any> | null | undefined): SurfaceApplyResult;
};
export default createSurfaceAdapter;
export type SurfaceSupport = {
    /**
     * Canonical unit this surface expects for the key.
     */
    unit?: string | undefined;
    /**
     * True if this surface can render `value` as-is.
     */
    representable?: ((value: any) => boolean) | undefined;
    /**
     * Best-effort fallback when not representable;
     *             return undefined/null to give up (→ unmet).
     */
    degrade?: ((value: any) => any) | undefined;
};
export type UnmetSetting = {
    key: string;
    value: any;
    reason: "unsupported" | "not-representable";
};
export type SurfaceApplyResult = {
    /**
     * What this surface will actually render.
     */
    applied: Record<string, any>;
    /**
     * Keys it could not render, and why.
     */
    unmet: UnmetSetting[];
    /**
     * Keys whose value was lowered to a representable fallback.
     */
    degradedTo: Record<string, any>;
    /**
     * True iff nothing was unmet (degraded still counts as met).
     */
    satisfied: boolean;
};
//# sourceMappingURL=surface.d.ts.map