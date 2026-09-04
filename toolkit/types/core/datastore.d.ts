/**
 * @param {Object} deps
 * @param {import('../ports/index.js').KVStore} deps.kv
 * @param {import('../ports/index.js').Clock} deps.clock
 * @param {import('./taxonomy.js').Taxonomy} deps.taxonomy       The site taxonomy object (../core/taxonomy).
 * @param {import('./skill.js').ToolsRegistry|null} [deps.toolsRegistry]  The built-in tools registry (AA_TOOLS), or null.
 * @param {import('./skill.js').Skill[]} [deps.builtinSkills] Built-in SKILL.md playbooks shipped with the host
 *   (parsed Skill objects, e.g. globalThis.AA_SKILLS), or []. Read-only global tier,
 *   exposed via global.skills(); see ./skill.js for the Skill shape.
 * @returns the Datastore facade.
 */
export function createDatastore({ kv, clock, taxonomy, toolsRegistry, builtinSkills }: {
    kv: import("../ports/index.js").KVStore;
    clock: import("../ports/index.js").Clock;
    taxonomy: import("./taxonomy.js").Taxonomy;
    toolsRegistry?: import("./skill.js").ToolsRegistry | null | undefined;
    builtinSkills?: import("./skill.js").Skill[] | undefined;
}): {
    catalog(): any;
    get(name: any): Promise<any>;
    set(name: any, value: any): Promise<void>;
    patch(name: any, fn: any): Promise<any>;
    memoryShardKey(scope: any): string;
    getMemoryShard(scope: any): Promise<any>;
    setMemoryShard(scope: any, records: any): Promise<void>;
    allMemoryShards(): Promise<{}>;
    setActingUser(id: any, opts?: {}): Promise<{
        ok: boolean;
        reason: string;
        id?: undefined;
        helperMode?: undefined;
    } | {
        ok: boolean;
        id: any;
        helperMode: boolean;
        reason?: undefined;
    }>;
    getActingUser(): {
        id: any;
        helperMode: boolean;
    };
    global: {
        tools(): import("./skill.js").ToolsRegistry | null;
        taxonomy(): import("./taxonomy.js").Taxonomy;
        skills(): import("./skill.js").Skill[];
    };
    runMigrations: () => Promise<any>;
};
export default createDatastore;
//# sourceMappingURL=datastore.d.ts.map