// Tab grouping + popup-redirect + about:blank guard. The chrome.tabs
// listeners installed at module-eval time handle target=_blank /
// window.open spawns: redirect their URL into the agent's existing tab
// and close the popup. This keeps one debugger session, one screenshot
// stream, and stops the loop from re-clicking the same link forever.

import { BH_AGENT_GROUP_COLORS, BH_AGENT_COLOR_KEY } from './constants.js';
import {
  _bhAgentOwnedTabs,
  _bhAgentSwallow,
  setTabId,
  getTabId,
  setGroupId,
  getGroupId,
  setCreatingTab,
  isCreatingTab,
  isRunning,
  _bhAgentTruncate,
  _bhAgentLog,
} from './state.js';

export async function _bhAgentGroupTab(tabId, task, existingGroupId = null) {
  if (!chrome.tabs?.group || !chrome.tabGroups?.update) return null;
  try {
    const groupId = existingGroupId != null
      ? await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroupId })
      : await chrome.tabs.group({ tabIds: [tabId] });
    if (existingGroupId == null) {
      const data = await chrome.storage.local.get(BH_AGENT_COLOR_KEY);
      const idx = (data[BH_AGENT_COLOR_KEY] || 0) % BH_AGENT_GROUP_COLORS.length;
      await chrome.storage.local.set({ [BH_AGENT_COLOR_KEY]: idx + 1 });
      await chrome.tabGroups.update(groupId, {
        title: _bhAgentTruncate(task, 40),
        color: BH_AGENT_GROUP_COLORS[idx],
      });
    }
    return groupId;
  } catch (e) {
    console.warn('[BrowserAgent] group tab failed:', e.message);
    return null;
  }
}

// target=_blank / window.open spawns a new tab whose openerTabId points
// back to ours. Rather than chasing the new target with a fresh CDP
// attach, redirect the URL into the existing agent tab and close the
// popup -- keeps one debugger session, one screenshot stream, and stops
// the loop from re-clicking the same link forever.
async function _bhAgentRedirectInto(newTabId, url) {
  if (!getTabId()) return;
  try {
    await globalThis.BrowserHarness.gotoUrl(getTabId(), url);
    try { await chrome.tabs.remove(newTabId); } catch {}
    await _bhAgentLog({ kind: 'info', text: `Caught popup → ${url}` });
  } catch (e) {
    console.warn('[BrowserAgent] redirect failed:', e.message);
  }
}

function _bhAgentOnTabCreated(tab) {
  if (!isRunning() || isCreatingTab()) return;
  if (_bhAgentOwnedTabs.has(tab.id)) return;
  // Only swallow popups whose opener is one of the agent's tabs --
  // user-initiated tabs in other windows are left alone.
  if (!_bhAgentOwnedTabs.has(tab.openerTabId)) return;
  _bhAgentSwallow.add(tab.id);
  const url = tab.pendingUrl || tab.url;
  if (url && url !== 'about:blank' && url !== 'chrome://newtab/') {
    _bhAgentSwallow.delete(tab.id);
    _bhAgentRedirectInto(tab.id, url);
  }
}

function _bhAgentOnTabUpdated(tabId, changeInfo) {
  if (!_bhAgentSwallow.has(tabId)) return;
  const url = changeInfo.url || changeInfo.pendingUrl;
  if (!url || url === 'about:blank' || url === 'chrome://newtab/') return;
  _bhAgentSwallow.delete(tabId);
  _bhAgentRedirectInto(tabId, url);
}

function _bhAgentOnTabRemoved(tabId) {
  _bhAgentOwnedTabs.delete(tabId);
  _bhAgentSwallow.delete(tabId);
  if (getTabId() === tabId) {
    // If the user closed the agent's current tab, fall back to any other
    // owned tab so the loop has somewhere to keep working. If none are
    // left, _bhAgentEnsureUsableTab opens a fresh about:blank at the top
    // of the next step.
    const fallback = _bhAgentOwnedTabs.values().next().value;
    setTabId(fallback || null);
  }
}

// Proactive about:blank guard. Mirrors browser_use's aboutblank_watchdog --
// if every owned tab has been closed (or the very first iteration starts
// without one), open a fresh tab in the agent's group so the next
// captureScreenshot has something to point at instead of failing the run.
export async function _bhAgentEnsureUsableTab(task) {
  if (getTabId()) return;
  const H = globalThis.BrowserHarness;
  if (!H || !H.newTab) return;
  setCreatingTab(true);
  try {
    const created = await H.newTab('about:blank', { active: false });
    if (!created || created.tabId == null) return;
    _bhAgentOwnedTabs.add(created.tabId);
    setTabId(created.tabId);
    setGroupId(await _bhAgentGroupTab(created.tabId, task, getGroupId()));
    await _bhAgentLog({
      kind: 'info',
      text: 'No usable tab; opened fresh about:blank.',
    });
  } catch (e) {
    console.warn('[BrowserAgent] ensureUsableTab failed:', e.message);
  } finally {
    setCreatingTab(false);
  }
}

if (chrome.tabs?.onCreated && !chrome.tabs.onCreated._bhAgentInstalled) {
  chrome.tabs.onCreated.addListener(_bhAgentOnTabCreated);
  chrome.tabs.onUpdated.addListener(_bhAgentOnTabUpdated);
  chrome.tabs.onRemoved.addListener(_bhAgentOnTabRemoved);
  chrome.tabs.onCreated._bhAgentInstalled = true;
}
