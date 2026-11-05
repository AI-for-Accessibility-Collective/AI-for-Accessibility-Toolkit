// Runs on the connected toolkit's developer console (/developer) only.
//
// The console says "adapters changed" right after a save, and "profile
// changed" after it writes the profile (Load profile, Apply), which wakes the
// runtime to sync now rather than at its next 30-second alarm. The runtime
// answers with whether it is connected, as whom, and whether user scripts
// are allowed, so the console can show this browser's runtime state. Nothing
// else crosses: never the token, never page content.

// It may run twice in one page (registered for new pages, and injected into
// the console that was open when the extension connected): the second run
// only announces again.
//
// When the extension is reloaded or updated, a bridge already in an open
// console is cut off from it ("Extension context invalidated": chrome.runtime
// throws, and has no id). That bridge then stops listening and steps aside,
// so the new extension's bridge, injected into the same page, takes over.
(() => {
if (window.__ai4a11yBridge?.alive()) { window.__ai4a11yBridge.announce(); return; }

const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
function retire() {
  window.removeEventListener('message', onMessage);
  if (window.__ai4a11yBridge?.announce === announce) delete window.__ai4a11yBridge;
}

async function announce() {
  if (!alive()) return retire();
  let status = null, version = null;
  try {
    version = chrome.runtime.getManifest().version;
    const reply = await chrome.runtime.sendMessage({ type: 'status' });
    status = reply?.ok ? reply.result : null;
  } catch { /* the extension is reloading */ }
  if (!alive()) return retire();
  window.postMessage({
    source: 'ai4a11y-runtime', type: 'present',
    version,
    connected: !!status?.connection, uid: status?.connection?.uid || null,
    userScripts: status?.state?.scripts?.available === true,
    adapters: (status?.state?.adapters || []).length,
    lastSync: status?.state?.lastSync || null,
    error: status?.state?.error || null,
  }, location.origin);
}

function onMessage(event) {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'ai4a11y-console') return;
  if (!alive()) return retire();
  if (message.type === 'adapters-changed' || message.type === 'profile-changed') {
    // A cut-off context throws here rather than rejecting.
    let sent;
    try { sent = chrome.runtime.sendMessage({ type: 'sync' }); } catch { return retire(); }
    Promise.resolve(sent).catch(() => {}).finally(announce);
  } else if (message.type === 'ping') {
    announce();
  }
}
window.addEventListener('message', onMessage);

window.__ai4a11yBridge = { announce, alive };
announce();
})();
