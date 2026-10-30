// Which profile is selected, and a stream that says when it changes, so an
// app (or the developer console in another tab) follows the toolkit without
// a refresh.
//
//   GET  /v1/profile/selection   {ok, revision, selected, updatedAt}
//   GET  /v1/profile/events      SSE: a `profile` event now, and one on every change
//   GET  /v1/profile/presets     the presets an app can choose from: {presets: [{id, name, description, builtIn}]}
//   POST /v1/profile/select      {id} makes that preset the active profile (the console's Load profile)
//
// The event carries no profile content, only the revision and the selected
// preset's name. A listener that wants the profile calls getProfile with its
// own token, so a stream never shows more than the token could already read.
//
// "Selected" is the preset the console last loaded with replaceProfile (the
// console sends its id and name along). A later field edit keeps the name and
// marks it `edited`; replacing the profile with no preset clears it. It is
// stored in the console document, so it outlives a restart; the SSE
// subscribers are in memory, like the relay's.

import { HttpError, sendJSON, readJSON } from './http.js';
import { CONSOLE_DOC, readConsolePrefs } from './providers.js';
import { BUILTIN_PROFILES } from '../developer/profiles.js';

const PROFILE_PREFIX = '/v1/profile';

// Librarian routes that write the profile record.
export const PROFILE_WRITES = new Set(['replaceProfile', 'setProfileField', 'setProfileFields', 'respondToProposal']);

const MAX_ID = 80;
const MAX_NAME = 120;

/**
 * The preset a caller names, or null. `edited: true` says the profile is that
 * preset with changes (the console's temporary profile). Anything else about
 * it is ignored.
 */
export function cleanSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || !id || !name.trim()) return null;
  return { id: id.slice(0, MAX_ID), name: name.trim().slice(0, MAX_NAME), edited: value.edited === true };
}

export function createProfileEvents({ store, authenticate, toolkitHost, withUserLock, heartbeatMs = 25000 }) {
  const users = new Map(); // uid -> { revision, selected, updatedAt, subs: Set<res> }

  async function stateOf(uid) {
    let s = users.get(uid);
    if (s) return s;
    const doc = await store.readJSON(CONSOLE_DOC(uid));
    const kept = doc?.activeProfile;
    s = users.get(uid); // another request may have loaded it while this one read
    if (s) return s;
    s = {
      revision: Date.now(),
      selected: kept && typeof kept.id === 'string' && typeof kept.name === 'string' ? { id: kept.id, name: kept.name, edited: kept.edited === true } : null,
      updatedAt: new Date().toISOString(),
      subs: new Set(),
    };
    users.set(uid, s);
    return s;
  }

  const snapshot = (s) => ({ revision: s.revision, selected: s.selected, updatedAt: s.updatedAt });
  const frame = (s) => `event: profile\nid: ${s.revision}\ndata: ${JSON.stringify(snapshot(s))}\n\n`;

  /**
   * A profile write happened. `selection` is what the writer said it loaded:
   * an object picks that preset, null clears it, undefined (an edit) keeps the
   * current one and marks it edited. Call inside the uid's queue.
   */
  async function changed(uid, selection) {
    const s = await stateOf(uid);
    if (selection === undefined) s.selected = s.selected ? { ...s.selected, edited: true } : null;
    else s.selected = selection;
    s.revision = Math.max(s.revision + 1, Date.now());
    s.updatedAt = new Date().toISOString();
    const doc = (await store.readJSON(CONSOLE_DOC(uid))) || {};
    if (s.selected) doc.activeProfile = s.selected; else delete doc.activeProfile;
    await store.writeJSON(CONSOLE_DOC(uid), doc);
    for (const res of s.subs) { try { res.write(frame(s)); } catch { /* its close handler removes it */ } }
    return snapshot(s);
  }

  /** End every stream for a uid (its data was deleted). */
  function dropUser(uid) {
    const s = users.get(uid);
    users.delete(uid);
    for (const res of s?.subs || []) { try { res.end(); } catch { /* already gone */ } }
  }

  async function stream(res, uid) {
    const s = await stateOf(uid);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\n${frame(s)}`);
    s.subs.add(res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* close handler cleans up */ } }, heartbeatMs);
    beat.unref?.();
    res.on('close', () => { clearInterval(beat); s.subs.delete(res); });
  }

  // The console's built-in presets, then the ones the account saved.
  async function presetsOf(uid) {
    const saved = (await readConsolePrefs(store, uid)).presets
      .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.profile && typeof p.profile === 'object')
      .map(p => ({ id: p.id, name: p.name, description: typeof p.description === 'string' ? p.description : '', builtIn: false, profile: p.profile }));
    return [...BUILTIN_PROFILES.map(p => ({ id: p.id, name: p.name, description: p.description || '', builtIn: true, profile: p.profile })), ...saved];
  }

  // Same as the console's Load profile: replaceProfile, then announce which preset it was.
  async function select(req, res, rec) {
    const body = await readJSON(req);
    if (typeof body?.id !== 'string' || !body.id) throw new HttpError(400, 'invalid-preset', 'Send {id} of a preset from /v1/profile/presets.');
    return withUserLock(rec.uid, async () => {
      // A delete or revoke may have landed while this waited for its turn.
      if (!(await authenticate(req))) throw new HttpError(401, 'unauthorized', 'This token is no longer valid.');
      const preset = (await presetsOf(rec.uid)).find(p => p.id === body.id);
      if (!preset) throw new HttpError(404, 'unknown-preset', `No preset ${body.id.slice(0, MAX_ID)}. List them at /v1/profile/presets.`);
      let profile;
      try {
        profile = await (await toolkitHost.getInstance(rec.uid)).librarian.replaceProfile(preset.profile);
      } catch (e) {
        throw new HttpError(400, 'invalid-preset', `That preset can't be loaded: ${e.message}`);
      }
      const snap = await changed(rec.uid, { id: preset.id, name: preset.name, edited: false });
      return sendJSON(res, 200, { ok: true, ...snap, profile });
    });
  }

  async function handle(req, res, method, pathname) {
    const rec = await authenticate(req);
    if (!rec) throw new HttpError(401, 'unauthorized', 'Send a toolkit token: Authorization: Bearer aat_…');
    if (pathname === `${PROFILE_PREFIX}/select`) {
      if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST {id} to select a preset.');
      return select(req, res, rec);
    }
    if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'This is a GET endpoint.');
    if (pathname === `${PROFILE_PREFIX}/selection`) return sendJSON(res, 200, { ok: true, ...snapshot(await stateOf(rec.uid)) });
    if (pathname === `${PROFILE_PREFIX}/events`) return stream(res, rec.uid);
    if (pathname === `${PROFILE_PREFIX}/presets`) {
      const presets = (await presetsOf(rec.uid)).map(({ profile, ...rest }) => rest);
      return sendJSON(res, 200, { ok: true, presets });
    }
    throw new HttpError(404, 'not-found');
  }

  async function route(req, res, method, pathname) {
    try {
      return await handle(req, res, method, pathname);
    } catch (e) {
      if (e instanceof HttpError) return sendJSON(res, e.status, { error: e.error, message: e.message, ...e.extra });
      throw e;
    }
  }

  return { route, changed, dropUser };
}
