// Options page for "remote toolkit server" mode. Reads/writes the two
// chrome.storage.sync keys background.js's remoteIfConfigured() checks
// (toolkitServerUrl, toolkitServerToken — server/CONTRACT.md "Extension
// remote mode") and offers a "Test connection" round-trip against
// GET /v1/whoami via the same RemoteLibrarian client background.js uses
// (loaded here as a plain <script>, same classic-IIFE file).
(function () {
  const STORAGE_KEYS = ['toolkitServerUrl', 'toolkitServerToken'];

  const form = document.getElementById('serverForm');
  const urlInput = document.getElementById('serverUrl');
  const tokenInput = document.getElementById('serverToken');
  const showToken = document.getElementById('showToken');
  const testBtn = document.getElementById('testBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const modeEl = document.getElementById('modeSummary');

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind ? `status-${kind}` : '';
  }

  function describeMode(cfg) {
    const url = (cfg.toolkitServerUrl || '').trim();
    const token = (cfg.toolkitServerToken || '').trim();
    if (url && token) return `Remote mode: using ${url}`;
    return 'Local mode: using the on-device librarian (no server configured).';
  }

  async function readSaved() {
    return chrome.storage.sync.get(STORAGE_KEYS);
  }

  // Point RemoteLibrarian's module-level config at whatever is actually
  // SAVED (not just typed into the fields) — this page's RemoteLibrarian
  // instance is separate from the service worker's, but keeping it in sync
  // with storage avoids a stale "Test connection" pointing somewhere the
  // extension itself no longer uses.
  async function syncClientToSaved() {
    const saved = await readSaved();
    const url = (saved.toolkitServerUrl || '').trim();
    const token = (saved.toolkitServerToken || '').trim();
    window.RemoteLibrarian?.configure?.(url && token ? { url, token } : {});
  }

  async function load() {
    const cfg = await readSaved();
    urlInput.value = cfg.toolkitServerUrl || '';
    tokenInput.value = cfg.toolkitServerToken || '';
    modeEl.textContent = describeMode(cfg);
    await syncClientToSaved();
  }

  showToken.addEventListener('change', () => {
    tokenInput.type = showToken.checked ? 'text' : 'password';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();
    if (!url || !token) {
      setStatus('Enter both a server URL and an access token before saving — or use "Use local (clear)" to go back to local mode.', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setStatus('Server URL must start with http:// or https://.', 'error');
      return;
    }
    await chrome.storage.sync.set({ toolkitServerUrl: url, toolkitServerToken: token });
    modeEl.textContent = describeMode({ toolkitServerUrl: url, toolkitServerToken: token });
    setStatus('Saved. This device now uses the remote toolkit server.', 'success');
    await syncClientToSaved();
  });

  testBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();
    if (!url || !token) {
      setStatus('Enter a server URL and access token to test.', 'error');
      return;
    }
    if (!window.RemoteLibrarian) {
      setStatus('Test connection is unavailable (remote-librarian.js did not load).', 'error');
      return;
    }
    testBtn.disabled = true;
    setStatus('Testing connection…');
    try {
      window.RemoteLibrarian.configure({ url, token });
      const who = await window.RemoteLibrarian.whoami();
      setStatus(`Connected as ${who.label || who.uid} (uid: ${who.uid}).`, 'success');
    } catch (err) {
      setStatus(`Connection failed: ${err.message}`, 'error');
    } finally {
      testBtn.disabled = false;
      await syncClientToSaved();
    }
  });

  clearBtn.addEventListener('click', async () => {
    await chrome.storage.sync.remove(STORAGE_KEYS);
    urlInput.value = '';
    tokenInput.value = '';
    window.RemoteLibrarian?.configure?.({});
    modeEl.textContent = describeMode({});
    setStatus('Cleared. This device is back to local mode.', 'success');
  });

  load();
})();
