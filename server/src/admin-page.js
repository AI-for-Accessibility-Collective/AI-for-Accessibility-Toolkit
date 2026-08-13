// GET /admin — a minimal, dependency-free HTML config page. The page itself
// sits behind the browser's native HTTP Basic login popup (app.js answers an
// unauthenticated GET with 401 + WWW-Authenticate, so the browser prompts,
// caches the credential for the session — remembered by default — and offers
// to save it in the password manager). Every data call below is a plain
// same-origin fetch(): the browser attaches the cached Basic credential
// automatically, so the page holds no password of its own.
export function renderAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Toolkit Service — Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  input, button { font: inherit; padding: .4rem .5rem; }
  input[type=text] { width: 100%; box-sizing: border-box; margin-bottom: .5rem; }
  button { cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; border-bottom: 1px solid #ddd; padding: .35rem .5rem; font-size: .85rem; }
  .row { display: flex; gap: .5rem; align-items: center; }
  .row > * { flex: 1; }
  .row > button { flex: 0 0 auto; }
  #status { font-size: .85rem; color: #555; min-height: 1.2em; }
  #newToken { font-family: ui-monospace, monospace; background: #f5f5f5; padding: .5rem; word-break: break-all; display: none; }
  .revoked { color: #999; text-decoration: line-through; }
</style>
</head>
<body>
<div class="row" style="align-items:baseline">
  <h1 style="flex:1">Toolkit Service — Admin</h1>
  <button id="signOutBtn">Sign out</button>
</div>
<div id="status"></div>

<h2>Create token</h2>
<div class="row">
  <input id="uid" type="text" placeholder="uid">
  <input id="label" type="text" placeholder="label (optional)">
  <button id="createBtn">Create</button>
</div>
<div id="newToken"></div>

<h2>Tokens</h2>
<button id="refreshBtn">Refresh list</button>
<table id="tokensTable">
  <thead><tr><th>uid</th><th>label</th><th>created</th><th>status</th><th></th></tr></thead>
  <tbody></tbody>
</table>

<script>
(function () {
  var statusEl = document.getElementById('status');
  var tbody = document.querySelector('#tokensTable tbody');
  var newTokenEl = document.getElementById('newToken');

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '#555';
  }

  async function api(path, opts) {
    // Same-origin: the browser attaches the Basic credential from its auth
    // cache (the login popup) — no Authorization header handling here.
    var resp = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    var body = null;
    try { body = await resp.json(); } catch (e) {}
    if (!resp.ok) {
      if (resp.status === 401) throw new Error('session expired — reload the page to sign in again');
      throw new Error((body && body.error) || ('HTTP ' + resp.status));
    }
    return body;
  }

  function renderRows(tokens) {
    tbody.innerHTML = '';
    tokens.forEach(function (t) {
      var tr = document.createElement('tr');
      if (t.revoked) tr.className = 'revoked';
      var created = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
      tr.innerHTML =
        '<td></td><td></td><td></td><td></td><td></td>';
      tr.children[0].textContent = t.uid;
      tr.children[1].textContent = t.label || '';
      tr.children[2].textContent = created;
      tr.children[3].textContent = t.revoked ? 'revoked' : 'active';
      if (!t.revoked) {
        var btn = document.createElement('button');
        btn.textContent = 'Revoke';
        btn.onclick = function () { revoke(t.id); };
        tr.children[4].appendChild(btn);
      }
      tbody.appendChild(tr);
    });
  }

  async function refresh() {
    try {
      var tokens = await api('/admin/tokens');
      renderRows(tokens);
      setStatus(tokens.length + ' token(s).');
    } catch (e) {
      setStatus('Failed to list tokens: ' + e.message, true);
    }
  }

  async function create() {
    var uid = document.getElementById('uid').value.trim();
    var label = document.getElementById('label').value.trim();
    if (!uid) { setStatus('uid is required.', true); return; }
    try {
      var result = await api('/admin/tokens', { method: 'POST', body: JSON.stringify({ uid: uid, label: label }) });
      newTokenEl.style.display = 'block';
      newTokenEl.textContent = 'New token for ' + result.uid + ' (shown once): ' + result.token;
      setStatus('Token created.');
      await refresh();
    } catch (e) {
      setStatus('Failed to create token: ' + e.message, true);
    }
  }

  async function revoke(id) {
    try {
      await api('/admin/tokens/' + encodeURIComponent(id), { method: 'DELETE' });
      setStatus('Token revoked.');
      await refresh();
    } catch (e) {
      setStatus('Failed to revoke token: ' + e.message, true);
    }
  }

  async function signOut() {
    // HTTP Basic has no logout API; overwrite the browser's cached credential
    // for this realm with a bogus one, then reload — the reload sends the
    // bogus credential, gets 401, and the login popup reappears.
    try {
      await fetch('/admin/tokens', { headers: { 'Authorization': 'Basic ' + btoa('signout:' + Date.now()) } });
    } catch (e) {}
    location.reload();
  }

  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('createBtn').addEventListener('click', create);
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  refresh(); // signed in already (the page only renders past the popup)
})();
</script>
</body>
</html>
`;
}
