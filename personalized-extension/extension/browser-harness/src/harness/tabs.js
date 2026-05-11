// chrome.tabs wrappers. The agent loop drives the lifecycle of its own
// tabs through these (open, switch, close, ensure-real); the popup-page
// surface uses them too via the bh:* runtime message.

import { BH_INTERNAL } from './constants.js';

export async function bhListTabs({ includeChrome = true } = {}) {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(t => includeChrome || !BH_INTERNAL.some(p => (t.url || '').startsWith(p)))
    .map(t => ({ tabId: t.id, title: t.title || '', url: t.url || '' }));
}

export async function bhCurrentTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t ? { tabId: t.id, title: t.title || '', url: t.url || '' } : null;
}

export async function bhSwitchTab(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.windows.update(t.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { tabId, url: t.url || '', title: t.title || '' };
}

export async function bhNewTab(url = 'about:blank', { active = true } = {}) {
  const t = await chrome.tabs.create({ url, active });
  return { tabId: t.id, url: t.url || url };
}

export async function bhEnsureRealTab() {
  const tabs = await bhListTabs({ includeChrome: false });
  if (!tabs.length) return null;
  const cur = await bhCurrentTab();
  if (cur && cur.url && !BH_INTERNAL.some(p => cur.url.startsWith(p))) return cur;
  return await bhSwitchTab(tabs[0].tabId);
}
