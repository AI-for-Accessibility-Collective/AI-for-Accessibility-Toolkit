// Re-export of the canonical auditor — one source of truth. The checks moved
// to tools/auditors/contract-mismatch.js, which is where a thing that FINDS
// issues belongs in this codebase; adapters fix, auditors find.
export * from '../../../tools/auditors/contract-mismatch.js';
