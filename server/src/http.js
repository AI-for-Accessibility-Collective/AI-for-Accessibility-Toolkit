// Small HTTP helpers shared by the route modules.

export class HttpError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message || error);
    this.status = status;
    this.error = error;
    this.extra = extra;
  }
}

export function sendJSON(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

export function bearerFrom(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

const MAX_BODY_BYTES = 1e6;

/** Parse a JSON request body. Throws HttpError 400 on bad JSON or a body over 1 MB. */
export async function readJSON(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      req.destroy();
      throw new HttpError(413, 'body-too-large', `The request body is over ${Math.round(maxBytes / 1000)} KB.`);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid-json', 'The request body is not valid JSON.');
  }
}

/** Split `/prefix/a/b` into decoded segments after the prefix; a malformed
 *  escape is a 400, an empty segment list is []. */
export function segmentsAfter(pathname, prefix) {
  const rest = pathname.slice(prefix.length).replace(/^\/+/, '');
  if (!rest) return [];
  try {
    return rest.split('/').map(decodeURIComponent);
  } catch {
    throw new HttpError(400, 'bad-request', 'The path is not valid.');
  }
}

/** Write a thrown HttpError as JSON; anything else is rethrown. */
export function sendHttpError(res, e) {
  if (!(e instanceof HttpError)) throw e;
  return sendJSON(res, e.status, { error: e.error, message: e.message, ...e.extra });
}
