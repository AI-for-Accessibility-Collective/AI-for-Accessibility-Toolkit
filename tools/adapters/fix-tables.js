// Fix data tables without header rows so screen readers can announce columns
import { inferColumnHeader } from '../utils/ai.js';
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Per-page AI cost bounds (mirrors fix-links.js's MAX_LINKS_PER_PAGE): a
// dashboard full of wide headerless tables must not fire dozens of AI calls
// in one scan. Deterministic header-row promotion is free and uncapped.
const MAX_AI_TABLES_PER_PAGE = 10;
const MAX_AI_COLUMNS = 12;

/**
 * Fix a table that has no <th> cells.
 *
 * Strategy:
 * 1. If the first row *looks* like a header row (short, distinct text),
 *    convert its cells to <th scope="col"> — deterministic, no AI.
 * 2. Otherwise, sample each column and ask the AI for a header name,
 *    then insert a generated <thead> (marked as AI-generated).
 */
export async function fixTableHeaders(table) {
  if (table.dataset.ai4a11yProcessed) return false;
  if (table.querySelector('th')) return false;

  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) return false;

  markProcessed(table, 'pending');

  const firstRowCells = Array.from(rows[0].querySelectorAll('td'));
  if (firstRowCells.length === 0) {
    markProcessed(table, 'skipped');
    return false;
  }

  // Numbers, currency, percentages, and dates are data, not header labels.
  const isDataLike = (t) => /^[\s$€£¥+\-]*[\d.,]+\s*%?$/.test(t) ||
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(t) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(t);

  // Heuristic: the first row is a header if every cell is short text that
  // doesn't repeat in the column below it — AND the row isn't mostly data
  // values. Without the data check, a genuinely headerless table with short,
  // distinct first-row values (day names, ids, numbers) gets its real data
  // promoted to headers, inventing false semantics.
  const dataLikeCount = firstRowCells.filter(c => isDataLike(c.textContent?.trim() || '')).length;
  const looksLikeHeader = dataLikeCount <= firstRowCells.length / 2 && firstRowCells.every((cell, i) => {
    const text = cell.textContent?.trim() || '';
    if (!text || text.length > 40) return false;
    const below = rows.slice(1, 4).map(r => r.querySelectorAll('td')[i]?.textContent?.trim());
    return !below.includes(text);
  });

  if (looksLikeHeader) {
    firstRowCells.forEach(cell => {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      // Move the live child nodes so any event listeners the page bound to
      // header-cell content (sort icons, tooltips) survive the promotion —
      // an innerHTML round-trip would silently drop them.
      while (cell.firstChild) th.appendChild(cell.firstChild);
      cell.replaceWith(th);
    });
    markProcessed(table, 'done');
    incrementStat('wcag');
    logFix('table headers', table, '(no headers)', 'first row → column headers');
    return true;
  }

  // AI path: only for tables with enough data to infer from
  if (rows.length < 4) {
    markProcessed(table, 'skipped');
    return false;
  }

  try {
    const columnCount = firstRowCells.length;
    const headers = [];
    for (let col = 0; col < columnCount; col++) {
      const samples = rows.slice(0, 5)
        .map(r => r.querySelectorAll('td')[col]?.textContent?.trim())
        .filter(Boolean);
      const header = (col < MAX_AI_COLUMNS && samples.length >= 2) ? await inferColumnHeader(samples) : null;
      headers.push(header || `Column ${col + 1}`);
    }

    const thead = document.createElement('thead');
    thead.dataset.ai4a11yGenerated = 'true';
    const headerRow = document.createElement('tr');
    for (const label of headers) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.prepend(thead);

    markProcessed(table, 'done');
    incrementStat('wcag');
    logFix('table headers', table, '(no headers)', headers.join(', '));
    return true;
  } catch (e) {
    console.warn('[AI4A11y] fixTableHeaders failed:', e);
    markProcessed(table, 'failed');
    return false;
  }
}

/** Find and fix all headerless data tables on the page. */
export async function fixAllTables() {
  const candidates = Array.from(document.querySelectorAll('table'))
    .filter(t => !t.dataset.ai4a11yProcessed && !t.querySelector('th') && t.querySelectorAll('tr').length >= 2)
    .filter(t => !t.getAttribute('role') || t.getAttribute('role') === 'table'); // skip layout tables marked role=presentation
  // Bound AI cost per scan; announce the truncation rather than silently
  // dropping the rest (they get another chance on the next scan pass).
  const tables = candidates.slice(0, MAX_AI_TABLES_PER_PAGE);
  if (candidates.length > tables.length) {
    console.log(`[AI4A11y] fix-tables: fixing ${tables.length} of ${candidates.length} headerless tables this pass (cost cap)`);
  }
  const results = [];
  for (const table of tables) {
    results.push(await fixTableHeaders(table));
  }
  return results.filter(Boolean).length;
}

export const axeHandlers = {};
