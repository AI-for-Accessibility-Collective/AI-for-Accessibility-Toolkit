/* Browser-harness client -- extension-page side.
 *
 * chrome.debugger only works in the service worker, so this module proxies
 * every call through chrome.runtime.sendMessage({ type: 'bh', op, args }).
 * Same primitives as helpers.py / harness.js, returning Promises.
 *
 * Use from any extension page (skill-builder, onboarding, popup):
 *
 *   import { harness } from '../browser-harness/client.js';
 *   const t = await harness.currentTab();
 *   await harness.gotoUrl(t.tabId, 'https://example.com');
 *   await harness.waitForLoad(t.tabId);
 *   const png = await harness.captureScreenshot(t.tabId);
 */

function bhCall(op, args = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'bh', op, args }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!resp) return reject(new Error('no response from background'));
      if (resp.error) return reject(new Error(resp.error));
      resolve(resp.result);
    });
  });
}

export const harness = {
  attach: (tabId) => bhCall('attach', { tabId }),
  detach: (tabId) => bhCall('detach', { tabId }),
  cdp: (tabId, method, params) => bhCall('cdp', { tabId, method, params }),
  drainEvents: (tabId) => bhCall('drainEvents', { tabId }),

  gotoUrl: (tabId, url) => bhCall('gotoUrl', { tabId, url }),
  pageInfo: (tabId) => bhCall('pageInfo', { tabId }),
  pendingDialog: (tabId) => bhCall('pendingDialog', { tabId }),
  handleDialog: (tabId, accept = true, promptText = null) =>
    bhCall('handleDialog', { tabId, accept, promptText }),

  clickAt: (tabId, x, y, opts = {}) => bhCall('clickAt', { tabId, x, y, button: opts.button, clicks: opts.clicks }),
  typeText: (tabId, text) => bhCall('typeText', { tabId, text }),
  fillInput: (tabId, selector, text, opts = {}) =>
    bhCall('fillInput', { tabId, selector, text, clearFirst: opts.clearFirst !== false, timeoutMs: opts.timeoutMs || 0 }),
  pressKey: (tabId, key, modifiers = 0) => bhCall('pressKey', { tabId, key, modifiers }),
  scroll: (tabId, x, y, dy = -300, dx = 0) => bhCall('scroll', { tabId, x, y, dy, dx }),

  captureScreenshot: (tabId, opts = {}) =>
    bhCall('captureScreenshot', {
      tabId,
      full: !!opts.full,
      maxDim: opts.maxDim ?? null,
      cssNormalize: !!opts.cssNormalize,
    }),

  listTabs: (opts = {}) => bhCall('listTabs', { includeChrome: opts.includeChrome !== false }),
  currentTab: () => bhCall('currentTab'),
  switchTab: (tabId) => bhCall('switchTab', { tabId }),
  newTab: (url, opts = {}) => bhCall('newTab', { url, active: opts.active !== false }),
  ensureRealTab: () => bhCall('ensureRealTab'),
  iframeTarget: (tabId, urlSubstr) => bhCall('iframeTarget', { tabId, urlSubstr }),

  js: (tabId, expression, opts = {}) =>
    bhCall('js', { tabId, expression, iframeTargetId: opts.iframeTargetId || null }),
  dispatchKey: (tabId, selector, key = 'Enter', event = 'keypress') =>
    bhCall('dispatchKey', { tabId, selector, key, event }),
  uploadFile: (tabId, selector, files) => bhCall('uploadFile', { tabId, selector, files }),

  wait: (ms = 1000) => new Promise((r) => setTimeout(r, ms)),
  waitForLoad: (tabId, opts = {}) => bhCall('waitForLoad', { tabId, timeoutMs: opts.timeoutMs }),
  waitForElement: (tabId, selector, opts = {}) =>
    bhCall('waitForElement', { tabId, selector, timeoutMs: opts.timeoutMs ?? 10000, visible: !!opts.visible }),
  waitForNetworkIdle: (tabId, opts = {}) =>
    bhCall('waitForNetworkIdle', { tabId, timeoutMs: opts.timeoutMs ?? 10000, idleMs: opts.idleMs ?? 500 }),
  httpGet: (url, headers = null) => bhCall('httpGet', { url, headers }),
};

// Agent loop runs in the service worker so it survives the popup closing.
// Progress is persisted to chrome.storage.local.bhAgent; subscribe via
// chrome.storage.onChanged to render live updates.
function bhSend(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!resp) return reject(new Error('no response from background'));
      if (resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

export const agent = {
  start: (task, opts = {}) =>
    bhSend({ type: 'bhAgentStart', task, tabId: opts.tabId, maxSteps: opts.maxSteps }),
  stop: () => bhSend({ type: 'bhAgentStop' }),
  clear: () => bhSend({ type: 'bhAgentClear' }),
  /** Read the current persisted state. */
  state: async () => {
    const cur = await chrome.storage.local.get('bhAgent');
    return cur.bhAgent || null;
  },
};

// Markdown knowledge files (interaction patterns + per-host playbooks).
// Backed by bundled files under browser-harness-orig/ plus agent-written
// content in chrome.storage.local.bhSkills. See skills.js.
export const skills = {
  listInteraction: () => bhCall('listInteractionSkills', {}),
  listDomain: (hostname) => bhCall('listDomainSkills', { hostname }),
  read: (kind, name, host) => bhCall('readSkill', { kind, name, host }),
  write: (kind, name, content, host) => bhCall('writeSkill', { kind, name, content, host }),
  remove: (kind, name, host) => bhCall('deleteSkill', { kind, name, host }),
};

export default harness;
