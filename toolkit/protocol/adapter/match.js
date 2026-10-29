// Target rules and platform compatibility (adapter-mcp.md §3 and §6).
//
// Two separate questions, kept apart on purpose:
//
//   - WHERE CAN IT RUN? The integrating application declares its
//     `supportedPlatforms` once; an adapter may narrow that with
//     `platformConstraints`. `platformCompatibility` intersects both with the
//     platform a connected provider actually reports.
//   - WHAT CAN IT AFFECT? An adapter's `targets` rules name target operating
//     systems plus native application ids and/or web URL patterns.
//     `matchTarget` checks one concrete target against them.
//
// Neither answer grants permission or says the adapter is installed now. A
// constrained fact the caller cannot report is "unknown", never a match.

const OS_IDS = new Set(['windows', 'macos', 'linux', 'android', 'ios', 'ipados', 'visionos', 'chromeos', 'horizonos', 'web']);

/**
 * URL scope patterns: a subset of browser match patterns.
 *   "*"                         any http(s) URL
 *   "<scheme>://<host><path>"   scheme is http, https or * (both);
 *                               host is exact, "*", or "*.domain" (the domain
 *                               itself and its subdomains), optionally with
 *                               ":port" — without a port any port matches;
 *                               path is literal with "*" wildcards.
 * Query and fragment are not part of the scope; they are ignored when matching.
 */
const PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?(\/.*)$/i;

/** @returns {string|null} why the pattern is invalid, or null when it is fine */
export function urlPatternError(pattern) {
  if (typeof pattern !== 'string' || !pattern) return 'a URL pattern must be a non-empty string';
  if (pattern === '*') return null;
  const m = PATTERN.exec(pattern);
  if (!m) return `"${pattern}" is not a URL pattern (expected scheme://host/path, e.g. https://*.example.org/*)`;
  if (m[2] !== '*' && m[2].slice(m[2].startsWith('*.') ? 2 : 0).includes('*')) return `"${pattern}" may only use "*" as the whole host or as a leading "*." label`;
  if (m[3] && Number(m[3]) > 65535) return `"${pattern}" has an invalid port`;
  return null;
}

function compilePath(path) {
  return new RegExp(`^${path.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/**
 * Does `url` fall inside `pattern`?
 * @param {string} pattern
 * @param {string} url
 */
export function matchUrlPattern(pattern, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (pattern === '*') return true;
  const m = PATTERN.exec(pattern);
  if (!m || urlPatternError(pattern)) return false;
  const [, scheme, host, port, path] = m;
  if (scheme !== '*' && `${scheme.toLowerCase()}:` !== u.protocol) return false;
  const hostname = u.hostname.toLowerCase();
  if (host !== '*') {
    const h = host.toLowerCase();
    if (h.startsWith('*.')) {
      const base = h.slice(2);
      if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
    } else if (hostname !== h) return false;
  }
  if (port) {
    const actual = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (actual !== String(Number(port))) return false;
  }
  return compilePath(path).test(u.pathname);
}

/**
 * Validate an adapter's `targets` declaration.
 * @returns {{path: string, message: string}[]}
 */
export function checkTargetRules(targets, path = '/targets') {
  const errors = [];
  const err = (p, message) => errors.push({ path: p, message });
  if (!Array.isArray(targets) || !targets.length) { err(path, 'targets must be a non-empty list of rules'); return errors; }
  targets.forEach((rule, i) => {
    const at = `${path}/${i}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) { err(at, 'a target rule must be an object'); return; }
    for (const key of Object.keys(rule)) if (!['platforms', 'applications', 'urls'].includes(key)) err(`${at}/${key}`, 'is not a target-rule field (platforms, applications, urls)');
    const list = (key, check) => {
      if (!(key in rule)) return;
      const v = rule[key];
      if (!Array.isArray(v) || !v.length) { err(`${at}/${key}`, `${key} must be a non-empty list`); return; }
      if (v.includes('*') && v.length > 1) err(`${at}/${key}`, `"*" must be the only item in ${key}`);
      v.forEach((item, j) => { if (item !== '*') { const e = check(item); if (e) err(`${at}/${key}/${j}`, e); } });
    };
    if (!('platforms' in rule)) err(`${at}/platforms`, 'is required (use ["*"] for any target OS)');
    list('platforms', (p) => typeof p === 'string' && OS_IDS.has(p) ? null : `unknown target platform "${p}" (one of ${[...OS_IDS].join(', ')}, or "*")`);
    list('applications', (a) => typeof a === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(a) ? null : `"${a}" is not a native application id (a bundle id or package name; partial globs are not supported)`);
    list('urls', urlPatternError);
    if (!('applications' in rule) && !('urls' in rule)) err(at, 'a rule needs applications, urls, or both');
  });
  return errors;
}

