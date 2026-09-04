/**
 * @param {Object} deps
 * @param {ReturnType<typeof import('./datastore.js').createDatastore>} deps.datastore   The Datastore facade (../core/datastore).
 * @param {import('./taxonomy.js').Taxonomy} deps.taxonomy    The site taxonomy (../core/taxonomy).
 * @param {import('../ports/index.js').Clock} deps.clock
 * @param {import('../ports/index.js').Scheduler} [deps.scheduler]
 * @param {import('../ports/index.js').Consent} [deps.consent]
 * @param {import('../ports/index.js').DemoHook} [deps.demo]
 * @returns the Librarian.
 */
export function createLibrarian({ datastore, taxonomy, clock, scheduler, consent, demo, }: {
    datastore: ReturnType<typeof import("./datastore.js").createDatastore>;
    taxonomy: import("./taxonomy.js").Taxonomy;
    clock: import("../ports/index.js").Clock;
    scheduler?: import("../ports/index.js").Scheduler | undefined;
    consent?: import("../ports/index.js").Consent | undefined;
    demo?: import("../ports/index.js").DemoHook | undefined;
}): {
    setGeminiCaller(fn: any): void;
    getProfile(): Promise<any>;
    getAbilityModel(): Promise<import("./ability.js").AbilityModel>;
    setProfileField(path: any, value: any): Promise<any>;
    setProfileFields(fields: any): Promise<any>;
    recordExplicitSetting(key: any, value: any, origin: any): Promise<any[]>;
    recordScopedSettings(scope: any, settings: any, opts?: {}): Promise<any[]>;
    hasScopedSetting(scope: any, key: any): Promise<any>;
    getScopedSetting(scope: any, key: any): Promise<any>;
    removeScopedSetting(scope: any, key: any): Promise<{
        removed: boolean;
    }>;
    resetToProfile(opts?: {}): Promise<{
        forgotten: {
            scope: string;
            key: any;
            value: any;
        }[];
        scopes: string[];
        restored: {
            settings: Record<string, any>;
            applied: {
                id: any;
                scope: any;
                text: any;
                explicit: boolean;
            }[];
            provenance: Record<string, any>;
            category: any;
            origin: string | null;
        };
    }>;
    getSiteCategory(origin: any, opts?: {}): Promise<any>;
    setSiteCategoryOverride(origin: any, category: any): Promise<{
        ok: boolean;
        reason: string;
    } | {
        ok: boolean;
        reason?: undefined;
    }>;
    getEffectivePreferences(url: any, contexts?: any[]): Promise<{
        settings: Record<string, any>;
        applied: {
            id: any;
            scope: any;
            text: any;
            explicit: boolean;
        }[];
        provenance: Record<string, any>;
        category: any;
        origin: string | null;
    }>;
    recall(url: any, task?: string, contexts?: any[]): Promise<{
        block: string;
        facts: any[];
        profile: any;
        category: any;
        origin: string | null;
        procedural: ({
            kind: string;
            id: any;
            name: any;
            description: any;
            scope: any;
            prompt?: undefined;
            siteTypes?: undefined;
            profileId?: undefined;
        } | {
            kind: string;
            id: any;
            name: any;
            prompt: any;
            siteTypes: any;
            profileId: any;
            description?: undefined;
            scope?: undefined;
        })[];
    }>;
    listMemories(filter?: {}): Promise<{
        memories: any[];
        suppressions: any;
    }>;
    deleteMemory(id: any): Promise<boolean>;
    addNote(text: any, opts?: {}): Promise<{
        ok: boolean;
        reason: string;
        id?: undefined;
        note?: undefined;
    } | {
        ok: boolean;
        id: any;
        note: {
            id: any;
            text: any;
            topic: any;
            scope: any;
            source: any;
            writer: any;
            importance: any;
            status: any;
            createdAt: any;
            updatedAt: any;
            occurrenceCount: any;
        };
        reason?: undefined;
    }>;
    listNotes(filter?: {}): Promise<{
        id: any;
        text: any;
        topic: any;
        scope: any;
        source: any;
        writer: any;
        importance: any;
        status: any;
        createdAt: any;
        updatedAt: any;
        occurrenceCount: any;
    }[]>;
    updateNote(id: any, patch?: {}): Promise<{
        ok: boolean;
        reason: string;
        note?: undefined;
    } | {
        ok: boolean;
        note: {
            id: any;
            text: any;
            topic: any;
            scope: any;
            source: any;
            writer: any;
            importance: any;
            status: any;
            createdAt: any;
            updatedAt: any;
            occurrenceCount: any;
        };
        reason?: undefined;
    }>;
    deleteNote(id: any): Promise<{
        ok: boolean;
        removed: boolean;
        reason?: undefined;
    } | {
        ok: boolean;
        removed: boolean;
        reason: string;
    }>;
    findNotes(query: any, opts?: {}): Promise<{
        score: number;
        matched: any;
        id: any;
        text: any;
        topic: any;
        scope: any;
        source: any;
        writer: any;
        importance: any;
        status: any;
        createdAt: any;
        updatedAt: any;
        occurrenceCount: any;
    }[]>;
    listProposals(status?: string): Promise<any>;
    listProcedural(category?: null): Promise<({
        kind: string;
        id: any;
        name: any;
        description: any;
        scope: any;
        prompt?: undefined;
        siteTypes?: undefined;
        profileId?: undefined;
    } | {
        kind: string;
        id: any;
        name: any;
        prompt: any;
        siteTypes: any;
        profileId: any;
        description?: undefined;
        scope?: undefined;
    })[]>;
    listSkills(): Promise<any[]>;
    retrieveSkill(url: any, contexts?: any[]): Promise<any>;
    findSkillForNeed(need: any): Promise<any>;
    /**
     * @param {import('./skill.js').Skill} skill
     * @returns {ReturnType<typeof resolveSkill>}
     */
    resolveSkill(skill: import("./skill.js").Skill): ReturnType<typeof resolveSkill>;
    buildSkill(need: any, opts?: {}): Promise<{
        skill: import("./skill-builder.js").Skill | null;
        valid: boolean;
        errors: string[];
    }>;
    saveSkill(skill: any): Promise<{
        saved: boolean;
        errors: string[];
    }>;
    deleteSkill(name: any): Promise<boolean>;
    requestGrant(appId: any, scopes: any, opts?: {}): Promise<{
        ok: boolean;
        reason: string;
        proposalId?: undefined;
    } | {
        ok: boolean;
        proposalId: any;
        reason?: undefined;
    }>;
    listGrants(): Promise<any>;
    revokeGrant(appId: any): Promise<{
        ok: boolean;
    }>;
    exportAbilityModel(appId: any): Promise<{
        ok: boolean;
        reason: string;
        abilityModel?: undefined;
    } | {
        ok: boolean;
        abilityModel: Partial<import("./ability.js").AbilityModel> & {
            schemaVersion: number;
        };
        reason?: undefined;
    }>;
    importInsight(sourceAppId: any, insight?: {}): Promise<{
        ok: boolean;
        reason: string;
        proposalId?: undefined;
    } | {
        ok: boolean;
        proposalId: any;
        reason?: undefined;
    }>;
    importInsightOutbox(outbox: any): Promise<{
        ok: boolean;
        reason: string;
        results?: undefined;
    } | {
        ok: boolean;
        results: ({
            ok: boolean;
            reason: string;
            proposalId?: undefined;
        } | {
            ok: boolean;
            proposalId: any;
            reason?: undefined;
        })[];
        reason?: undefined;
    }>;
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
    exportProfileBlob(): Promise<{
        kind: string;
        v: number;
        exportedAt: number;
        abilityModel: import("./ability.js").AbilityModel | null;
        profile: {
            supportAreas: string[];
            freeText: string;
            fields: Record<string, unknown>;
            metaPreferences: {
                language: string;
            };
            updatedAt: number | null;
        };
    }>;
    importProfileBlob(blob: any): Promise<{
        ok: boolean;
        reason: string;
        merged?: undefined;
    } | {
        ok: boolean;
        merged: boolean;
        reason: string;
    } | {
        ok: boolean;
        merged: boolean;
        reason?: undefined;
    }>;
    interpretNeedsPrompt(text: any): Promise<string>;
    logObservation(obs: any): Promise<{
        logged: boolean;
        reason: string;
    } | {
        logged: boolean;
        reason?: undefined;
    }>;
    _maybeProposeReusableAction(obs: any, origin: any, category: any): Promise<void>;
    setMemoryPaused(paused: any): Promise<void>;
    setSharingPaused(paused: any): Promise<void>;
    setOriginPaused(origin: any, paused: any): Promise<void>;
    respondToProposal(id: any, response: any): Promise<{
        ok: boolean;
        reason: string;
        status?: undefined;
    } | {
        ok: boolean;
        status: any;
        reason?: undefined;
    }>;
    extract(): Promise<{
        ran: boolean;
        reason: any;
        applied?: undefined;
        observations?: undefined;
    } | {
        ran: boolean;
        applied: {
            ADD: number;
            UPDATE: number;
            SUPERSEDE: number;
            NOOP: number;
            CONTRADICT: number;
        };
        observations: any;
        reason?: undefined;
    }>;
    _draftProposals(drafts: any, { suppressions, profile, now }: {
        suppressions: any;
        profile: any;
        now: any;
    }): Promise<void>;
    reflect(): Promise<{
        ran: boolean;
        promoted: number;
        expired: number;
        purged: number;
        discarded: number;
    }>;
};
export default createLibrarian;
import { resolveSkill } from './skill.js';
//# sourceMappingURL=librarian.d.ts.map