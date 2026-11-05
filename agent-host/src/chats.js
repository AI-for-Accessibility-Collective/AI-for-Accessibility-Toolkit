// The sidebar's chats, one file each under the account's chats/ folder: what
// the person saw (their messages, the agent's replies without code, one line
// per step), the opencode session that continues it, which sites the person
// agreed to share in it, the latest preview of each adapter file (its result
// and checks, and a hash of the code it ran), and the adapters the agent
// finished. Its title is the start of the first message until the model
// names it (titles.js), after the first reply.
//
// One chat runs at a time per account: the browser tools act on the tab the
// person's sidebar is open on, so two runs would share one page.

import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { translate } from './updates.js';
import { fallbackTitle } from './titles.js';

const MAX_ENTRIES = 600;
const LEVELS = ['none', 'url', 'source', 'screenshot'];
export const SHARE_LEVELS = LEVELS;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createChats({ accounts, runner, events, requests, log, afterRun, titler, onIdle }) {
  const runs = new Map(); // uid -> {chatId, stop}

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
    busy: runs.get(uid)?.chatId === chat.id,
  });
  const full = (uid, chat) => ({ ...summary(uid, chat), consent: chat.consent, entries: chat.entries, adapters: chat.adapters, allSites: chat.allSites === true });

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
    const rec = { ...adapter, version: (old?.version || 0) + 1, fixes: old?.fixes || 0, at: new Date().toISOString() };
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

  const activeChat = (uid) => runs.get(uid)?.chatId || null;

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
   * answer to a pages question (all: the adapter may run on every site).
   * With `shown`, the message is the host's (verification.js): the person
   * sees that line instead.
   */
  async function send(uid, chatId, text, { answers, pages, shown } = {}) {
    const message = String(text || '').trim();
    if (!message) throw httpError(400, 'Say something first.');
    if (message.length > 20_000) throw httpError(400, 'That message is too long.');
    if (runs.has(uid)) throw httpError(409, runs.get(uid).chatId === chatId ? 'The assistant is still working on this chat. Wait, or stop it.' : 'Another chat is still working. Wait, or stop it.', 'busy');
    const chat = read(uid, chatId);
    if (chat.title === 'New chat' && !shown) { chat.title = fallbackTitle(message); save(uid, chat); }
    if (['all', 'site', 'type'].includes(pages)) { chat.allSites = pages === 'all'; save(uid, chat); }
    const asked = answers && chat.entries.find(e => e.id === answers && e.kind === 'questions' && !e.answered);
    if (asked) addEntry(uid, chatId, { id: asked.id, answered: true });
    addEntry(uid, chatId, shown ? { kind: 'notice', text: String(shown).slice(0, 300) } : { kind: 'you', text: message });
    const run = { chatId, stop: null, stopped: false, since: new Date().toISOString() };
    runs.set(uid, run);
    events.publish(uid, { type: 'chat', chat: summary(uid, read(uid, chatId)) });
    // Runs in the background; the sidebar follows on the event stream.
    (async () => {
      let replied = false;
      try {
        const proc = await runner.run(uid, { sessionId: chat.sessionId, text: message, title: chat.title });
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
        runs.delete(uid);
        requests.cancelChat(uid, chatId);
        try { events.publish(uid, { type: 'chat', chat: summary(uid, read(uid, chatId)) }); } catch { /* deleted */ }
      }
      try { onIdle?.(uid); } catch (e) { log?.warn('chat.on-idle-failed', { uid, error: e.message }); }
      if (!run.deleted) await nameChat(uid, chatId).catch(e => log?.warn('chat.title-failed', { uid, chatId, error: e.message }));
    })();
    return { ok: true };
  }

  function stop(uid, chatId) {
    const run = runs.get(uid);
    if (!run || run.chatId !== chatId) return { stopped: false };
    run.stopped = true;
    run.stop?.();
    requests.cancelChat(uid, chatId);
    return { stopped: true };
  }

  /** Delete a chat: stop its run first. What the person shared of pages (page-data/) stays. */
  function remove(uid, chatId) {
    const file = fileOf(uid, chatId);
    if (!existsSync(file)) throw httpError(404, 'no such chat');
    const run = runs.get(uid);
    if (run?.chatId === chatId) { run.deleted = run.stopped = true; run.stop?.(); }
    requests.cancelChat(uid, chatId);
    unlinkSync(file);
    events.publish(uid, { type: 'chat-deleted', chatId });
    return { deleted: true };
  }

  return { list, create, get, remove, addEntry, setConsent, recordPreview, previews, previewOf, markReady, updateAdapter, activeChat, send, stop };
}
