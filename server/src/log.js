// Structured logs for the toolkit service.
//
// On Cloud Run (K_SERVICE is set) or with LOG_FORMAT=json, each entry is one
// JSON line on stdout, which Cloud Logging stores as a structured entry:
// `severity` sets the level, `message` is the summary line, and every other
// field is searchable (jsonPayload.event, jsonPayload.uid, …). An entry with
// an error carries `stack_trace`, which Error Reporting picks up. Elsewhere
// each entry is one readable line.
//
// Never logged: token values, passwords, Authorization headers, request and
// response bodies, query strings, and profile content (a profile is
// disability-related information). Entries carry uids, token ids, app and
// adapter ids, outcomes and timings: enough to follow what happened without
// recording what anyone said about themselves.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

/**
 * @param {Object} [options]
 * @param {'json'|'text'} [options.format]  default json on Cloud Run, else text
 * @param {'debug'|'info'|'warn'|'error'} [options.level]  lowest level written (default info)
 * @param {(line: string, level: string) => void} [options.write]
 * @param {() => Date} [options.now]
 */
export function createLogger({
  format = process.env.K_SERVICE ? 'json' : 'text',
  level = 'info',
  write = (line, lvl) => (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n'),
  now = () => new Date(),
} = {}) {
  const min = LEVELS[level] ?? LEVELS.info;

  function entry(lvl, event, fields = {}) {
    if (LEVELS[lvl] < min) return;
    const { message, error, ...rest } = fields;
    const record = { severity: SEVERITY[lvl], time: now().toISOString(), event, ...rest };
    if (error !== undefined) {
      record.error = error?.message ?? String(error);
      if (error?.code) record.errorCode = error.code;
      if (error?.stack) record.stack_trace = error.stack;
    }
    record.message = message || summary(event, rest, record.error);
    let line;
    if (format === 'json') {
      try { line = JSON.stringify(record); } catch { line = JSON.stringify({ severity: record.severity, time: record.time, event, message: record.message }); }
    } else {
      line = `${record.time} ${record.severity.padEnd(7)} ${record.message}${record.stack_trace && lvl === 'error' ? `\n${record.stack_trace}` : ''}`;
    }
    try { write(line, lvl); } catch { /* logging must never break a request */ }
  }

  return {
    debug: (event, fields) => entry('debug', event, fields),
    info: (event, fields) => entry('info', event, fields),
    warn: (event, fields) => entry('warn', event, fields),
    error: (event, fields) => entry('error', event, fields),
  };
}

/** A logger that writes nothing: the default for tests and embedders. */
export const silentLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

// "account.created uid=team-1" — the event plus its short scalar fields.
function summary(event, fields, error) {
  const parts = [event];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || typeof v === 'object') continue;
    const s = String(v);
    parts.push(`${k}=${s.length > 80 ? `${s.slice(0, 77)}…` : s}`);
  }
  if (error) parts.push(`error=${error}`);
  return parts.join(' ');
}

/**
 * The part of an error message that is safe to log for a librarian call:
 * a code-like message ("no-server-key") as it is; any sentence might quote
 * profile content, so only its kind is kept.
 */
export function safeErrorText(e) {
  const text = String(e?.message ?? e ?? '');
  if (/^[\w.:/-]{1,80}$/.test(text)) return text;
  return e?.code || e?.name || 'error';
}
