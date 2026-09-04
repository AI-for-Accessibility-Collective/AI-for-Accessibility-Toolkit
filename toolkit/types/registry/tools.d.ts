export function settingsPromptLines(): string[];
/** @param {string} id */
export function getSkillById(id: string): import("../core/skill.js").ToolEntry | undefined;
/** @param {string} area */
export function getSkillsByArea(area: string): import("../core/skill.js").ToolEntry[];
export function getRegistryForPrompt(): {
    id: string;
    name: string;
    description: string;
    supportAreas: string[];
    siteRelevance: string[];
}[];
export function asAATools(): {
    version: number;
    list: import("../core/skill.js").ToolEntry[];
    settingsMeta: import("../core/units.js").SettingsMeta;
    settingsVocabularyLines(): string[];
    /** @param {string} id */
    byId(id: string): import("../core/skill.js").ToolEntry | null;
    /** @param {string} area */
    byArea(area: string): import("../core/skill.js").ToolEntry[];
    /** @param {string[]} ids */
    settingsFor(ids: string[]): Record<string, any>;
    forPrompt(): {
        id: string;
        name: string;
        description: string;
        supportAreas: string[];
        siteRelevance: string[];
    }[];
};
/** @type {import('../core/skill.js').ToolEntry[]} */
export const skillRegistry: import("../core/skill.js").ToolEntry[];
/** @type {import('../core/units.js').SettingsMeta} */
export const settingsMeta: import("../core/units.js").SettingsMeta;
//# sourceMappingURL=tools.d.ts.map