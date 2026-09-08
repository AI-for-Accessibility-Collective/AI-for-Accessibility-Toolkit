/**
 * @param {Object} deps
 * @param {SharedStore} deps.shared  The host-provided device-shared store.
 * @param {{now: () => number}} deps.clock
 */
export function createSharedTransport({ shared, clock }: {
    shared: SharedStore;
    clock: {
        now: () => number;
    };
}): {
    /**
     * @param {TransportLibrarian} librarian
     * @param {string[]|null} [appIds]
     */
    publishExports(librarian: TransportLibrarian, appIds?: string[] | null): Promise<{
        published: any[];
        retracted: any[];
    }>;
    /** @param {TransportLibrarian} librarian */
    drainInbox(librarian: TransportLibrarian): Promise<({
        ok: boolean;
        reason?: string;
        sourceAppId: any;
    } | {
        ok: boolean;
        reason: string;
    })[]>;
    /** @param {string} appId */
    readExport(appId: string): Promise<any>;
    /**
     * @param {string} sourceAppId
     * @param {any} insight
     */
    postInsight(sourceAppId: string, insight: any): Promise<void>;
};
/**
 * @typedef {Object} SharedStore
 * Minimal surface for the device-shared area.
 * @property {(key: string) => Promise<any>} get     undefined when absent.
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} [remove]  optional; set(key, undefined) is the fallback.
 */
export const EXPORT_PREFIX: "aa.shared.export.";
export const INBOX_KEY: "aa.shared.inbox";
export const PUBLISHED_INDEX_KEY: "aa.shared.published";
export const ENVELOPE_VERSION: 1;
export default createSharedTransport;
/**
 * The Librarian methods the transport drives. Structural on purpose: any
 * object with these three methods (a real Librarian, a remote proxy, a test
 * double) can sit on either side.
 */
export type TransportLibrarian = {
    listGrants: () => Promise<Array<{
        appId: string;
    }>>;
    exportAbilityModel: (appId: string) => Promise<{
        ok: boolean;
        abilityModel?: any;
        reason?: string;
    }>;
    importInsight: (sourceAppId: string, insight: any) => Promise<{
        ok: boolean;
        reason?: string;
    }>;
};
/**
 * Minimal surface for the device-shared area.
 */
export type SharedStore = {
    /**
     * undefined when absent.
     */
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    /**
     * optional; set(key, undefined) is the fallback.
     */
    remove?: ((key: string) => Promise<void>) | undefined;
};
//# sourceMappingURL=transport.d.ts.map