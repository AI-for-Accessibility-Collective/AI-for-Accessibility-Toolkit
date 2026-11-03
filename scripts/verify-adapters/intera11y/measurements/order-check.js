'use strict';

function assignColumns(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { parent[find(i)] = find(j); };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].rect, b = items[j].rect;
      if (a.x < b.x + b.w && b.x < a.x + a.w) union(i, j);
    }
  }
  const colOf = new Map();
  items.forEach((it, i) => colOf.set(it.xpath, find(i)));
  return colOf;
}

function visualOrderDivergence(items, opts = {}) {
  const sc = opts.sc || '1.3.2';
  const kind = opts.kind || 'order';
  const band = Number.isFinite(opts.rowBand) ? opts.rowBand : 12;

  const seenXp = new Set();
  const seq = (items || []).filter((s) => s.rect && s.rect.w > 0 && s.rect.h > 0 && !seenXp.has(s.xpath) && seenXp.add(s.xpath));
  if (seq.length < 3) return { findings: [], comparable: seq.length };

  const area = (r) => r.w * r.h;
  const enc = (a, b) => a.xpath !== b.xpath && area(a.rect) > area(b.rect)
    && a.rect.x <= b.rect.x + 1 && a.rect.y <= b.rect.y + 1
    && a.rect.x + a.rect.w >= b.rect.x + b.rect.w - 1 && a.rect.y + a.rect.h >= b.rect.y + b.rect.h - 1;
  const leaves = seq.filter((a) => !seq.some((b) => enc(a, b)));
  if (leaves.length < 3) return { findings: [], comparable: leaves.length };

  const colOf = assignColumns(leaves);
  const byCol = new Map();
  for (const s of leaves) { const c = colOf.get(s.xpath); if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(s); }

  const findings = [];
  for (const colItems of byCol.values()) {
    if (colItems.length < 3) continue;
    const vis = [...colItems].sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > band ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
    const rank = new Map(); vis.forEach((s, i) => rank.set(s.xpath, i));
    let prevRank = -1, prevXp = null;
    for (const s of colItems) {
      const r = rank.get(s.xpath);
      if (prevRank >= 0 && (prevRank - r) >= 1) {
        findings.push({ kind, sc, xpath: s.xpath, label: s.label || '', review: true, calibrated: false,
          detail: `encountered after ${prevXp} but sits ${prevRank - r} visual position(s) earlier within its column — navigation order may diverge from visual order (uncalibrated triage, not a verdict)` });
      }
      prevRank = r; prevXp = s.xpath;
    }
  }
  return { findings, comparable: leaves.length };
}

const ORDINAL_RE = /-?\d+/;
const ORDINAL_MIN_STOPS = 6;
const ORDINAL_MIN_COVERAGE = 0.8;
function intrinsicOrdinalViolation(items, opts = {}) {
  const band = Number.isFinite(opts.rowBand) ? opts.rowBand : 12;
  const seenXp = new Set();
  const seq = (items || []).filter((s) => s && s.rect && s.rect.w > 0 && s.rect.h > 0 && s.xpath
    && !seenXp.has(s.xpath) && seenXp.add(s.xpath));
  if (seq.length < ORDINAL_MIN_STOPS) return { violated: false, reason: 'too few stops' };
  const withN = [];
  for (const s of seq) {
    const m = ORDINAL_RE.exec(String(s.label == null ? '' : s.label));
    if (m) withN.push({ ...s, n: Number(m[0]) });
  }
  if (withN.length < ORDINAL_MIN_STOPS || withN.length / seq.length < ORDINAL_MIN_COVERAGE) {
    return { violated: false, reason: 'stops do not carry ordinals' };
  }
  if (new Set(withN.map((s) => s.n)).size !== withN.length) return { violated: false, reason: 'ordinals are not distinct' };
  const ascending = (arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]);
  const navSeq = withN.map((s) => s.n);
  const visSeq = [...withN]
    .sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > band ? a.rect.y - b.rect.y : a.rect.x - b.rect.x))
    .map((s) => s.n);
  if (!ascending(visSeq)) return { violated: false, reason: 'ordinals do not follow the visual reading order either' };
  if (ascending(navSeq)) return { violated: false, reason: 'navigation order follows the ordinals' };
  const CAP = 24;
  return {
    violated: true,
    stops: withN.length,
    navOrdinals: navSeq.slice(0, CAP),
    visualOrdinals: visSeq.slice(0, CAP),
    truncated: navSeq.length > CAP,
  };
}

module.exports = { visualOrderDivergence, assignColumns, intrinsicOrdinalViolation };
