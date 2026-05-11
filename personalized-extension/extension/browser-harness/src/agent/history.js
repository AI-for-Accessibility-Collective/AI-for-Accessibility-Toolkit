// History rendering + browser-use-style compaction. When the rendered
// history grows past BH_AGENT_HISTORY_CHAR_THRESHOLD, fire one extra
// Gemini call that compresses the bulk of it into a single "memory"
// string, then replace history[1..-keepTail] with a synthetic
// compacted_history entry. Step 1 stays (original task framing) and the
// last few steps stay verbatim so the model still has concrete recent
// context.

import {
  BH_AGENT_HISTORY_CHAR_THRESHOLD,
  BH_AGENT_HISTORY_KEEP_TAIL,
  BH_AGENT_EXTRACTED_INLINE_MAX,
} from './constants.js';
import { getGeminiCaller, _bhAgentTruncate, _bhAgentLog } from './state.js';

export async function _bhAgentCompactHistoryIfNeeded(history, task) {
  const callGemini = getGeminiCaller();
  if (!callGemini) return false;
  if (history.length <= BH_AGENT_HISTORY_KEEP_TAIL + 2) return false;

  const rendered = _bhAgentRenderHistory(history);
  if (rendered.length < BH_AGENT_HISTORY_CHAR_THRESHOLD) return false;

  const prompt = [
    'You are compacting a browser-agent history into a memory note so a future turn can continue the task without rereading every step.',
    '',
    'Preserve: the task requirements, constraints/inputs given by the user, key facts learned about the site (URLs, selectors, IDs), decisions made, partial progress, errors encountered, and any data already extracted.',
    'Drop: redundant click/scroll narration, duplicated screenshot observations, anything trivially recoverable from the next screenshot.',
    '',
    `Task: ${task}`,
    '',
    'Full history so far:',
    rendered,
    '',
    'Write a plain-text summary of ~250 words. No markdown headings, no JSON. Address the future agent in the first person ("I have…", "Next I should…").',
  ].join('\n');

  let summary;
  try {
    summary = await callGemini(prompt, null, {});
  } catch (e) {
    console.warn('[BrowserAgent] compaction failed:', e.message);
    return false;
  }
  if (!summary || typeof summary !== 'string') return false;

  // Replace history[1 .. length - keepTail] with one synthetic entry.
  const compacted = {
    is_compacted: true,
    memory: summary.trim(),
    t: Date.now(),
  };
  const removeStart = 1;
  const removeCount = history.length - BH_AGENT_HISTORY_KEEP_TAIL - 1;
  if (removeCount > 0) {
    history.splice(removeStart, removeCount, compacted);
    await _bhAgentLog({
      kind: 'info',
      text: `Compacted ${removeCount} history steps into a summary (${rendered.length} -> ~${summary.length} chars)`,
    });
    return true;
  }
  return false;
}

function _bhAgentRenderHistoryEntry(h, idx) {
  if (h.is_compacted) {
    return [
      `Step ${idx + 1} (compacted summary of earlier steps):`,
      h.memory || '(no summary)',
    ].join('\n');
  }
  // Strip the meta-fields out of the action shape so it renders cleanly.
  const actionView = {};
  for (const k of Object.keys(h)) {
    if (['evaluation_previous_goal', 'memory', 'next_goal', 'reason',
         'is_compacted', 'extracted', 'error', 't'].includes(k)) continue;
    actionView[k] = h[k];
  }
  const lines = [`Step ${idx + 1}:`];
  if (h.evaluation_previous_goal) lines.push(`  evaluation_previous_goal: ${h.evaluation_previous_goal}`);
  if (h.next_goal) lines.push(`  next_goal: ${h.next_goal}`);
  lines.push(`  action: ${JSON.stringify(actionView)}`);
  if (h.reason) lines.push(`  reason: ${h.reason}`);
  if (h.extracted !== undefined && h.extracted !== null) {
    let blob;
    try { blob = JSON.stringify(h.extracted); }
    catch { blob = String(h.extracted); }
    lines.push(`  result: ${_bhAgentTruncate(blob, BH_AGENT_EXTRACTED_INLINE_MAX)}`);
  }
  if (h.error) lines.push(`  error: ${_bhAgentTruncate(h.error, 400)}`);
  return lines.join('\n');
}

export function _bhAgentRenderHistory(history) {
  if (!history.length) return 'No previous actions yet.';
  return 'History (full):\n\n' + history.map(_bhAgentRenderHistoryEntry).join('\n\n');
}
