// chat-history.js — the composer's command history (Up/Down recall), lifted out
// of chat.js so it can be tested without a browser.
//
// The ring itself is state plus three small rules that are easy to get subtly
// wrong: consecutive duplicates are skipped, the in-progress draft is preserved
// when you arrow up and restored when you arrow back past the newest entry, and
// the list is capped. chat.js keeps the textarea handling (caret placement, key
// events); this file never sees a DOM node.

/**
 * Whether the caret sits on the first / last line of a textarea-shaped value.
 * Recall only happens there, so a multi-line draft still moves the cursor
 * normally instead of being replaced.
 *
 * Pure over the shape {value, selectionStart, selectionEnd}.
 */
export function onFirstLine(ta) {
  return ta.selectionStart === ta.selectionEnd
    && ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1;
}
export function onLastLine(ta) {
  return ta.selectionStart === ta.selectionEnd
    && ta.value.slice(ta.selectionEnd).indexOf('\n') === -1;
}

/**
 * A command-history ring.
 *
 * `load` and `save` are injected so the store is swappable — chat.js passes
 * localStorage-backed ones, tests pass plain functions. Both may throw or
 * return junk (private browsing, a cleared or hand-edited store); anything
 * that is not an array of strings is treated as an empty history.
 *
 * `prev`/`next` are string-in, string-out: they take the current draft and
 * return what the composer should now show, or null to leave it alone.
 */
export function createHistory({ load, save, max = 50 } = {}) {
  let entries = [];
  try {
    const raw = load ? load() : null;
    if (Array.isArray(raw)) entries = raw.filter((x) => typeof x === 'string');
  } catch { entries = []; }

  let index = entries.length; // one past the newest = "the current draft"
  let draft = '';             // the in-progress line, restored when you arrow back past newest

  return {
    get size() { return entries.length; },
    get entries() { return entries.slice(); },
    /** True while the composer is showing a draft rather than a recalled entry. */
    get atDraft() { return index >= entries.length; },

    push(text) {
      const t = String(text || '').trim();
      if (t && entries[entries.length - 1] !== t) { // skip empty + consecutive dupes
        entries.push(t);
        if (entries.length > max) entries = entries.slice(-max);
        try { if (save) save(entries); } catch { /* a full or unavailable store must not break the turn */ }
      }
      index = entries.length;
      draft = '';
    },

    /** Older. Returns the value to show, or null at the oldest entry. */
    prev(current) {
      if (!entries.length || index === 0) return null;
      if (index === entries.length) draft = current; // remember the live draft
      index--;
      return entries[index] || '';
    },

    /** Newer. Returns the value to show — the draft again past the newest entry. */
    next() {
      if (index >= entries.length) return null;
      index++;
      return index === entries.length ? draft : (entries[index] || '');
    },
  };
}
