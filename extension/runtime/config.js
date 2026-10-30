// The runtime's connection to a toolkit: its URL, the developer's default
// token and uid, in chrome.storage.local (never sync: the token stays on this
// computer).

/**
 * A toolkit address the runtime will send a token to: https, or plain http
 * only on this computer (localhost, 127.0.0.1, [::1]). From the personalized
 * extension's rule.
 */
export function isAllowedServerUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** @returns {Promise<{url: string, token: string, uid: string} | null>} */
export async function readConnection() {
  const { connection } = await chrome.storage.local.get('connection');
  return connection && connection.url && connection.token ? connection : null;
}

export async function writeConnection(connection) {
  if (connection) await chrome.storage.local.set({ connection });
  else await chrome.storage.local.remove('connection');
}

/** A random id for this browser's runtime, so reports from two browsers stay apart. */
export async function instanceId() {
  const { runtimeInstanceId } = await chrome.storage.local.get('runtimeInstanceId');
  if (runtimeInstanceId) return runtimeInstanceId;
  const id = `chrome-${crypto.randomUUID().slice(0, 12)}`;
  await chrome.storage.local.set({ runtimeInstanceId: id });
  return id;
}

/** "Chrome 141 on macOS": how the console names this runtime. */
export function runtimeLabel() {
  const version = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  const platform = navigator.userAgentData?.platform || '';
  return `Chrome${version ? ` ${version}` : ''}${platform ? ` on ${platform}` : ''}`;
}