/**
 * Check one concrete target's shape: exactly one of `application` and `url`;
 * a native application needs its `platform`.
 * @returns {string|null} why the target is malformed, or null
 */
export function targetShapeError(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return 'target must be an object';
  for (const key of Object.keys(target)) if (!['platform', 'application', 'url', 'ref'].includes(key)) return `target.${key} is not a target field`;
  const hasApp = target.application !== undefined, hasUrl = target.url !== undefined;
  if (hasApp === hasUrl) return 'a target names exactly one of application or url';
  if (hasApp && (typeof target.application !== 'string' || !target.application)) return 'target.application must be a native application id';
  if (hasApp && typeof target.platform !== 'string') return 'target.platform is required for a native application';
  if (hasUrl) {
    let u;
    try { u = new URL(target.url); } catch { return 'target.url must be an absolute URL'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'target.url must be an http(s) URL';
  }
  if (target.platform !== undefined && typeof target.platform !== 'string') return 'target.platform must be a string';
  return null;
}

/**
 * Does a concrete target fall inside an adapter's rules? Rules are OR
 * alternatives; within one, the platform must match AND either the native
 * application or the URL must match.
 * @returns {boolean}
 */
export function matchTarget(targets, target) {
  if (!Array.isArray(targets) || targetShapeError(target)) return false;
  return targets.some((rule) => {
    const platforms = rule.platforms || [];
    const platformOk = platforms.includes('*') || (typeof target.platform === 'string' && platforms.includes(target.platform));
    if (!platformOk) return false;
    if (target.application !== undefined) {
      return Array.isArray(rule.applications) && (rule.applications.includes('*') || rule.applications.includes(target.application));
    }
    return Array.isArray(rule.urls) && rule.urls.some(p => matchUrlPattern(p, target.url));
  });
}

// ── execution platform ─────────────────────────────────────────────────────

const PLATFORM_DIMENSIONS = ['os', 'environment', 'browser'];

/** @returns {{path: string, message: string}[]} */
export function checkPlatformRecords(records, path, { required = false } = {}) {
  const errors = [];
  if (records === undefined && !required) return errors;
  if (!Array.isArray(records) || !records.length) return [{ path, message: 'must be a non-empty list of platform records' }];
  records.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { errors.push({ path: `${path}/${i}`, message: 'a platform record must be an object' }); return; }
    for (const [key, value] of Object.entries(rec)) {
      if (!PLATFORM_DIMENSIONS.includes(key)) { errors.push({ path: `${path}/${i}/${key}`, message: `is not a platform dimension (${PLATFORM_DIMENSIONS.join(', ')})` }); continue; }
      const list = Array.isArray(value) ? value : [value];
      if (!list.length || list.some(v => typeof v !== 'string' || !v)) errors.push({ path: `${path}/${i}/${key}`, message: 'must be a string or a non-empty list of strings' });
    }
  });
  return errors;
}

// 'match' | 'no-match' | 'unknown' for one record against the actual platform.
function recordMatch(record, actual) {
  let unknown = false;
  for (const dim of PLATFORM_DIMENSIONS) {
    if (!(dim in record)) continue;
    const allowed = Array.isArray(record[dim]) ? record[dim] : [record[dim]];
    const value = actual?.[dim];
    if (typeof value !== 'string') { unknown = true; continue; }
    if (!allowed.includes(value)) return 'no-match';
  }
  return unknown ? 'unknown' : 'match';
}

function anyMatch(records, actual) {
  const results = records.map(r => recordMatch(r, actual));
  if (results.includes('match')) return 'match';
  return results.includes('unknown') ? 'unknown' : 'no-match';
}

/**
 * Effective execution compatibility: the application's supported platforms
 * intersected with the adapter's optional constraints, against the platform
 * the connected application reports.
 * @returns {'compatible'|'incompatible'|'unknown'}
 */
export function platformCompatibility(supportedPlatforms, platformConstraints, actual) {
  const app = anyMatch(supportedPlatforms || [], actual);
  if (app === 'no-match') return 'incompatible';
  const narrowed = platformConstraints === undefined ? 'match' : anyMatch(platformConstraints, actual);
  if (narrowed === 'no-match') return 'incompatible';
  return app === 'match' && narrowed === 'match' ? 'compatible' : 'unknown';
}
