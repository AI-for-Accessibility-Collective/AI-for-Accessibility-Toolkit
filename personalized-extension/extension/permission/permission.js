// User-driven permission grant. The Enable button provides the user
// activation that getUserMedia needs to trigger Chrome's prompt. We
// don't auto-fire on load because programmatically-opened windows
// (chrome.windows.create) carry no user activation -- the prompt would
// be suppressed.
//
// Result is relayed to the side panel via chrome.runtime.sendMessage;
// the window self-closes after success or explicit cancellation.

const allowBtn = document.getElementById('allow');
const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text || '';
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

async function postResult(msg) {
  try { await chrome.runtime.sendMessage(msg); } catch {}
}

allowBtn.addEventListener('click', async () => {
  allowBtn.disabled = true;
  setStatus('Waiting for Chrome’s permission prompt…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    setStatus('Microphone enabled. You can close this window.', 'ok');
    await postResult({ type: 'micPermissionResult', granted: true });
    setTimeout(() => { try { window.close(); } catch {} }, 600);
  } catch (err) {
    const name = (err && err.name) || 'Error';
    const message = (err && err.message) || String(err);
    setStatus(`${name}: ${message}`, 'error');
    allowBtn.disabled = false;
    await postResult({
      type: 'micPermissionResult',
      granted: false,
      errorName: name,
      errorMessage: message,
    });
  }
});

// If the user closes the window without clicking, the side panel's
// chrome.windows.onRemoved listener will detect that and treat it as a
// cancellation -- nothing to send from here.
