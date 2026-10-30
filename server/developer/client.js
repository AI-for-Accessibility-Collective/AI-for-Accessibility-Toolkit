const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
export const SYSTEM_KEYS = new Set(['schemaVersion', 'createdAt', 'updatedAt']);

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Profile must be a JSON object.');
  function visit(value, depth = 0) {
    if (depth > 50) throw new Error('Profile is too deeply nested.');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (UNSAFE.has(key)) throw new Error(`Unsafe profile key: ${key}`);
      visit(child, depth + 1);
    }
  }
  visit(profile);
  if ('supportAreas' in profile && (!Array.isArray(profile.supportAreas) || profile.supportAreas.some(v => typeof v !== 'string'))) throw new Error('supportAreas must be an array of strings.');
  for (const key of ['fields', 'metaPreferences']) {
    if (key in profile && (!profile[key] || typeof profile[key] !== 'object' || Array.isArray(profile[key]))) throw new Error(`${key} must be an object.`);
  }
  if ('freeText' in profile && typeof profile.freeText !== 'string') throw new Error('freeText must be a string.');
  if (profile.fields?.needs != null && (!Array.isArray(profile.fields.needs) || profile.fields.needs.some(n => !n || typeof n !== 'object' || typeof n.dimension !== 'string' || !n.dimension.trim() || !('value' in n)))) throw new Error('fields.needs must contain needs with dimension and value.');
  return profile;
}

export function editableProfile(profile) {
  return Object.fromEntries(Object.entries(structuredClone(profile)).filter(([key]) => !SYSTEM_KEYS.has(key)));
}

// Keep arrays (including fields.needs) as JSON values; flatten nested objects.
// Segments are stored separately so existing literal dots in keys remain editable.
export function profileRows(profile, parent = []) {
  return Object.entries(profile).flatMap(([key, value]) => {
    const path = [...parent, key];
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length
      ? profileRows(value, path) : [{ path, value }];
  });
}
export function setKey(profile, path, value) {
  if (!path.length || path.some(key => !key || UNSAFE.has(key)) || SYSTEM_KEYS.has(path[0])) throw new Error('Choose a valid key outside the system metadata.');
  let target = profile;
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(target, key)) target[key] = {};
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) throw new Error(`Cannot add a child to ${key}; it is not an object.`);
    target = target[key];
  }
  target[path.at(-1)] = value;
}
export function removeKey(profile, path) {
  let target = profile;
  for (const key of path.slice(0, -1)) target = target[key];
  delete target[path.at(-1)];
}

export function instanceBase(baseUrl) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP(S) instance URL without credentials, a query, or a fragment.');
  return url.href.replace(/\/+$/, '').replace(/\/v1$/, '');
}

// Error messages the service sends as {error, message}: prefer the sentence.
function failure(payload, status) {
  return new Error(payload?.message || payload?.error || `Request failed (${status}).`);
}

/** Sign in with a developer account. Returns {token, expiresAt, account, defaultToken}. */
export async function signIn(baseUrl, username, password, fetcher = fetch) {
  const base = instanceBase(baseUrl);
  if (!String(username || '').trim() || !password) throw new Error('Enter your username and password.');
  let response;
  try {
    response = await fetcher(base + '/v1/auth/login', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: String(username).trim(), password }), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('Cannot reach the toolkit. Check that it is running.'); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw failure(payload, response.status);
  return payload;
}

export function createClient(baseUrl, token, fetcher = fetch) {
  const base = instanceBase(baseUrl);
  if (!token.trim()) throw new Error('Enter a toolkit access token.');
  async function request(path, body, method) {
    let response;
    try {
      response = await fetcher(base + path, {
        method: method || (body ? 'POST' : 'GET'), credentials: 'omit', cache: 'no-store',
        headers: { authorization: `Bearer ${token.trim()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Cannot reach the instance. Check its URL and allowed CORS origins.'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false || !payload) throw failure(payload, response.status);
    return payload;
  }
  const adapterPath = (appId, id, suffix = '') =>
    `/v1/adapters/${encodeURIComponent(appId)}/${encodeURIComponent(id)}${suffix}`;
  return {
    base,
    token: token.trim(),
    whoami: () => request('/v1/whoami'),
    async call(method, ...args) {
      return (await request(`/v1/librarian/${method}`, { args })).result;
    },
    // Which preset is selected, and whether it has been edited since (CONTRACT.md "Profile selection").
    selection: () => request('/v1/profile/selection'),
    // The adapter marketplace (CONTRACT.md "Adapter marketplace").
    adapters: {
      list: async () => request('/v1/adapters'),
      register: async (entry) => (await request('/v1/adapters', entry)).adapter,
      update: async (appId, id, entry) => (await request(adapterPath(appId, id), entry, 'PUT')).adapter,
      remove: (appId, id) => request(adapterPath(appId, id), undefined, 'DELETE'),
      code: (appId, id) => request(adapterPath(appId, id, '/code')),
      setInstalled: (appId, id, installed) => request(adapterPath(appId, id, '/install'), undefined, installed ? 'PUT' : 'DELETE'),
    },
    // The signed-in account (session tokens only).
    account: {
      get: () => request('/v1/account'),
      rename: async (displayName) => (await request('/v1/account', { displayName }, 'PUT')).account,
      logout: () => request('/v1/auth/logout', {}),
      rotateDefaultToken: async () => (await request('/v1/account/default-token', {})).defaultToken,
      createToken: (label) => request('/v1/account/tokens', { label }),
      revokeToken: (id) => request(`/v1/account/tokens/${encodeURIComponent(id)}`, undefined, 'DELETE'),
      changePassword: (current, next) => request('/v1/account/password', { current, next }),
      presets: async () => (await request('/v1/account/presets')).presets,
      savePresets: async (presets) => (await request('/v1/account/presets', { presets }, 'PUT')).presets,
    },
    // Apps connected with the Adapter MCP SDK, grouped by app.
    apps: {
      list: () => request('/v1/apps'),
      setHidden: (appId, hidden) => request(`/v1/apps/${encodeURIComponent(appId)}/hidden`, undefined, hidden ? 'PUT' : 'DELETE'),
      forget: (appId) => request(`/v1/apps/${encodeURIComponent(appId)}`, undefined, 'DELETE'),
    },
  };
}

// Where a signed-in console keeps its session between reloads. Only the
// session token (it expires in a day and can only manage the account); the
// default token is fetched again from /v1/account.
export const SESSION_KEY = 'ai4a11y.developer.session.v1';
export function readSession(storage) {
  try {
    const s = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
    if (!s || typeof s.token !== 'string' || typeof s.base !== 'string' || !(s.expiresAt > Date.now())) return null;
    return s;
  } catch { return null; }
}
export function writeSession(storage, session) {
  if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
  else storage.removeItem(SESSION_KEY);
}

export const SAVED_KEY = 'ai4a11y.developer.profiles.v1';
export function readSaved(storage) {
  const saved = JSON.parse(storage.getItem(SAVED_KEY) || '[]');
  if (!Array.isArray(saved)) throw new Error('Saved profiles have an invalid format.');
  for (const item of saved) {
    if (typeof item.id !== 'string' || !item.id.startsWith('custom-') || typeof item.name !== 'string' || !item.name.trim()) throw new Error('A saved profile is invalid.');
    validateProfile(item.profile);
  }
  return saved;
}
export function writeSaved(storage, profiles) {
  storage.setItem(SAVED_KEY, JSON.stringify(profiles));
}
