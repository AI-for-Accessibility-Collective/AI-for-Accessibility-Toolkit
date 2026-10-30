// Shareable adapter packages (adapter-mcp.md §14).
//
// A package is what one application hands the toolkit so another can run the
// same adapter: the descriptor plus code in a format a runtime knows. There is
// one format so far, `web-module@1`: one JavaScript file in the shape the
// Redbird starter uses, an exported object with `enable(options)` and
// `disable()`, where `disable()` puts the page back the way it was.
//
//   export const BigButtons = {
//     enabled: false,
//     enable(options = {}) { … },
//     disable() { … },
//   };
//
// A runtime that cannot load ES modules (a Chrome user script, an eval-free
// page) runs `moduleFactorySource(code)` instead: the same file with its
// `export` keywords turned into a returned object. The rewrite is
// line-based: `export` must start a line, and `import` is not supported, so
// a package is one self-contained file.
//
// Code a toolkit stores is not code it vouches for. `lintWebModule` flags what
// a shared page adapter has no business doing (sending data off the page,
// evaluating strings, reading cookies). It is a lint, not a sandbox.

import { sha256Hex } from './canonical.js';
import { urlPatternError } from './match.js';

export const WEB_MODULE = 'web-module@1';
export const PACKAGE_FORMATS = Object.freeze([WEB_MODULE]);
export const MAX_PACKAGE_CODE = 256_000;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const DEFAULT_NAME = '__ai4a11yDefault';

/** `sha256:<hex>` of the code: what a descriptor's executionArtifactDigest pins. */
export async function artifactDigest(code) {
  return `sha256:${await sha256Hex(code)}`;
}

// ── exports ────────────────────────────────────────────────────────────────

/**
 * Rewrite a web module's exports into a function body that returns them.
 * @returns {{body: string, names: string[], errors: string[]}}
 */
