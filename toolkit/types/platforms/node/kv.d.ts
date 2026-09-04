/** A KVStore backed by one JSON file per area on disk, under `dir`. Mirrors
 *  toolkit/ports/index.js's KVStore contract exactly: get() resolves the raw
 *  stored value or `undefined`; set() persists (deleting on `undefined`);
 *  getAll() resolves the whole area as a `{ key: value }` map. */
export function fileKV(dir: any): {
    get(area: any, key: any): Promise<any>;
    set(area: any, key: any, value: any): Promise<void>;
    getAll(area: any): Promise<any>;
};
/** A KVStore over a plain in-process object — no disk I/O, no persistence
 *  across runs. Same contract as fileKV; useful for a script that only needs
 *  one process lifetime, or a test. */
export function memoryKV(): {
    get(area: any, key: any): Promise<any>;
    set(area: any, key: any, value: any): Promise<void>;
    getAll(area: any): Promise<any>;
};
//# sourceMappingURL=kv.d.ts.map