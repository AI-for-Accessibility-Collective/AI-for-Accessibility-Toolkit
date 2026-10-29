// The Account & tokens page: the default token every app uses, extra app
// tokens that can be revoked on their own, and the password. Needs a
// sign-in session; a console connected with a bare token shows why not.

const $ = id => document.getElementById(id);

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

function field(id, labelText, input) {
  const group = element('div', 'input-group');
  const label = element('label', '', labelText);
  label.htmlFor = id;
  input.id = id;
  group.append(label, input);
  return group;
}

export function createAccountPage({ getClient, isSession, status, run, onDefaultToken }) {
  let overview = null;
  let revealed = null; // {label, token} of a just-created token, shown once

  async function refresh() {
    if (!getClient() || !isSession()) { overview = null; render(); return; }
    try {
      overview = await getClient().account.get();
      onDefaultToken(overview.defaultToken, overview.account);
      render();
    } catch (error) {
      status(error.message, true);
    }
  }

  function tokenBox(token, { copyLabel = 'Copy token', extra } = {}) {
    const box = element('div', 'token-box');
    box.append(element('code', 'token-value', token));
    const actions = element('div', 'card-actions');
    actions.append(button('secondary', copyLabel, () => run(async () => {
      await navigator.clipboard.writeText(token);
      status('Token copied. Paste it into your app’s toolkit settings.');
    })));
    if (extra) actions.append(extra);
    box.append(actions);
    return box;
  }

  // A panel in the Profiles editor's style: eyebrow, heading, optional badge.
  function panel(eyebrow, heading, badge, extraClass = '') {
    const section = element('section', `panel account-panel${extraClass ? ` ${extraClass}` : ''}`);
    const id = `account-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    section.setAttribute('aria-labelledby', id);
    const head = element('div', 'section-heading');
    const titles = element('div');
    titles.append(element('p', 'eyebrow', eyebrow));
    const h2 = element('h2', '', heading); h2.id = id;
    titles.append(h2);
    head.append(titles);
    if (badge) head.append(badge);
    section.append(head);
    return section;
  }

  function render() {
    const body = $('account-body');
    body.replaceChildren();
    if (!getClient()) { body.append(element('p', 'empty', 'Sign in to see your account and tokens.')); return; }
    if (!isSession()) { body.append(element('p', 'empty', 'You connected with an access token, so there is no account to manage here. Sign in with a username and password to see your default token and make new ones.')); return; }
    if (!overview) { body.append(element('p', 'empty', 'Loading…')); return; }

    const grid = element('div', 'account-grid');

    // Default token
    const def = panel('FOR YOUR APPS', 'Default token', element('span', 'badge connected', 'Active'));
    def.append(element('p', 'hint', 'Every app and adapter you build uses this token to reach your toolkit: it reads your profile, and it lists your app under Apps. It stays the same each time you sign in.'));
    def.append(tokenBox(overview.defaultToken, {
      extra: button('text-button', 'Make a new default token', () => run(async () => {
        if (!confirm('Make a new default token? Apps using the old one stop working until you give them the new one.')) return;
        const token = await getClient().account.rotateDefaultToken();
        await refresh();
        status('Made a new default token. Apps using the old one are disconnected.');
        onDefaultToken(token, overview.account);
      })),
    }));
    grid.append(def);

    // Account
    const acct = panel('SIGNED IN', overview.account.displayName || overview.account.uid, element('span', 'badge', `${overview.liveApps ?? 0} app${overview.liveApps === 1 ? '' : 's'} live`));
    const dl = element('dl', 'account-facts');
    for (const [k, v] of [['Username', overview.account.uid], ['Signed in until', overview.session?.expiresAt ? new Date(overview.session.expiresAt).toLocaleString() : '—']]) {
      dl.append(element('dt', '', k), element('dd', '', v));
    }
    acct.append(dl);
    const pw = element('form', 'password-form');
    pw.append(element('h3', '', 'Change password'));
    const current = element('input'); current.type = 'password'; current.autocomplete = 'current-password'; current.required = true;
    const next = element('input'); next.type = 'password'; next.autocomplete = 'new-password'; next.required = true; next.minLength = 8;
    const fields = element('div', 'editor-meta');
    fields.append(field('pw-current', 'Current password', current), field('pw-next', 'New password (8+ characters)', next));
    pw.append(fields);
    const save = element('button', 'secondary', 'Change password'); save.type = 'submit';
    const saveRow = element('div', 'card-actions');
    saveRow.append(save, element('span', 'hint', 'Other browsers signed in to this account are signed out.'));
    pw.append(saveRow);
    pw.addEventListener('submit', (event) => {
      event.preventDefault();
      run(async () => {
        await getClient().account.changePassword(current.value, next.value);
        pw.reset();
        status('Password changed. Other browsers signed in to this account are signed out.');
      });
    });
    acct.append(pw);
    grid.append(acct);

    // App tokens
    const appTokens = overview.tokens.filter(t => t.kind !== 'default');
    const apps = panel('OPTIONAL', 'App tokens', element('span', 'count', String(appTokens.filter(t => !t.revoked).length)), 'account-wide');
    apps.append(element('p', 'hint', 'Give an app its own token when you want to cut off just that app later. A new token is shown once.'));
    if (revealed) {
      const box = element('div', 'new-secret');
      box.append(element('strong', '', `New token “${revealed.label}” — copy it now, it is not shown again.`), tokenBox(revealed.token));
      apps.append(box);
    }
    const form = element('form', 'token-form');
    const label = element('input'); label.maxLength = 120; label.placeholder = 'e.g. My XR prototype';
    form.append(field('new-token-label', 'Label', label));
    const make = element('button', 'secondary', 'Make app token'); make.type = 'submit';
    form.append(make);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      run(async () => {
        const made = await getClient().account.createToken(label.value.trim());
        revealed = { label: made.label, token: made.token };
        await refresh();
        status(`Made app token “${made.label}”. Copy it now: it is shown once.`);
      });
    });
    apps.append(form);
    if (!appTokens.length) {
      apps.append(element('p', 'empty', 'No app tokens yet. Your apps can all use the default token.'));
    } else {
      const table = element('table', 'token-table');
      table.innerHTML = '<thead><tr><th scope="col">Label</th><th scope="col">Made</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>';
      const tbody = element('tbody');
      for (const t of appTokens) {
        const tr = element('tr', t.revoked ? 'revoked-row' : '');
        tr.append(element('td', '', t.label || '(no label)'), element('td', '', new Date(t.createdAt).toLocaleDateString()));
        const state = element('td');
        state.append(element('span', `badge${t.revoked ? ' offline' : ' connected'}`, t.revoked ? 'Revoked' : 'Active'));
        tr.append(state);
        const cell = element('td', 'row-end');
        const actions = element('div', 'card-actions');
        if (!t.revoked) actions.append(button('delete', 'Revoke', () => run(async () => {
          await getClient().account.revokeToken(t.id);
          await refresh();
          status(`Revoked “${t.label}”. Apps using it are disconnected.`);
        }), `Revoke ${t.label}`));
        cell.append(actions);
        tr.append(cell);
        tbody.append(tr);
      }
      table.append(tbody);
      apps.append(table);
    }
    grid.append(apps);
    body.append(grid);
  }

  return { refresh, render, clear() { overview = null; revealed = null; render(); } };
}
