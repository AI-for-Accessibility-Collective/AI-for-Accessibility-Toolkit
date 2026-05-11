// chrome.storage shim with SW-proxy fallback.
//
// chrome.storage is documented to be available in offscreen documents
// when the manifest declares the "storage" permission, but at least
// one Chrome build observed in the wild exposes chrome.runtime to the
// offscreen context without chrome.storage at all. To keep the voice
// engine working anywhere, every storage call goes through this shim:
//
//   - HAS_STORAGE -> call chrome.storage[area].{get,set,remove} directly
//   - !HAS_STORAGE -> chrome.runtime.sendMessage to the SW, which
//     performs the operation against its own chrome.storage and replies
//     with the result. For onChanged subscriptions, the SW broadcasts
//     a `voiceProxyStorageChange` runtime message that we re-dispatch
//     to registered listeners.
//
// Only used by code that runs inside the offscreen page. The SW + side
// panel can call chrome.storage directly.

const HAS_STORAGE = !!(globalThis.chrome && chrome.storage);

if (!HAS_STORAGE) {
  // Informational, not an error: the SW-proxy fallback below routes
  // every storage call through chrome.runtime messages to the SW.
  // Logged once per offscreen-page load so anyone debugging knows
  // which code path is in use.
  console.info('[voice] chrome.storage not exposed to offscreen; using SW-proxy fallback (this is expected on some Chrome builds).');
}

const _changeListeners = new Set();
let _forwarderInstalled = false;

function _ensureForwarder() {
  if (HAS_STORAGE || _forwarderInstalled) return;
  _forwarderInstalled = true;
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'voiceProxyStorageChange') return;
    console.log('[voice] storage forwarder received change:', Object.keys(msg.changes || {}));
    for (const fn of _changeListeners) {
      try { fn(msg.changes || {}, msg.area || 'local'); } catch (e) {
        console.warn('[voice] storage listener threw:', e && e.message);
      }
    }
  });
}

function _proxy(op, area, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'voiceProxyStorage', op, area, payload },
        (resp) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ error: err.message });
          else resolve(resp || {});
        },
      );
    } catch (e) {
      resolve({ error: e.message || String(e) });
    }
  });
}

export async function get(area, keys) {
  if (HAS_STORAGE) {
    try { return await chrome.storage[area].get(keys); }
    catch (e) {
      console.warn(`[voice] storage.${area}.get failed:`, e && e.message);
      return {};
    }
  }
  const resp = await _proxy('get', area, keys);
  if (resp.error) {
    console.warn(`[voice] proxy storage.${area}.get failed:`, resp.error);
    return {};
  }
  return resp.data || {};
}

export async function set(area, payload) {
  if (HAS_STORAGE) {
    try { await chrome.storage[area].set(payload); }
    catch (e) { console.warn(`[voice] storage.${area}.set failed:`, e && e.message); }
    return;
  }
  const resp = await _proxy('set', area, payload);
  if (resp.error) console.warn(`[voice] proxy storage.${area}.set failed:`, resp.error);
}

export async function remove(area, key) {
  if (HAS_STORAGE) {
    try { await chrome.storage[area].remove(key); }
    catch (e) { console.warn(`[voice] storage.${area}.remove failed:`, e && e.message); }
    return;
  }
  const resp = await _proxy('remove', area, key);
  if (resp.error) console.warn(`[voice] proxy storage.${area}.remove failed:`, resp.error);
}

// Subscribe to storage changes. Returns an unsubscribe function.
// fn receives (changes, area) just like chrome.storage.onChanged.
export function onChanged(fn) {
  if (HAS_STORAGE) {
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
  }
  _ensureForwarder();
  _changeListeners.add(fn);
  return () => _changeListeners.delete(fn);
}

export { HAS_STORAGE };
