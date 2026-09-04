/**
 * @typedef {Object} TaxonomyCategory
 * @property {string} id
 * @property {string} label
 * @property {boolean} [noMemoryDefault]  True for the no-memory zones.
 */
/**
 * @typedef {Object} Taxonomy
 * The shape a host-supplied taxonomy must have (this module's `taxonomy` is
 * the reference instance).
 * @property {number} version
 * @property {TaxonomyCategory[]} categories
 * @property {{ id: string, label: string }[]} contexts
 * @property {Record<string, string>} hostMap        hostname -> category id
 * @property {() => string[]} categoryIds
 * @property {() => string[]} noMemoryCategories
 * @property {(hostname: string|null|undefined) => string|null} categoryForHost
 */
/** @type {Taxonomy} */
export const taxonomy: Taxonomy;
export namespace TAXONOMY {
    let version: number;
    let categories: TaxonomyCategory[];
    let contexts: {
        id: string;
        label: string;
    }[];
    let hostMap: Record<string, string>;
    let categoryIds: () => string[];
    let noMemoryCategories: () => string[];
    let categoryForHost: (hostname: string | null | undefined) => string | null;
}
export default taxonomy;
export type TaxonomyCategory = {
    id: string;
    label: string;
    /**
     * True for the no-memory zones.
     */
    noMemoryDefault?: boolean | undefined;
};
/**
 * The shape a host-supplied taxonomy must have (this module's `taxonomy` is
 * the reference instance).
 */
export type Taxonomy = {
    version: number;
    categories: TaxonomyCategory[];
    contexts: {
        id: string;
        label: string;
    }[];
    /**
     * hostname -> category id
     */
    hostMap: Record<string, string>;
    categoryIds: () => string[];
    noMemoryCategories: () => string[];
    categoryForHost: (hostname: string | null | undefined) => string | null;
};
//# sourceMappingURL=taxonomy.d.ts.map