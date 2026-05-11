// Connection + error indicators. Tiny module; here for the same reason
// transcript is its own file -- so the entry point reads cleanly.

export function mountStatus(statusEl, errorEl) {
  function render(snap) {
    statusEl.className = `vp-status ${snap.connection || 'disconnected'}`;
    statusEl.textContent = snap.connection || 'disconnected';
    if (snap.error) {
      errorEl.hidden = false;
      errorEl.textContent = snap.error;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }
  return { render };
}
