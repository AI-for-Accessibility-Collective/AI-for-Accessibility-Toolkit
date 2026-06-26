// SurfaceAdapter — renders the merged, modality-agnostic settings into one
// host surface (web CSS, XR text size, ArtInsight description style) and
// reports **honestly** what it could and could not satisfy.
//
// The `cannot-satisfy` verdict is the Phase 1 honesty safeguard: a surface that
// can't represent a need must SAY so rather than silently dropping it (the
// failure mode that hurts exactly the users the toolkit exists to serve). This
// is also the seam that lets the same understanding render differently per app:
// web supports `fontScale`; XR might map it to an angular text height; a
// surface that has no rendering for a key returns it as `unmet`.
//
// Pure + dependency-free. A host builds one adapter from a `spec` and calls
// `apply(settings)` after `getEffectivePreferences`.

/**
 * @typedef {Object} SurfaceSupport
 * @property {string} [unit]                         Canonical unit this surface expects for the key.
 * @property {(value:any)=>boolean} [representable]  True if this surface can render `value` as-is.
 * @property {(value:any)=>any} [degrade]            Best-effort fallback when not representable;
 *                                                   return undefined/null to give up (→ unmet).
 */

/**
 * @param {Object} spec
 * @param {string} spec.id
 * @param {Record<string, SurfaceSupport>} spec.supports  Keys this surface can render.
 * @returns a SurfaceAdapter.
 */
export function createSurfaceAdapter(spec) {
  const id = spec.id;
  const supports = spec.supports || {};
  return {
    id,
    /** Keys this surface can render at all. */
    supportedKeys() { return Object.keys(supports); },

    /**
     * @param {Record<string, any>} settings  merged settings (canonical units).
     * @returns {{applied:Object, unmet:Array, degradedTo:Object, satisfied:boolean}}
     *   - applied: what this surface will actually render.
     *   - unmet:   [{key, value, reason: 'unsupported' | 'not-representable'}].
     *   - degradedTo: keys whose value was lowered to a representable fallback.
     *   - satisfied: true iff nothing was unmet (degraded still counts as met).
     */
    apply(settings) {
      const applied = {};
      const unmet = [];
      const degradedTo = {};
      for (const [key, value] of Object.entries(settings || {})) {
        const s = supports[key];
        if (!s) { unmet.push({ key, value, reason: 'unsupported' }); continue; }
        if (s.representable && !s.representable(value)) {
          if (s.degrade) {
            const d = s.degrade(value);
            if (d === undefined || d === null) {
              unmet.push({ key, value, reason: 'not-representable' });
              continue;
            }
            applied[key] = d;
            degradedTo[key] = d;
            continue;
          }
          unmet.push({ key, value, reason: 'not-representable' });
          continue;
        }
        applied[key] = value;
      }
      return { applied, unmet, degradedTo, satisfied: unmet.length === 0 };
    },
  };
}

export default createSurfaceAdapter;
