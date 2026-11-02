// Questions the agent's browser tools put to the person's sidebar: share
// this page?, preview this adapter?, remove the preview. A tool call waits
// here until the sidebar answers, the chat stops, or the wait runs out.
// A sidebar that connects later gets the open ones again.

import { randomBytes } from 'node:crypto';

export function createRequests({ events, timeoutMs = 15 * 60_000 }) {
  const open = new Map(); // id -> {uid, chatId, request, resolve, timer}

  function ask(uid, chatId, request) {
    const id = `req_${randomBytes(9).toString('base64url')}`;
    const full = { ...request, id, chatId, at: new Date().toISOString() };
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(id, { timedOut: true }), timeoutMs);
      open.set(id, { uid, chatId, request: full, resolve, timer });
      events.publish(uid, { type: 'request', chatId, request: full });
    });
  }

  function settle(id, answer) {
    const pending = open.get(id);
    if (!pending) return false;
    open.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(answer);
    pending.uid && events.publish(pending.uid, { type: 'request-closed', chatId: pending.chatId, id });
    return true;
  }

  /** The sidebar's answer. Only the account the request went to may answer it. */
  function answer(uid, id, value) {
    const pending = open.get(id);
    if (!pending || pending.uid !== uid) return false;
    return settle(id, value || {});
  }

  function pendingFor(uid) {
    return [...open.values()].filter(p => p.uid === uid).map(p => ({ type: 'request', chatId: p.chatId, request: p.request }));
  }

  function cancelChat(uid, chatId) {
    for (const [id, p] of open) if (p.uid === uid && p.chatId === chatId) settle(id, { cancelled: true });
  }

  return { ask, answer, pendingFor, cancelChat, get size() { return open.size; } };
}
