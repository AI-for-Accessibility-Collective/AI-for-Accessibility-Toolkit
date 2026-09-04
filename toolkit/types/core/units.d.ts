/**
 * The canonical unit for a setting key, or null if untyped here.
 * @param {string} key
 * @returns {Unit|null}
 */
export function unitOf(key: string): Unit | null;
/**
 * @param {string} key
 * @param {any} value
 * @param {SettingsMeta|null} [meta]
 * @returns {any}
 */
export function coerceSetting(key: string, value: any, meta?: SettingsMeta | null): any;
/** Coerce every key in a settings object. Non-object input passes through.
 *  This is the INGEST normalizer: run once where untrusted/raw values enter
 *  (record writes, the LLM extract ops, the one-time migration).
 *  @param {any} settings
 *  @param {SettingsMeta|null} [meta]
 *  @returns {any} */
export function coerceSettings(settings: any, meta?: SettingsMeta | null): any;
/**
 * @param {string} key
 * @param {any} value
 * @param {SettingsMeta|null} [meta]
 * @returns {any}
 */
export function clampSetting(key: string, value: any, meta?: SettingsMeta | null): any;
/** Clamp every key in a settings object. Non-object input passes through.
 *  @param {any} settings
 *  @param {SettingsMeta|null} [meta]
 *  @returns {any} */
export function clampSettings(settings: any, meta?: SettingsMeta | null): any;
/** @typedef {'percent'|'ratio'|'em'|'boolean'|'enum'} Unit */
/**
 * @typedef {Object} SettingMeta
 * One entry of a host's `settingsMeta` (the registry's typed vocabulary for
 * one setting key).
 * @property {string} type          'number' | 'boolean' | 'enum' | 'string'
 * @property {number[]} [range]     [min, max] for a numeric setting
 * @property {string[]} [options]   allowed values for an enum setting
 * @property {string} [description]
 */
/** @typedef {Record<string, SettingMeta>} SettingsMeta */
/** Canonical unit tags. */
export const UNIT: Readonly<{
    percent: "percent";
    ratio: "ratio";
    em: "em";
    boolean: "boolean";
    enum: "enum";
}>;
export const SETTING_UNITS: Readonly<{
    fontScale: "percent";
    lineHeight: "ratio";
    letterSpacing: "em";
    speechRate: "ratio";
}>;
export type Unit = "percent" | "ratio" | "em" | "boolean" | "enum";
/**
 * One entry of a host's `settingsMeta` (the registry's typed vocabulary for
 * one setting key).
 */
export type SettingMeta = {
    /**
     * 'number' | 'boolean' | 'enum' | 'string'
     */
    type: string;
    /**
     * [min, max] for a numeric setting
     */
    range?: number[] | undefined;
    /**
     * allowed values for an enum setting
     */
    options?: string[] | undefined;
    description?: string | undefined;
};
export type SettingsMeta = Record<string, SettingMeta>;
//# sourceMappingURL=units.d.ts.map