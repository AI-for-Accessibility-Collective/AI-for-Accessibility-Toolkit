/**
 * Derive a record's memory class from its `kind`. Total over any input:
 * an unknown/missing kind falls through to 'semantic' (the durable-fact
 * default), so it is always safe to stamp.
 * @param {{kind?: string}} record
 * @returns {'episodic'|'semantic'|'procedural'}
 */
export function memoryClassOf(record: {
    kind?: string;
}): "episodic" | "semantic" | "procedural";
export const MEMORY_CLASSES: string[];
export default memoryClassOf;
//# sourceMappingURL=memory-class.d.ts.map