export function rewriteExports(code) {
  const names = [];     // every exported name
  const declared = [];  // names a declaration or `export default` binds
  const lists = [];     // `export { … }` objects, spread into the result
  const errors = [];
  const lines = String(code).split('\n');
  const out = lines.map((line, i) => {
    const at = `line ${i + 1}`;
    if (/^\s*import\s*[\w{*'"]/.test(line) || /(^|[^\w$.])import\s*\(/.test(line)) {
      errors.push(`${at}: import is not supported; a shared adapter is one self-contained file`);
      return line;
    }
    let m = /^(\s*)export\s+default\s+/.exec(line);
    if (m) {
      names.push('default'); declared.push('default');
      return `${m[1]}const ${DEFAULT_NAME} = ${line.slice(m[0].length)}`;
    }
    m = /^(\s*)export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { names.push(m[3]); declared.push(m[3]); return line.replace(/export\s+/, ''); }
    m = /^(\s*)export\s+(async\s+function\*?|function\*?|class)\s*([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { names.push(m[3]); declared.push(m[3]); return line.replace(/export\s+/, ''); }
    m = /^(\s*)export\s*\{([^}]*)\}\s*(from\b.*)?;?\s*$/.exec(line);
    if (m) {
      if (m[3]) { errors.push(`${at}: export … from is not supported; a shared adapter is one self-contained file`); return line; }
      const pairs = [];
      for (const part of m[2].split(',').map(s => s.trim()).filter(Boolean)) {
        const [local, as = local] = part.split(/\s+as\s+/).map(s => s.trim());
        if (!IDENT.test(local) || !(IDENT.test(as) || as === 'default')) { errors.push(`${at}: cannot read the export list "${part}"`); continue; }
        names.push(as);
        pairs.push([as, local]);
      }
      lists.push(`__ai4a11yList${i}`);
      return `${m[1]}const __ai4a11yList${i} = { ${pairs.map(([as, local]) => `${JSON.stringify(as)}: ${local}`).join(', ')} };`;
    }
    if (/^\s*export\b/.test(line)) errors.push(`${at}: this form of export is not supported (use export const, export function, export class, export default or export { … })`);
    return line;
  });
  if (new Set(names).size !== names.length) errors.push('an export name is used twice');
  const fields = [
    ...declared.map(n => (n === 'default' ? `default: ${DEFAULT_NAME}` : `${JSON.stringify(n)}: ${n}`)),
    ...lists.map(l => `...${l}`),
  ];
  const body = `'use strict';\n${out.join('\n')}\n;return { ${fields.join(', ')} };`;
  return { body, names, errors };
}

/**
 * The source of a function expression that, when called, runs the module and
 * returns its exports: `(function () { … return {…}; })`.
 */
export function moduleFactorySource(code) {
  const { body, errors } = rewriteExports(code);
  if (errors.length) throw new Error(errors[0]);
  return `(function () {\n${body}\n})`;
}

/** Is this value shaped like an adapter (enable and disable functions)? */
export function isAdapterObject(value) {
  return !!value && typeof value === 'object' && typeof value.enable === 'function' && typeof value.disable === 'function';
}

/**
 * Pick the adapter from a module's exports: the named `entry`, else the
 * default export, else the one export shaped like an adapter.
 * @returns {object} the adapter object
 */
export function pickAdapter(exports, entry) {
  if (entry) {
    if (!isAdapterObject(exports[entry])) throw new Error(`the export "${entry}" is not an adapter (it needs enable and disable functions)`);
    return exports[entry];
  }
  if (isAdapterObject(exports.default)) return exports.default;
  const found = Object.entries(exports).filter(([, v]) => isAdapterObject(v));
  if (found.length === 1) return found[0][1];
  if (!found.length) throw new Error('the file exports no adapter (an object with enable and disable functions)');
  throw new Error(`the file exports ${found.length} adapters (${found.map(([k]) => k).join(', ')}); name one as the package entry`);
}

/**
 * Run a web module in this realm and return its adapter. For hosts that allow
 * evaluating code (Node, a page without a strict CSP); the browser runtime
 * builds a user script from moduleFactorySource instead.
 */
export function instantiateWebModule(code, entry) {
  // eslint-disable-next-line no-new-func
  const factory = new Function(`return ${moduleFactorySource(code)}`)();
  return pickAdapter(factory(), entry);
}

// ── lint ───────────────────────────────────────────────────────────────────

const LINT_RULES = [
  { level: 'error', test: /(^|[^\w$.])eval\s*\(/, message: 'eval runs text as code' },
  { level: 'error', test: /\bnew\s+Function\s*\(/, message: 'new Function runs text as code' },
  { level: 'error', test: /\b(setTimeout|setInterval)\s*\(\s*['"`]/, message: 'a timer given a string runs text as code' },
  { level: 'error', test: /(^|[^\w$.])fetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|\bsendBeacon\s*\(/, message: 'sends or fetches data over the network' },
  { level: 'error', test: /\bdocument\.cookie\b/, message: 'reads or writes cookies' },
  { level: 'error', test: /\bdocument\.write(ln)?\s*\(/, message: 'document.write replaces the page' },
  { level: 'warning', test: /\b(localStorage|sessionStorage|indexedDB)\b/, message: 'uses the site\'s storage' },
  { level: 'warning', test: /\blocation\s*(\.href\s*=|\.assign\s*\(|\.replace\s*\(|=[^=])/, message: 'navigates the page' },
  { level: 'warning', test: /\bchrome\.|\bbrowser\.runtime\b/, message: 'uses browser-extension APIs, which a page adapter does not get' },
];

/**
 * Check a web module before publishing or running it.
 * @returns {{level: 'error'|'warning', message: string, line?: number}[]}
 */
export function lintWebModule(code) {
  const findings = [];
  if (typeof code !== 'string' || !code.trim()) return [{ level: 'error', message: 'the code is empty' }];
  if (code.length > MAX_PACKAGE_CODE) findings.push({ level: 'error', message: `the code is over ${MAX_PACKAGE_CODE} characters` });
  const { names, errors } = rewriteExports(code);
  for (const e of errors) findings.push({ level: 'error', message: e });
  if (!names.length && !errors.length) findings.push({ level: 'error', message: 'the file exports nothing; export the adapter object (export const MyAdapter = { enable() {}, disable() {} })' });
  code.split('\n').forEach((line, i) => {
    const text = line.replace(/\/\/.*$/, '');
    for (const rule of LINT_RULES) if (rule.test.test(text)) findings.push({ level: rule.level, message: rule.message, line: i + 1 });
  });
  if (!/\bdisable\s*\(/.test(code)) findings.push({ level: 'warning', message: 'no disable() found; switching the adapter off must put the page back' });
  return findings;
}

// ── packages ───────────────────────────────────────────────────────────────

/** Every URL pattern in a descriptor's target rules. */
export function webUrlPatterns(targets) {
  return [...new Set((Array.isArray(targets) ? targets : []).flatMap(rule => (Array.isArray(rule?.urls) ? rule.urls : [])))];
}

/**
 * Check a package against its descriptor: a known format, code within the
 * size limit and free of lint errors, an entry that exists, and a web
 * surface with URL targets for a web module.
 * @returns {{path: string, message: string}[]}
 */
export function checkPackage(pkg, descriptor) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return [{ path: '/package', message: 'must be an object with format and code' }];
  for (const key of Object.keys(pkg)) if (!['format', 'code', 'entry'].includes(key)) err(`/package/${key}`, 'is not a package field (format, code, entry)');
  if (!PACKAGE_FORMATS.includes(pkg.format)) err('/package/format', `must be one of ${PACKAGE_FORMATS.join(', ')}`);
  if (pkg.entry !== undefined && (typeof pkg.entry !== 'string' || !(IDENT.test(pkg.entry) || pkg.entry === 'default'))) err('/package/entry', 'must be the name of an export');
  if (typeof pkg.code !== 'string') err('/package/code', 'must be the adapter\'s source text');
  else {
    for (const f of lintWebModule(pkg.code)) if (f.level === 'error') err('/package/code', f.line ? `line ${f.line}: ${f.message}` : f.message);
    if (pkg.entry && !rewriteExports(pkg.code).names.includes(pkg.entry)) err('/package/entry', `the code has no export named "${pkg.entry}"`);
  }
  if (descriptor) {
    if (!Array.isArray(descriptor.surfaces) || !descriptor.surfaces.includes('web')) err('/descriptor/surfaces', 'a web-module package needs the web surface');
    const patterns = webUrlPatterns(descriptor.targets);
    if (!patterns.length) err('/descriptor/targets', 'a web-module package needs at least one URL pattern, so a runtime knows where it runs');
    for (const p of patterns) { const e = urlPatternError(p); if (e) err('/descriptor/targets', e); }
  }
  return errors;
}

// ── where it runs, for a browser runtime ───────────────────────────────────

/**
 * Chrome match patterns that cover a set of toolkit URL patterns. They can be
 * broader (Chrome ignores ports); a runtime narrows with urlPatternRegExpSource.
 */
export function chromeMatchPatterns(patterns) {
  const out = new Set();
  for (const p of patterns) {
    if (p === '*') { out.add('http://*/*'); out.add('https://*/*'); continue; }
    const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d{1,5})?(\/.*)$/i.exec(p);
    if (m) out.add(`${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3]}`);
  }
  return [...out];
}

/**
 * A regular expression source equal to matchUrlPattern(pattern, url), tested
 * against normalizedUrl(url): `scheme://host:port/path`, query and fragment
 * dropped, the default port filled in.
 */
export function urlPatternRegExpSource(pattern) {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  if (pattern === '*') return '^https?://[^/]+/.*$';
  const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?(\/.*)$/i.exec(pattern);
  if (!m || urlPatternError(pattern)) return '(?!)';
  const [, scheme, host, port, path] = m;
  const s = scheme === '*' ? 'https?' : scheme.toLowerCase();
  const h = host === '*' ? '[^/:]+|\\[[^\\]]+\\]'
    : host.startsWith('*.') ? `(?:[^/:]+\\.)?${esc(host.slice(2).toLowerCase())}`
      : esc(host.toLowerCase());
  const p = port ? String(Number(port)) : '\\d+';
  return `^${s}://(?:${h}):${p}${path.split('*').map(esc).join('.*')}$`;
}

/** The form urlPatternRegExpSource expects. Self-contained, so a runtime can inline it. */
export function normalizedUrl(href) {
  const u = new URL(href);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.protocol}//${u.hostname.toLowerCase()}:${port}${u.pathname}`;
}
