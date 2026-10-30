// The admin console. The page is served only past the browser's HTTP Basic
// prompt, and every fetch below is same-origin, so the browser attaches that
// cached credential itself: this script holds no password. POSTs send JSON,
// which the service requires of browser admin requests (its CSRF guard).

const $ = id => document.getElementById(id);
let lastCredentials = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

function setStatus(message, isError = false) {
  $('status').textContent = message || '';
  $('status').classList.toggle('error', isError);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your admin sign-in expired. Reload the page to sign in again.');
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function act(task) {
  try { await task(); } catch (error) { setStatus(error.message, true); }
}

const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

// Why an account's password cannot be shown (GET …/password `reason`).
const NOT_SHOWN = {
  'changed-by-account': 'Changed by the account itself, so it is not kept. Reset it to issue a new one.',
  'not-kept': 'Issued before passwords were kept. Reset it to issue a new one.',
  'unreadable': 'Kept under an earlier secret. Reset it to issue a new one.',
};

// ── tabs ───────────────────────────────────────────────────────────────────

const tabs = ['accounts', 'tokens', 'data'];
function showTab(name, focus = false) {
  for (const t of tabs) {
    const tab = $(`tab-${t}`);
    const selected = t === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`panel-${t}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  if (name === 'accounts') act(loadAccounts);
  if (name === 'tokens') act(loadTokens);
  if (name === 'data') act(loadUsers);
}
for (const t of tabs) {
  $(`tab-${t}`).addEventListener('click', () => showTab(t));
  $(`tab-${t}`).addEventListener('keydown', (event) => {
    const i = tabs.indexOf(t);
    if (event.key === 'ArrowRight') showTab(tabs[(i + 1) % tabs.length], true);
    if (event.key === 'ArrowLeft') showTab(tabs[(i + tabs.length - 1) % tabs.length], true);
  });
}

// ── accounts ───────────────────────────────────────────────────────────────

function showCredentials(rows, heading = 'New sign-in details') {
  lastCredentials = rows;
  $('credentials-heading').textContent = heading;
  const table = element('table', 'credentials');
  table.innerHTML = '<thead><tr><th scope="col">Username</th><th scope="col">Name</th><th scope="col">Password</th></tr></thead>';
  const tbody = element('tbody');
  for (const r of rows) {
    const tr = element('tr');
    const pw = element('td');
    pw.append(r.password ? element('code', '', r.password) : element('span', 'muted', r.note || '(the one you chose)'));
    tr.append(element('td', '', r.uid), element('td', '', r.displayName || ''), pw);
    tbody.append(tr);
  }
  table.append(tbody);
  const sign = element('p', 'hint', `Sign in at ${location.origin}/developer`);
  $('credentials-body').replaceChildren(table, sign);
  $('credentials').hidden = false;
  $('credentials').scrollIntoView({ block: 'nearest' });
}

async function loadAccounts() {
  const { accounts } = await api('/admin/accounts');
  $('account-count').textContent = String(accounts.length);
  const tbody = document.querySelector('#accounts-table tbody');
  tbody.replaceChildren();
  if (!accounts.length) {
    const tr = element('tr');
    const td = element('td', 'empty', 'No accounts yet. Make one above.');
    td.colSpan = 6;
    tr.append(td);
    tbody.append(tr);
  }
  for (const a of accounts) {
    const tr = element('tr');
    const who = element('td');
    who.append(element('strong', '', a.displayName), element('div', 'muted', a.uid));
    const secret = element('div', 'password-reveal');
    if (a.passwordSetBy === 'account') secret.append(element('span', 'muted', 'Password set by the account'));
    else {
      const label = (shown) => {
        show.textContent = shown ? 'Hide password' : 'Show password';
        show.setAttribute('aria-label', `${show.textContent} for ${a.uid}`);
        show.setAttribute('aria-expanded', String(shown));
      };
      const show = button('text-button', '', () => act(async () => {
        if (secret.querySelector('code')) { secret.querySelector('code').remove(); label(false); return; }
        const r = await api(`/admin/accounts/${encodeURIComponent(a.uid)}/password`);
        if (r.password == null) { setStatus(`${a.uid}: ${NOT_SHOWN[r.reason] || 'Not available.'}`, true); return; }
        secret.prepend(element('code', '', r.password));
        label(true);
      }));
      label(false);
      secret.append(show);
    }
    who.append(secret);
    const state = element('td');
    state.append(element('span', `badge ${a.disabled ? 'warn' : 'connected'}`, a.disabled ? 'Off' : 'On'));
    const actions = element('td');
    const row = element('div', 'row-actions');
    row.append(button('secondary small', 'Reset password', () => act(async () => {
      if (!confirm(`Make a new password for ${a.uid}? They are signed out everywhere.`)) return;
      const r = await api(`/admin/accounts/${encodeURIComponent(a.uid)}/password`, { method: 'POST', body: {} });
      showCredentials([{ uid: a.uid, displayName: a.displayName, password: r.password }], 'New password');
      setStatus(`New password for ${a.uid}. It is shown once.`);
      await loadAccounts();
    }), `Reset password for ${a.uid}`));
    row.append(button('secondary small', a.disabled ? 'Turn on' : 'Turn off', () => act(async () => {
      if (!a.disabled && !confirm(`Turn off ${a.uid}? Their tokens are revoked and their apps disconnect.`)) return;
      await api(`/admin/accounts/${encodeURIComponent(a.uid)}/${a.disabled ? 'enable' : 'disable'}`, { method: 'POST', body: {} });
      setStatus(a.disabled ? `${a.uid} is on again. They get a new default token when they sign in.` : `${a.uid} is turned off.`);
      await loadAccounts();
    }), `${a.disabled ? 'Turn on' : 'Turn off'} ${a.uid}`));
    row.append(button('delete small', 'Delete', () => act(async () => {
      if (!confirm(`Delete ${a.uid}? This removes the account, its profile data and its tokens. It cannot be undone.`)) return;
      await api(`/admin/accounts/${encodeURIComponent(a.uid)}`, { method: 'DELETE' });
      setStatus(`Deleted ${a.uid} and its data.`);
      await loadAccounts();
    }), `Delete ${a.uid}`));
    actions.append(row);
    tr.append(who, state, element('td', '', when(a.lastLoginAt)), element('td', '', `${a.appTokens} app · ${a.sessions} signed in`), element('td', '', String(a.liveApps)), actions);
    tbody.append(tr);
  }
}

$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  act(async () => {
    const body = { uid: $('new-uid').value.trim(), displayName: $('new-name').value.trim() };
    if ($('new-password').value) body.password = $('new-password').value;
    const r = await api('/admin/accounts', { method: 'POST', body });
    showCredentials([{ uid: r.account.uid, displayName: r.account.displayName, password: r.password }]);
    $('create-form').reset();
    setStatus(`Made ${r.account.uid}.`);
    await loadAccounts();
  });
});

$('bulk-fill').addEventListener('click', () => {
  $('bulk-rows').value = Array.from({ length: 10 }, (_, i) => `team-${i + 1}, Team ${i + 1}`).join('\n');
});

$('bulk-form').addEventListener('submit', (event) => {
  event.preventDefault();
  act(async () => {
    const rows = $('bulk-rows').value.split('\n').map(line => line.trim()).filter(Boolean).map((line) => {
      const [uid, ...rest] = line.split(',');
      return { uid: uid.trim(), displayName: rest.join(',').trim() };
    });
    if (!rows.length) throw new Error('Write at least one username.');
    setStatus(`Making ${rows.length} accounts…`);
    const { results } = await api('/admin/accounts/bulk', { method: 'POST', body: { accounts: rows } });
    const made = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    if (made.length) showCredentials(made);
    setStatus(`Made ${made.length} account${made.length === 1 ? '' : 's'}.${failed.length ? ` Skipped ${failed.length}: ${failed.map(f => `${f.uid || '(blank)'} (${f.message})`).join('; ')}` : ''}`, made.length === 0 && failed.length > 0);
    if (made.length) $('bulk-rows').value = failed.map(f => f.uid).join('\n');
    await loadAccounts();
  });
});

$('show-all-passwords').addEventListener('click', () => act(async () => {
  const { passwords } = await api('/admin/accounts?passwords=1');
  if (!passwords.length) throw new Error('No accounts yet.');
  showCredentials(passwords.map(p => ({ ...p, note: p.password == null ? NOT_SHOWN[p.reason] : undefined })), 'Sign-in details');
  const missing = passwords.filter(p => p.password == null).length;
  setStatus(`Showing ${passwords.length - missing} password${passwords.length - missing === 1 ? '' : 's'}.${missing ? ` ${missing} cannot be shown; reset ${missing === 1 ? 'it' : 'them'} to issue new ones.` : ''}`);
}));

$('credentials-copy').addEventListener('click', () => act(async () => {
  const text = lastCredentials.map(r => `${r.uid}\t${r.displayName || ''}\t${r.password || ''}`).join('\n');
  await navigator.clipboard.writeText(`Sign in at ${location.origin}/developer\n\nusername\tname\tpassword\n${text}\n`);
  setStatus('Copied the sign-in details.');
}));
$('credentials-print').addEventListener('click', () => window.print());
$('credentials-close').addEventListener('click', () => { $('credentials').hidden = true; lastCredentials = []; $('credentials-body').replaceChildren(); });

// ── tokens ─────────────────────────────────────────────────────────────────

async function loadTokens() {
  const tokens = await api('/admin/tokens');
  const showSessions = $('show-sessions').checked;
  const tbody = document.querySelector('#tokensTable tbody');
  tbody.replaceChildren();
  const shown = tokens.filter(t => showSessions || t.kind !== 'session').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const t of shown) {
    const expired = t.expiresAt && t.expiresAt <= Date.now();
    const tr = element('tr', t.revoked ? 'revoked-row' : '');
    const cell = element('td');
    if (!t.revoked && !expired) cell.append(button('delete small', 'Revoke', () => act(async () => {
      await api(`/admin/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      setStatus('Token revoked. Apps using it are disconnected.');
      await loadTokens();
    }), `Revoke ${t.label || t.uid}`));
    tr.append(element('td', '', t.uid), element('td', '', t.label || ''), element('td', '', t.kind || 'app'), element('td', '', when(t.createdAt)), element('td', '', t.revoked ? 'revoked' : expired ? 'expired' : 'active'), cell);
    tbody.append(tr);
  }
  setStatus(`${tokens.length} token(s).`);
}

