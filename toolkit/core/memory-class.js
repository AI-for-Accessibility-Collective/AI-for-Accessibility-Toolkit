// Memory-class taxonomy (CoALA: working / episodic / semantic / procedural).
//
// A PURE, DERIVED label over a memory record's `kind` — NOT a stored field, NOT
// a migration, NOT a rename of any identifier. Phase 2 names the taxonomy the
// engine already embodies so consumers (recall, listMemories, the
// behavior-summary view) can group memories by class without the store growing
// a column:
//
//   episodic   — a raw, unconsolidated event sighting (kind 'observation').
//                The episodic LOG (mine.episodicLog) is the canonical episodic
//                store; a record still tagged 'observation' is one that hasn't
//                been consolidated into a durable fact yet.
//   procedural — how-to / skill knowledge: saved reusable actions and
//                procedural records (kind 'procedural').
//   semantic   — durable declarative facts about the user: preferences, rules,
//                and suppressions (everything else).
//
// Working memory (the live task context) is never persisted, so it has no
// record form to classify here.

export const MEMORY_CLASSES = ['episodic', 'semantic', 'procedural'];

/**
 * Derive a record's memory class from its `kind`. Total over any input:
 * an unknown/missing kind falls through to 'semantic' (the durable-fact
 * default), so it is always safe to stamp.
 * @param {{kind?: string}} record
 * @returns {'episodic'|'semantic'|'procedural'}
 */
export function memoryClassOf(record) {
  const kind = record && record.kind;
  if (kind === 'observation') return 'episodic';
  if (kind === 'procedural') return 'procedural';
  return 'semantic';
}

export default memoryClassOf;
