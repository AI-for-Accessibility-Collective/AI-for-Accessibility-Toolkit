// What the side panel's three tabs (Profile, Builder, Settings) share: the
// status line, small DOM helpers, the runtime's service worker, and the tab
// the person is looking at beside the panel.

export const $ = (id) => document.getElementById(id);

export function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function button(text, className, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Ask the runtime's service worker (background.js handlers). */
export async function ask(type, fields = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...fields });
  if (!reply?.ok) throw new Error(reply?.error || 'The runtime did not answer.');
  return reply.result;
}

// The window this panel belongs to, or that of a tab named with ?tab=<id>
// (how a test opens the panel as a page of its own).
export const namedTab = Number(new URLSearchParams(location.search).get('tab'));
export async function sidebarWindowId() {
  if (namedTab) return chrome.tabs.get(namedTab).then(t => t.windowId, () => null);
  return (await chrome.windows.getCurrent()).id;
}
/** The tab the person is looking at beside the panel. */
export async function activeTab() {
  const windowId = await sidebarWindowId();
  if (windowId == null) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab || null;
}
export const isWebPage = (tab) => /^https?:/.test(tab?.url || '');
export const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
export const hostOf = (url) => { try { return new URL(url).host; } catch { return url || ''; } };
export const keyOf = (a) => `${a.adapter.owner}/${a.adapter.appId}/${a.adapter.id}`;
/**
 * The page the Profile and Settings tabs are about: the tab beside the panel,
 * or exactly the tab named with ?tab=<id> when a test opens the panel as a
 * page (in that tab's window, where the panel page is itself the active tab).
 */
export async function pageTab() {
  if (namedTab) return chrome.tabs.get(namedTab).catch(() => null);
  return activeTab();
}
