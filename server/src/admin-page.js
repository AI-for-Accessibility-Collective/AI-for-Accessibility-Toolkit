// GET /admin — a minimal, dependency-free HTML config page. The page shell
// itself needs no auth (there is nothing secret in it); every data call
// (list/create/revoke tokens) is a fetch() from the inline vanilla JS below
// carrying `Authorization: Bearer <admin token>`, where the admin token is
// whatever the operator typed into the page's own input field a moment
// earlier — held in a plain JS variable, never written to localStorage,
// cookies, or the DOM outside that input, so it evaporates on reload.
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
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; margin-bottom: .5rem; }
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
<h1>Toolkit Service — Admin</h1>
<p>The admin token below is kept only in this page's memory (a JS variable) — it is never
   persisted. Re-entering it is required after every reload.</p>

<label for="adminPassword">Admin password</label>
<input id="adminPassword" type="password" placeholder="enter the admin password" autocomplete="off">
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
  var tokenEl = document.getElementById('adminPassword');
  var statusEl = document.getElementById('status');
  var tbody = document.querySelector('#tokensTable tbody');
  var newTokenEl = document.getElementById('newToken');

  function adminPassword() { return tokenEl.value.trim(); }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '#555';
  }

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + adminPassword(), 'Content-Type': 'application/json' };
  }

  async function api(path, opts) {
    var resp = await fetch(path, Object.assign({ headers: authHeaders() }, opts || {}));
    var body = null;
    try { body = await resp.json(); } catch (e) {}
    if (!resp.ok) {
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
    if (!adminPassword()) { setStatus('Enter the admin password first.', true); return; }
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
    if (!adminPassword()) { setStatus('Enter the admin password first.', true); return; }
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
    if (!adminPassword()) { setStatus('Enter the admin password first.', true); return; }
    try {
      await api('/admin/tokens/' + encodeURIComponent(id), { method: 'DELETE' });
      setStatus('Token revoked.');
      await refresh();
    } catch (e) {
      setStatus('Failed to revoke token: ' + e.message, true);
    }
  }

  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('createBtn').addEventListener('click', create);
})();
</script>
</body>
</html>
`;
}
