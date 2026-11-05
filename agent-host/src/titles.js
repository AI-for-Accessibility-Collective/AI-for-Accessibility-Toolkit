// A chat's title in the sidebar's list: a few words the model writes from the
// chat's first message and the agent's first reply. The host calls the model
// itself with its own key (no sandbox is involved), once per chat; until it
// answers, or when it cannot, the title is the start of the first message.
// Nothing of the chat is logged: only that a title was or was not made.

const MAX_INPUT = 3000;
const TIMEOUT_MS = 20_000;

export const fallbackTitle = (message) => String(message || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';

/** One line, no quotes or trailing period, at most 60 characters; null if nothing is left. */
export function cleanTitle(text) {
  const line = String(text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  const t = line.replace(/^(title:\s*)/i, '').replace(/^["'“‘*#\s]+|["'”’*\s]+$/g, '').replace(/[.。]+$/, '').trim();
  return t ? t.slice(0, 60) : null;
}

export function createTitler({ apiKey, model = 'gemini-3.8-flash', upstream = 'https://generativelanguage.googleapis.com', fetch = globalThis.fetch, log }) {
  return async function title({ message, reply }) {
    if (!apiKey) return null;
    const prompt = [
      'Write a title for this chat, for a list of chats: 2 to 6 plain words saying what the person wants changed on which site.',
      'Answer with the title only: no quotes, no period.',
      '', 'The person wrote:', String(message || '').slice(0, MAX_INPUT),
      ...(reply ? ['', 'The assistant answered:', String(reply).slice(0, MAX_INPUT)] : []),
    ].join('\n');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${upstream}/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: 'low' } } }),
      });
      if (!res.ok) { log?.warn('chat.title-failed', { status: res.status }); return null; }
      const data = await res.json();
      return cleanTitle(data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(''));
    } catch (e) {
      log?.warn('chat.title-failed', { error: e.name === 'AbortError' ? 'timeout' : e.message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
