// Session undo stack for voice-driven settings changes. Each entry holds the
// *previous* values captured by voiceApplySettings, so undo replays them
// through the same route (LIFO — repeated undo steps further back). The stack
// lives with the offscreen page: closing the voice session drops it, which is
// why the panel's Undo button is only shown while connected.

export function createUndoStack(max = 10) {
  const stack = [];
  return {
    push(entry) {
      // An entry must carry something to revert: an explicit per-key restore
      // plan and/or a page-zoom revert.
      const hasWrites = entry && Array.isArray(entry.writes) && entry.writes.length;
      const hasZoom = entry && entry.pageZoom;
      if (!hasWrites && !hasZoom) return;
      stack.push(entry);
      if (stack.length > max) stack.shift();
    },
    pop() { return stack.pop() || null; },
    peek() { return stack[stack.length - 1] || null; },
    size() { return stack.length; },
    clear() { stack.length = 0; },
  };
}

export default createUndoStack;
