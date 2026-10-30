// Runs on the connected toolkit's developer console (/developer) only.
//
// The console says "adapters changed" right after a save, which wakes the
// runtime to sync now rather than at its next 30-second alarm. The runtime
// answers with whether it is connected, as whom, and whether user scripts
// are allowed, so the console can show this browser's runtime state. Nothing
// else crosses: never the token, never page content.

// It may run twice in one page (registered for new pages, and injected into
// the console that was open when the extension connected): the second run
// only announces again.
(() => {
if (window.__ai4a11yBridge) { window.__ai4a11yBridge.announce(); return; }

const announce = async () => {
  let status = null;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'status' });
    status = reply?.ok ? reply.result : null;
  } catch { /* the extension is reloading */ }
  window.postMessage({
    source: 'ai4a11y-runtime', type: 'present',
    version: chrome.runtime.getManifest().version,
    connected: !!status?.connection, uid: status?.connection?.uid || null,
    userScripts: status?.state?.scripts?.available === true,
    adapters: (status?.state?.adapters || []).length,
    lastSync: status?.state?.lastSync || null,
    error: status?.state?.error || null,
  }, location.origin);
};

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'ai4a11y-console') return;
  if (message.type === 'adapters-changed') {
    chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {}).finally(announce);
  } else if (message.type === 'ping') {
    announce();
  }
});

announce();

window.__ai4a11yBridge = { announce };
})();
