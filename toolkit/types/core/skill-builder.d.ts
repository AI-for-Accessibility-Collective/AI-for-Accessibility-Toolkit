/**
 * Build the prompt that instructs the LLM to author a SKILL.md composing the
 * available adapters for a stated need. Grounds the model in the real adapter
 * catalog + settings vocabulary so it can only reference things that exist.
 *
 * When the person tried a previous attempt and it wasn't right, pass it back
 * with their feedback (`previous` + `feedback`), the diagrams' evaluation
 * loop where a failed validation returns to the skill builder agent.
 *
 * @overload
 * @param {string} need                 - the user's plain-language request
 * @param {SkillBuildOptions} opts
 * @returns {string}
 */
export function buildSkillPrompt(need: string, opts: SkillBuildOptions): string;
/**
 * Parse the LLM's SKILL.md output into a validated Skill. Tolerant of code
 * fences the model wraps the whole doc in.
 *
 * @param {string} llmOutput
 * @param {{ tools?: import('./skill.js').ToolsRegistry|null }} [deps]
 * @returns {{ skill: Skill, valid: boolean, errors: string[] }}
 */
export function parseBuiltSkill(llmOutput: string, { tools }?: {
    tools?: import("./skill.js").ToolsRegistry | null;
}): {
    skill: Skill;
    valid: boolean;
    errors: string[];
};
/**
 * Full build helper: prompt the injected LLM, parse + validate, and (if the
 * model referenced anything invalid) return the errors so the caller can
 * re-prompt. Does not persist; the caller (Librarian) owns storage + consent.
 *
 * @overload
 * @param {string} need
 * @param {SkillBuildOptions & { llm?: ((prompt: string) => Promise<string>)|null }} deps
 *   `llm` may be missing or null (the Librarian passes its caller slot as is);
 *   the result then says 'no LLM available' instead of calling anything.
 * @returns {Promise<{ skill: Skill|null, valid: boolean, errors: string[] }>}
 */
export function buildSkill(need: string, deps: SkillBuildOptions & {
    llm?: ((prompt: string) => Promise<string>) | null;
}): Promise<{
    skill: Skill | null;
    valid: boolean;
    errors: string[];
}>;
export type Skill = import("./skill.js").Skill;
/**
 * The registry members the Engineer needs: the prompt catalog on top of the
 * core's minimum.
 */
export type SkillBuilderTools = import("./skill.js").ToolsRegistry & {
    forPrompt: () => import("./skill.js").ToolPromptEntry[];
};
export type SkillBuildOptions = {
    /**
     * ability profile (supportAreas, freeText)
     */
    profile?: import("./ability.js").ProfileRecord | undefined;
    /**
     * AA_TOOLS registry (forPrompt + settingsVocabularyLines)
     */
    tools: SkillBuilderTools;
    /**
     * AA_TAXONOMY (categoryIds) for siteRelevance
     */
    taxonomy?: Pick<import("./taxonomy.js").Taxonomy, "categoryIds"> | undefined;
    /**
     * the prior built Skill the person rejected
     */
    previous?: import("./skill.js").Skill | null | undefined;
    /**
     * what the person said was wrong with it
     */
    feedback?: string | undefined;
};
//# sourceMappingURL=skill-builder.d.ts.map