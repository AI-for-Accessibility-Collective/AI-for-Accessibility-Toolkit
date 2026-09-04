/**
 * @typedef {Object} TaxonomyCategory
 * @property {string} id
 * @property {string} label
 * @property {boolean} [noMemoryDefault]  True for the no-memory zones.
 */
/**
 * @typedef {Object} Taxonomy
 * The shape a host-supplied taxonomy must have (this module's `taxonomy` is
 * the reference instance). The core reads `version`, `contexts`,
 * `categoryIds`, `noMemoryCategories`, and `categoryForHost`; `categories`
 * and `hostMap` are how the reference instance implements the last three,
 * so a host may implement them another way and leave both out.
 * @property {number} version
 * @property {TaxonomyCategory[]} [categories]
 * @property {{ id: string, label: string }[]} contexts
 * @property {Record<string, string>} [hostMap]      hostname -> category id
 * @property {() => string[]} categoryIds
 * @property {() => string[]} noMemoryCategories
 * @property {(hostname: string|null|undefined) => string|null} categoryForHost
 */
/** @type {Required<Taxonomy>} */
export const taxonomy: Required<Taxonomy>;
export const TAXONOMY: Required<Taxonomy>;
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
 * the reference instance). The core reads `version`, `contexts`,
 * `categoryIds`, `noMemoryCategories`, and `categoryForHost`; `categories`
 * and `hostMap` are how the reference instance implements the last three,
 * so a host may implement them another way and leave both out.
 */
export type Taxonomy = {
    version: number;
    categories?: TaxonomyCategory[] | undefined;
    contexts: {
        id: string;
        label: string;
    }[];
    /**
     * hostname -> category id
     */
    hostMap?: Record<string, string> | undefined;
    categoryIds: () => string[];
    noMemoryCategories: () => string[];
    categoryForHost: (hostname: string | null | undefined) => string | null;
};
//# sourceMappingURL=taxonomy.d.ts.map