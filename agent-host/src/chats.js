// The sidebar's chats, one file each under the account's chats/ folder: what
// the person saw (their messages, the agent's replies without code, one line
// per step), the opencode session that continues it, which sites the person
// agreed to share in it, the latest preview of each adapter file (its result
// and checks, and a hash of the code it ran), and the adapters the agent
// finished. Its title is the start of the first message until the model
// names it (titles.js), after the first reply.
//
// Several chats of one account may run at once, each its own opencode run in
// the account's one sandbox; one run per chat. A run has its own token (in the
// browser tools' header of that run's opencode config): a tool call names its
// chat by it, and the token ends with the run. Each chat works on its own page
// in the sidebar. The sandbox's /work is shared: a file another running chat
// previewed or offered is that chat's while it runs (claimFile).
//
// A run is marked in its chat's file while it lasts (`running`). When the
// host restarts (an update), the runs it had are gone with it: at start it
// ends what they left running in the sandboxes and picks each marked chat up
// again, once (resumeInterrupted).

import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { translate } from './updates.js';
import { fallbackTitle } from './titles.js';
import { PAGE_TYPE_IDS, SUPPORT_AREAS } from '../../toolkit/protocol/adapter/index.js';

const MAX_ENTRIES = 600;
const RESUME = 'The toolkit restarted while you were working on my last message, so your last step may not have finished, and anything you were waiting for (a preview, a page I was asked to share, my answer to a question) was lost. Continue where you left off: look at the files in /work first, and ask again for anything you still need.';
const RESUMED = 'The toolkit restarted while the assistant was working. It is picking up where it left off.';
const LEVELS = ['none', 'url', 'source', 'screenshot'];
export const SHARE_LEVELS = LEVELS;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createChats({ accounts, runner, events, requests, log, afterRun, titler, onIdle }) {
  const runs = new Map();      // uid -> Map(chatId -> {stop, token, files})
  const runTokens = new Map(); // run token -> {uid, chatId}, while the run lasts
  const runsOf = (uid) => runs.get(uid) || new Map();
  const runOf = (uid, chatId) => runs.get(uid)?.get(chatId) || null;

  const fileOf = (uid, id) => {
    if (!/^c_[A-Za-z0-9_-]{6,40}$/.test(String(id))) throw httpError(404, 'no such chat');
    return path.join(accounts.dirOf(uid), 'chats', `${id}.json`);
  };

  function read(uid, id) {
    const file = fileOf(uid, id);
    if (!existsSync(file)) throw httpError(404, 'no such chat');
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  function save(uid, chat) {
    chat.updatedAt = new Date().toISOString();
    if (chat.entries.length > MAX_ENTRIES) chat.entries = chat.entries.slice(-MAX_ENTRIES);
    const file = fileOf(uid, chat.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(chat));
    renameSync(`${file}.tmp`, file);
  }

  const summary = (uid, chat) => ({
    id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    busy: !!runOf(uid, chat.id),
  });
  const full = (uid, chat) => ({ ...summary(uid, chat), consent: chat.consent, entries: chat.entries, adapters: chat.adapters, allSites: chat.allSites === true,
    ...(chat.pageTypes ? { pageTypes: chat.pageTypes } : {}), ...(chat.supportAreas ? { supportAreas: chat.supportAreas } : {}) });

  function list(uid) {
    accounts.ensure(uid);
    const dir = path.join(accounts.dirOf(uid), 'chats');
    const chats = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try { chats.push(summary(uid, JSON.parse(readFileSync(path.join(dir, name), 'utf8')))); } catch { /* a half-written file */ }
    }
    return chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function create(uid) {
    accounts.ensure(uid);
    const now = new Date().toISOString();
    const chat = { id: `c_${randomBytes(9).toString('base64url')}`, title: 'New chat', createdAt: now, updatedAt: now, sessionId: null, consent: {}, entries: [], adapters: [] };
    save(uid, chat);
    events.publish(uid, { type: 'chat', chat: summary(uid, chat) });
    return full(uid, chat);
  }

  const get = (uid, id) => full(uid, read(uid, id));

  /** Add or update (same id) one entry and tell the sidebars. */
  function addEntry(uid, chatId, entry) {
    const chat = read(uid, chatId);
    const item = { id: entry.id || `e_${randomBytes(6).toString('base64url')}`, at: new Date().toISOString(), ...entry };
    const i = chat.entries.findIndex(e => e.id === item.id);
    if (i >= 0) chat.entries[i] = { ...chat.entries[i], ...item };
    else chat.entries.push(item);
    save(uid, chat);
    events.publish(uid, { type: 'entry', chatId, entry: item });
    return item;
  }

  function setConsent(uid, chatId, origin, level) {
    if (!LEVELS.includes(level)) throw httpError(400, `level is one of ${LEVELS.join(', ')}`);
    let o;
    try { o = new URL(origin).origin; } catch { throw httpError(400, 'origin must be a page origin'); }
    const chat = read(uid, chatId);
    chat.consent = { ...chat.consent, [o]: level };
    save(uid, chat);
    events.publish(uid, { type: 'consent', chatId, consent: chat.consent });
  }

  /** Keep the latest preview of a file: {file, name, hash, status, changes, checks}. */
  function recordPreview(uid, chatId, preview) {
    const chat = read(uid, chatId);
    const rec = { ...preview, at: new Date().toISOString() };
    chat.previews = { ...chat.previews, [preview.file]: rec };
    save(uid, chat);
    return rec;
  }
  const previews = (uid, chatId) => read(uid, chatId).previews || {};
  const previewOf = (uid, chatId, file) => previews(uid, chatId)[file] || null;

  /** The agent offers an adapter: a new version of it, if it offered one with this id before. */
  function markReady(uid, chatId, adapter) {
    const chat = read(uid, chatId);
    const old = chat.adapters.find(a => a.id === adapter.id);
    const rec = { ...adapter, version: (old?.version || 0) + 1, fixes: old?.fixes || 0, ...(old?.reviewed ? { reviewed: true } : {}), at: new Date().toISOString() };
    chat.adapters = [...chat.adapters.filter(a => a.id !== adapter.id), rec];
    save(uid, chat);
    events.publish(uid, { type: 'adapter', chatId, adapter: rec });
    return rec;
  }

  /** Change what is kept about an offered adapter (its background check, its review). */
  function updateAdapter(uid, chatId, adapterId, patch) {
    const chat = read(uid, chatId);
    const i = chat.adapters.findIndex(a => a.id === adapterId);
    if (i < 0) return null;
    chat.adapters[i] = { ...chat.adapters[i], ...patch };
    save(uid, chat);
    events.publish(uid, { type: 'adapter', chatId, adapter: chat.adapters[i] });
    return chat.adapters[i];
  }

  /** Whether this chat's assistant is running now. */
  const isBusy = (uid, chatId) => !!runOf(uid, chatId);
  /** The chats of an account running now. */
  const busyChats = (uid) => [...runsOf(uid).keys()];
  /** The run a browser-tools token belongs to: {uid, chatId}, or null once it ended. */
  const runForToken = (token) => (typeof token === 'string' && token.startsWith('run_') ? runTokens.get(token) || null : null);

  /**
   * A file in /work this chat's run previews or offers. Another chat running
   * now that did so first keeps it: returns that chat's title, else null.
   */
  function claimFile(uid, chatId, file) {
    for (const [other, run] of runsOf(uid)) {
      if (other === chatId || !run.files.has(file)) continue;
      try { return read(uid, other).title || 'another chat'; } catch { return 'another chat'; }
    }
    runOf(uid, chatId)?.files.add(file);
    return null;
  }

  /** The model's title, from the first message and the first reply; once per chat, when it answers. */
  async function nameChat(uid, chatId) {
    if (!titler) return;
    let chat = read(uid, chatId);
    if (chat.titledByModel) return;
    const message = chat.entries.find(e => e.kind === 'you')?.text;
    const reply = chat.entries.find(e => e.kind === 'agent')?.text;
    if (!message) return;
    const title = await titler({ message, reply });
    if (!title) return;
    chat = read(uid, chatId);
    chat.title = title;
    chat.titledByModel = true;
    save(uid, chat);
    events.publish(uid, { type: 'chat', chat: summary(uid, chat) });
  }

  /**
   * The person's message. `answers` names the questions entry it answers
   * (ask_questions), which is then shown as answered; `pages` is their
   * answer to a pages question (all: the adapter may run on every site;
   * type: on the kind of page `pageType` only), `areas` to an areas one.
   * With `shown`, the message is the host's (verification.js): the person
   * sees that line instead.
   */
  async function send(uid, chatId, text, { answers, pages, pageType, areas, shown, resumed } = {}) {
    const message = String(text || '').trim();
    if (!message) throw httpError(400, 'Say something first.');
    if (message.length > 20_000) throw httpError(400, 'That message is too long.');
    if (runOf(uid, chatId)) throw httpError(409, 'The assistant is still working on this chat. Wait, or stop it.', 'busy');
    const chat = read(uid, chatId);
    if (chat.title === 'New chat' && !shown) { chat.title = fallbackTitle(message); save(uid, chat); }
    if (['all', 'site', 'type', 'type-all', 'other'].includes(pages)) {
      // A type of page on all websites runs everywhere, only on pages of that kind.
      chat.allSites = pages === 'all' || (pages === 'type-all' && PAGE_TYPE_IDS.includes(pageType));
      if ((pages === 'type' || pages === 'type-all') && PAGE_TYPE_IDS.includes(pageType)) chat.pageTypes = [pageType]; else delete chat.pageTypes;
      save(uid, chat);
    }
    if (Array.isArray(areas)) { chat.supportAreas = areas.filter(a => SUPPORT_AREAS.includes(a)); save(uid, chat); }
    const asked = answers && chat.entries.find(e => e.id === answers && e.kind === 'questions' && !e.answered);
    if (asked) addEntry(uid, chatId, { id: asked.id, answered: true });
    addEntry(uid, chatId, shown ? { kind: 'notice', text: String(shown).slice(0, 300) } : { kind: 'you', text: message });
    const run = { chatId, stop: null, stopped: false, since: new Date().toISOString(), token: `run_${randomBytes(24).toString('base64url')}`, files: new Set() };
    mark(uid, chatId, { since: run.since, text: message, ...(resumed ? { resumed: true } : {}) });
    if (!runs.has(uid)) runs.set(uid, new Map());
    runs.get(uid).set(chatId, run);
    runTokens.set(run.token, { uid, chatId });
    events.publish(uid, { type: 'chat', chat: summary(uid, read(uid, chatId)) });
    // Runs in the background; the sidebar follows on the event stream.
    (async () => {
      let replied = false;
      try {
        const proc = await runner.run(uid, { sessionId: chat.sessionId, text: message, title: chat.title, runToken: run.token });
        run.stop = proc.stop;
        if (run.stopped) proc.stop();
        for await (const event of proc.events) {
          const { sessionId, entry } = translate(event);
          if (sessionId && !read(uid, chatId).sessionId) { const c = read(uid, chatId); c.sessionId = sessionId; save(uid, c); }
          if (entry) { addEntry(uid, chatId, entry); if (entry.kind === 'agent') replied = true; }
        }
        const { code } = await proc.done;
        if (!run.stopped) { try { afterRun?.(uid, chatId, run.since); } catch (e) { log?.warn('chat.after-run', { uid, chatId, error: e.message }); } }
        if (run.stopped) addEntry(uid, chatId, { kind: 'notice', text: 'Stopped.' });
        else if (code !== 0 && !replied) {
          log?.warn('chat.run-failed', { uid, chatId, code, stderr: proc.stderr().slice(-500) });
          addEntry(uid, chatId, { kind: 'error', text: 'The assistant stopped before it could answer. Try again.' });
        }
      } catch (e) {
        // A chat deleted while it ran: nothing left to write to.
        if (!run.deleted) {
          log?.error('chat.run-error', { uid, chatId, error: e.message });
          try { addEntry(uid, chatId, { kind: 'error', text: 'The assistant could not start. Try again in a moment.' }); } catch { /* deleted */ }
        }
      } finally {
        if (!run.deleted) { try { mark(uid, chatId, null); } catch { /* deleted */ } }
        runTokens.delete(run.token);
        runs.get(uid)?.delete(chatId);
        if (!runs.get(uid)?.size) runs.delete(uid);
        requests.cancelChat(uid, chatId);
        try { events.publish(uid, { type: 'chat', chat: summary(uid, read(uid, chatId)) }); } catch { /* deleted */ }
      }
      try { onIdle?.(uid, chatId); } catch (e) { log?.warn('chat.on-idle-failed', { uid, error: e.message }); }
      if (!run.deleted) await nameChat(uid, chatId).catch(e => log?.warn('chat.title-failed', { uid, chatId, error: e.message }));
    })();
    return { ok: true };
  }

  /** Mark the chat as running (what it was asked), or clear the mark (null). */
  function mark(uid, chatId, running) {
    const chat = read(uid, chatId);
    if (running) chat.running = running; else if (chat.running) delete chat.running; else return;
    save(uid, chat);
  }

  /**
   * After a restart: every chat still marked running was cut off. Its
   * sandbox's leftover runs are ended first (runner.endRuns), then it goes on
   * from its opencode session with a message saying what happened; the person
   * sees one line. A chat cut off while it was already resuming is not
   * resumed again: the person is asked to send a message.
   */
  async function resumeInterrupted(uids) {
    const resumed = [];
    for (const uid of uids) {
      const cut = [];
      const dir = path.join(accounts.dirOf(uid), 'chats');
      for (const name of existsSync(dir) ? readdirSync(dir) : []) {
        if (!name.endsWith('.json')) continue;
        try { const c = JSON.parse(readFileSync(path.join(dir, name), 'utf8')); if (c.running && !runOf(uid, c.id)) cut.push(c); } catch { /* a half-written file */ }
      }
      if (!cut.length) continue;
      await runner.endRuns?.(uid).catch(e => log?.warn('chat.end-runs-failed', { uid, error: e.message }));
      for (const c of cut) {
        try {
          mark(uid, c.id, null);
          if (c.running.resumed) {
            addEntry(uid, c.id, { kind: 'error', text: 'The toolkit restarted again while the assistant was working. Send a message to go on.' });
            continue;
          }
          // Cut off before opencode began a session: ask again what was asked.
          await send(uid, c.id, c.sessionId ? RESUME : String(c.running.text || RESUME), { shown: RESUMED, resumed: true });
          resumed.push({ uid, chatId: c.id });
          log?.info('chat.resumed', { uid, chatId: c.id, since: c.running.since });
        } catch (e) { log?.warn('chat.resume-failed', { uid, chatId: c.id, error: e.message }); }
      }
    }
    return resumed;
  }

  function stop(uid, chatId) {
    const run = runOf(uid, chatId);
    if (!run) return { stopped: false };
    run.stopped = true;
    run.stop?.();
    requests.cancelChat(uid, chatId);
    return { stopped: true };
  }

  /** Delete a chat: stop its run first. What the person shared of pages (page-data/) stays. */
  function remove(uid, chatId) {
    const file = fileOf(uid, chatId);
    if (!existsSync(file)) throw httpError(404, 'no such chat');
    const run = runOf(uid, chatId);
    if (run) { run.deleted = run.stopped = true; run.stop?.(); }
    requests.cancelChat(uid, chatId);
    unlinkSync(file);
    events.publish(uid, { type: 'chat-deleted', chatId });
    return { deleted: true };
  }

  return { list, create, get, remove, addEntry, setConsent, recordPreview, previews, previewOf, markReady, updateAdapter, isBusy, busyChats, runForToken, claimFile, send, stop, resumeInterrupted };
}
