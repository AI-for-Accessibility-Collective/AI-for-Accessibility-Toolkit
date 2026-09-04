/**
 * Parse a SKILL.md string into a Skill object. Tolerant: missing pieces come
 * back empty rather than throwing, so a half-formed LLM output still parses
 * (validateSkill catches the problems).
 * @param {string} markdown
 * @returns {Skill}
 */
export function parseSkill(markdown: string): Skill;
/**
 * Serialize a Skill back to SKILL.md text (round-trips with parseSkill for the
 * structured fields). Used by the Engineer to persist a built skill.
 * @param {Skill} skill
 * @returns {string}
 */
export function serializeSkill(skill: Skill): string;
/**
 * Read a vocabulary field (supportAreas, siteRelevance) as a list. parseSkill
 * always produces one, but a hand-built skill object (a saveSkill caller, a
 * test) may carry a single string, or nothing at all. One reader, used by BOTH
 * validateSkill and matchSkill, so what validation calls valid is exactly what
 * retrieval can score: a lone 'vision' is one value, never six characters to
 * iterate, and a non-iterable value never throws. The Librarian also runs a
 * skill's two fields through it before storing, so what lands in the Skills db
 * is always a list.
 * @param {any} v
 * @returns {any[]}
 */
export function vocabList(v: any): any[];
/**
 * Validate a skill against the tools registry (AA_TOOLS) and the two
 * vocabularies: the name/description exist, every recipe adapter id is a real
 * tool, every settings key is in the settings vocabulary, every supportArea is
 * in SUPPORT_AREAS, and every siteRelevance value is a taxonomy category or
 * 'all'. Returns collected errors (empty = valid).
 *
 * The vocabulary checks reject rather than warn: supportAreas and
 * siteRelevance are what retrieval matches on (matchSkill), so a value outside
 * the vocabulary is a skill that can never be found again (issue #34).
 * @param {Skill} skill
 * @param {{ tools?: ToolsRegistry|null, taxonomy?: SkillTaxonomy|null }} [deps]
 *   tools    = the AA_TOOLS registry (byId + settingsMeta)
 *   taxonomy = the site taxonomy; defaults to the bundled one when absent or
 *              null. Normally the bundled object or a host's own with the same
 *              shape, so `categoryIds()` is used when present. A plain
 *              `{ categories: [{ id }] }` is also read, so a caller that has
 *              only the data can validate; that is a tolerance here, not a
 *              host port. The Librarian's `taxonomy` dependency still needs
 *              the full object (`categoryIds`, `categoryForHost`, `contexts`,
 *              `version`).
 * Both vocabulary fields are read through vocabList, so a hand-built skill
 * that carries a single string is checked as a one-item list and scored the
 * same way by matchSkill.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSkill(skill: Skill, { tools, taxonomy }?: {
    tools?: ToolsRegistry | null;
    taxonomy?: SkillTaxonomy | null;
}): {
    valid: boolean;
    errors: string[];
};
/**
 * Compile a skill's recipe to the deterministic apply-plan: the merged
 * settings object (same shape the extension's applyVisualSettings consumes)
 * plus the ordered adapter ids, plus any agent actions to run. This is the
 * bridge skill → adapters, no LLM. Later steps win on key conflicts
 * (author-ordered).
 * @param {Skill} skill
 * @returns {{ settings: Record<string, any>, adapterIds: string[], actions: SkillRecipeAction[] }}
 */
export function resolveSkill(skill: Skill): {
    settings: Record<string, any>;
    adapterIds: string[];
    actions: SkillRecipeAction[];
};
/**
 * Score how well a skill fits a person + page (for Librarian retrieval).
 * Deterministic: overlap of supportAreas with the profile, plus a site match.
 * 0 = irrelevant. Higher = better fit.
 * @param {Skill} skill
 * @param {{ supportAreas?: string[], category?: string|null }} ctx
 * @returns {number}
 */
export function matchSkill(skill: Skill, { supportAreas, category }?: {
    supportAreas?: string[];
    category?: string | null;
}): number;
/**
 * Score how well a skill covers a plain-language NEED (the diagrams' "does
 * the skill exist in the db?" check, before the Engineer builds a new one).
 * Deterministic keyword overlap: each need word counts once, at the weight
 * of the best field it appears in. 0 = no meaningful overlap.
 * @param {Skill} skill
 * @param {string} need
 * @returns {number}
 */
export function matchSkillToNeed(skill: Skill, need: string): number;
export type SkillRecipeStep = {
    /**
     * - adapter id (must exist in the tools registry)
     */
    id: string;
    /**
     * - settings to apply for that adapter
     */
    settings?: Object | undefined;
};
export type SkillRecipeAction = {
    /**
     * - plain-language task the browser agent runs
     */
    prompt: string;
    /**
     * - short label for the task
     */
    name?: string | undefined;
};
export type Skill = {
    name: string;
    /**
     * - when to use it (what the model matches on)
     */
    description: string;
    supportAreas: string[];
    siteRelevance: string[];
    recipe: {
        adapters: SkillRecipeStep[];
        actions?: SkillRecipeAction[];
    };
    /**
     * - full markdown (instructions), sans frontmatter
     *
     * A recipe can compose two kinds of steps: adapters (page-fixing code applied
     * directly) and actions (tasks the browser agent performs, how a reusable
     * task saved from the Assistant becomes a skill). Most skills use only one.
     */
    body: string;
};
/**
 * One adapter in the tools registry (registry/tools.js `skillRegistry`).
 */
export type ToolEntry = {
    id: string;
    name: string;
    description: string;
    supportAreas: string[];
    siteRelevance: string[];
    /**
     * Settings this adapter sets when enabled.
     */
    settings?: Record<string, any> | undefined;
    requiresAI?: boolean | undefined;
    icon?: string | undefined;
    emoji?: string | undefined;
    quickStart?: boolean | undefined;
};
export type ToolPromptEntry = Pick<ToolEntry, "id" | "name" | "description" | "supportAreas" | "siteRelevance">;
/**
 * The AA_TOOLS-shaped registry a host injects (registry/tools.js `asAATools()`
 * builds the reference one). Only `settingsMeta` is read on the core's main
 * paths, and every such read guards it. The Librarian's LLM paths
 * (`interpretNeedsPrompt`, `buildSkill`, `extract`) also call
 * `settingsVocabularyLines` and `forPrompt` unguarded, and skill validation
 * reads `byId`; a host that never reaches those paths may leave them out.
 * FLAG(review): the optional members mirror what the core guards for at
 * runtime today, not a design decision about the registry contract.
 */
export type ToolsRegistry = {
    version?: number | undefined;
    list?: ToolEntry[] | undefined;
    settingsMeta: import("./units.js").SettingsMeta;
    /**
     * One prompt-ready line per setting.
     */
    settingsVocabularyLines?: (() => string[]) | undefined;
    byId?: ((id: string) => ToolEntry | null | undefined) | undefined;
    byArea?: ((area: string) => ToolEntry[]) | undefined;
    settingsFor?: ((ids: string[]) => Record<string, any>) | undefined;
    forPrompt?: (() => ToolPromptEntry[]) | undefined;
};
/**
 * What validateSkill reads from a taxonomy: `categoryIds()` when present,
 * else the `categories` data. The Librarian's own `taxonomy` dependency is
 * the full ./taxonomy.js Taxonomy; this is the tolerance validateSkill
 * extends to a caller that has only the data.
 */
export type SkillTaxonomy = {
    categoryIds?: (() => string[]) | undefined;
    categories?: ({
        id?: string;
    } | null | undefined)[] | undefined;
};
//# sourceMappingURL=skill.d.ts.map