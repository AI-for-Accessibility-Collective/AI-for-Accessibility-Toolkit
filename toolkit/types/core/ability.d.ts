/**
 * @typedef {'floor'|'preference'|'hint'} NeedStrength
 * @typedef {'ratio'|'em'|'percent'|'boolean'|'enum'} NeedUnit
 */
/**
 * @typedef {Object} Need
 * One modality-neutral need. `value` is read per dimension by each surface (a
 * number for textSize, a boolean for reduceMotion, a variant string for
 * contrast), so it stays `unknown` here and every reader narrows it.
 * @property {string} dimension
 * @property {unknown} value
 * @property {NeedStrength} strength
 * @property {NeedUnit} [unit]
 * @property {number} [confidence]
 * @property {string} [source]
 */
/**
 * @typedef {Object} ProfileRecord
 * The stored ability profile (`mine.profile`), as far as the pure helpers read
 * it. Every field is optional because a stored record can predate any of them.
 * @property {string[]} [supportAreas]
 * @property {string} [freeText]
 * @property {{ language?: string, sharing?: string } & Record<string, unknown>} [metaPreferences]
 * @property {{ needs?: unknown[], readingLevel?: string|null, confidence?: number|null } & Record<string, unknown>} [fields]
 * @property {number|null} [updatedAt]
 */
/**
 * @typedef {Object} AbilityModel
 * The modality-neutral view `librarian.getAbilityModel()` returns.
 * @property {number} schemaVersion
 * @property {string[]} supportAreas
 * @property {string} freeText
 * @property {string} language
 * @property {string|null} readingLevel
 * @property {number|null} confidence
 * @property {Need[]} needs
 */
/**
 * Canonicalize one raw need. Anything that is not an object with a
 * `dimension` comes back null.
 * @param {any} n
 * @returns {Need|null}
 */
export function normalizeNeed(n: any): Need | null;
/**
 * Project a stored profile into the AbilityModel view. Reads ONLY the specific
 * fresh sub-keys (fields.needs / fields.readingLevel / fields.confidence) so
 * unrelated legacy data in `fields` can never leak in.
 * @param {ProfileRecord|null|undefined} profile
 * @returns {AbilityModel}
 */
export function toAbilityModel(profile: ProfileRecord | null | undefined): AbilityModel;
export default toAbilityModel;
export type NeedStrength = "floor" | "preference" | "hint";
export type NeedUnit = "ratio" | "em" | "percent" | "boolean" | "enum";
/**
 * One modality-neutral need. `value` is read per dimension by each surface (a
 * number for textSize, a boolean for reduceMotion, a variant string for
 * contrast), so it stays `unknown` here and every reader narrows it.
 */
export type Need = {
    dimension: string;
    value: unknown;
    strength: NeedStrength;
    unit?: NeedUnit | undefined;
    confidence?: number | undefined;
    source?: string | undefined;
};
/**
 * The stored ability profile (`mine.profile`), as far as the pure helpers read
 * it. Every field is optional because a stored record can predate any of them.
 */
export type ProfileRecord = {
    supportAreas?: string[] | undefined;
    freeText?: string | undefined;
    metaPreferences?: ({
        language?: string;
        sharing?: string;
    } & Record<string, unknown>) | undefined;
    fields?: ({
        needs?: unknown[];
        readingLevel?: string | null;
        confidence?: number | null;
    } & Record<string, unknown>) | undefined;
    updatedAt?: number | null | undefined;
};
/**
 * The modality-neutral view `librarian.getAbilityModel()` returns.
 */
export type AbilityModel = {
    schemaVersion: number;
    supportAreas: string[];
    freeText: string;
    language: string;
    readingLevel: string | null;
    confidence: number | null;
    needs: Need[];
};
//# sourceMappingURL=ability.d.ts.map