// Stale-index recovery for indexed actions. Mirrors browser_use's recovery
// behaviour: when click_index/type_index/etc. throw stale_index or
// stale_element, identity-match the original target against a fresh
// enumerate and retry once. Wraps every indexed action core; first call
// runs core(idx); on stale, runs core(newIdx) with _recovered set so
// the wrapper doesn't recurse.

import { _BH_LAST_ITEMS } from '../state.js';
import { bhEnumerateInteractive } from '../interactive.js';

// Recover from a stale index by identity. Re-enumerates, filters items
// to those with the SAME tag + role + visible text as the original
// target, and picks the one whose bbox center is closest to the
// original. Returns the new idx, or null if no match (caller should
// surface the original error to the LLM). Strict tag/role/text match
// avoids clicking the wrong element when the page changes shape; bbox
// proximity disambiguates when multiple identical elements exist (e.g.
// a list of identical "Delete" buttons -- pick the one that moved
// least).
async function _bhResolveStaleByIdentity(tabId, idx) {
  const lastItems = _BH_LAST_ITEMS.get(tabId);
  if (!lastItems || !Array.isArray(lastItems) || idx >= lastItems.length) return null;
  const lastTarget = lastItems[idx];
  if (!lastTarget || !lastTarget.tag) return null;
  let fresh;
  try { fresh = await bhEnumerateInteractive(tabId); } catch { return null; }
  if (!fresh || !Array.isArray(fresh.items)) return null;
  const role = (lastTarget.attrs && lastTarget.attrs.role) || '';
  const text = (lastTarget.text || '').trim();
  const candidates = fresh.items.filter((it) => {
    if (it.tag !== lastTarget.tag) return false;
    const cr = (it.attrs && it.attrs.role) || '';
    if (cr !== role) return false;
    const ct = (it.text || '').trim();
    if (ct !== text) return false;
    return true;
  });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0].idx;
  // Multiple identity matches -- pick the one closest to the original
  // bbox center via Manhattan distance.
  if (!lastTarget.bbox) return candidates[0].idx;
  const ox = lastTarget.bbox.x + lastTarget.bbox.w / 2;
  const oy = lastTarget.bbox.y + lastTarget.bbox.h / 2;
  let chosen = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!c.bbox) continue;
    const cx = c.bbox.x + c.bbox.w / 2;
    const cy = c.bbox.y + c.bbox.h / 2;
    const d = Math.abs(cx - ox) + Math.abs(cy - oy);
    if (d < bestDist) { bestDist = d; chosen = c; }
  }
  return chosen.idx;
}

// Higher-order wrapper for indexed actions: on stale_index / stale_element,
// re-enumerate and find a matching element by identity, then retry once.
// opts._recovered gates against infinite recursion. Annotates the result
// with recoveredFromIdx / recoveredToIdx so callers can log it.
export async function _bhWithStaleRecovery(tabId, idx, opts, label, fn) {
  const o = opts || {};
  if (o._recovered) return await fn(idx, o);
  try {
    return await fn(idx, o);
  } catch (e) {
    if (!/stale_index|stale_element/i.test(e.message || '')) throw e;
    const newIdx = await _bhResolveStaleByIdentity(tabId, idx);
    if (newIdx === null || newIdx === idx) throw e;
    console.log(`[BrowserHarness] ${label}: stale idx ${idx} -> recovered to ${newIdx}`);
    const r = await fn(newIdx, { ...o, _recovered: true });
    if (r && typeof r === 'object') {
      r.recoveredFromIdx = idx;
      r.recoveredToIdx = newIdx;
    }
    return r;
  }
}