$('token-form').addEventListener('submit', (event) => {
  event.preventDefault();
  act(async () => {
    const uid = $('uid').value.trim();
    if (!uid) throw new Error('uid is required.');
    const result = await api('/admin/tokens', { method: 'POST', body: { uid, label: $('label').value.trim() } });
    const box = $('newToken');
    box.hidden = false;
    box.replaceChildren(element('strong', '', `New token for ${result.uid} (shown once):`), element('code', 'token-value', result.token));
    setStatus('Token created.');
    await loadTokens();
  });
});
$('refreshBtn').addEventListener('click', () => act(loadTokens));
$('show-sessions').addEventListener('change', () => act(loadTokens));

// ── stored data ────────────────────────────────────────────────────────────

async function loadUsers() {
  const { users } = await api('/admin/users');
  const list = $('users-list');
  list.replaceChildren();
  if (!users.length) list.append(element('li', 'empty', 'No stored profiles.'));
  for (const uid of users) {
    const li = element('li', 'row-actions');
    li.append(element('code', '', uid), button('delete small', 'Delete data', () => act(async () => {
      if (!confirm(`Delete everything stored for ${uid}? Its tokens are revoked. This cannot be undone.`)) return;
      await api(`/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      setStatus(`Deleted the data for ${uid}.`);
      await loadUsers();
    }), `Delete data for ${uid}`));
    list.append(li);
  }
}
$('data-refresh').addEventListener('click', () => act(loadUsers));

// ── sign out ───────────────────────────────────────────────────────────────

$('signOutBtn').addEventListener('click', async () => {
  // HTTP Basic has no logout API; overwrite the browser's cached credential
  // for this realm with a bogus one, then reload — the reload sends the bogus
  // credential, gets 401, and the login prompt reappears.
  try { await fetch('/admin/tokens', { headers: { authorization: `Basic ${btoa(`signout:${Date.now()}`)}` } }); } catch { /* reload anyway */ }
  location.reload();
});

showTab('accounts');
