/** A file-backed SharedStore. `file` is the single JSON document every
 *  participating toolkit instance/app on this "device" is given the same
 *  path to. */
export function fileSharedStore(file: any): {
    get(key: any): Promise<any>;
    set(key: any, value: any): Promise<void>;
    remove(key: any): Promise<void>;
};
//# sourceMappingURL=shared-store.d.ts.map