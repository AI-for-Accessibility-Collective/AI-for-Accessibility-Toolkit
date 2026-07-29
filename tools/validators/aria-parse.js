// Parsing an accessibility snapshot.
//
// Input is the indented text an AX tree renders to -- the same shape the
// harness emits and the same shape saved page captures are stored in, so a
// reader can be developed against files and run unchanged against a live tab.
//
// The two producers differ in one cosmetic way. A capture writes text content
// as `- listitem: "Items (3)"` and a container as `- link "Checkout":`, while
// the harness writes `- listitem "Items (3)"` for both. The colon carries no
// information, so it is treated as decoration and stripped.
//
// Pure: no imports, no DOM, no chrome.*.

/**
 * @typedef {Object} AxLine
 * @property {number} depth   indentation level, 0 at the root
 * @property {string} role    e.g. heading, listitem, radio, text
 * @property {string} name    accessible name or text content, '' when absent
 * @property {string[]} flags bracketed states, e.g. ['checked'], ['level=2']
 * @property {string} raw     the original line, for error messages
 */

const BULLET = /^(\s*)-\s+(.*)$/;
// A role is one word. Anything after it is the name, the text, or nothing.
const HEAD = /^([A-Za-z_][\w-]*)\s*(:)?\s*(.*)$/;
const TRAILING_FLAGS = /((?:\[[^\]]*\]\s*)+)$/;

/**
 * Parse a snapshot into a flat list of lines with depth.
 * Skips blanks, a leading `URL:`, and `- /url:` link targets, which are not
 * page content.
 *
 * @param {string} text
 * @returns {AxLine[]}
 */
export function parseAria(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (!raw.trim() || raw.startsWith('URL:')) continue;
    const b = BULLET.exec(raw);
    if (!b) continue;

    const indent = b[1].length;
    let rest = b[2].trim();
    if (!rest || rest.startsWith('/url')) continue;

    // Whole entry wrapped in single quotes when the name contains a colon or
    // a hash: `- 'link "Quick & Delicious #recipe"'`. A node with children
    // carries a trailing colon outside the quotes, as in
    // `- 'link "$8.99 Typical: $14.99"':` — which is how a discounted tile
    // arrives, so the closing quote must be found rather than assumed last.
    if (rest.length > 1 && rest[0] === "'") {
      const close = rest.lastIndexOf("'");
      if (close > 0) rest = rest.slice(1, close).trim();
    }

    const h = HEAD.exec(rest);
    if (!h) continue;
    const role = h[1];
    let tail = (h[3] || '').trim();

    // Trailing bracketed states, e.g. [checked] or [level=2].
    let flags = [];
    const f = TRAILING_FLAGS.exec(tail);
    if (f) {
      flags = f[1].split(/[\[\]]/).map((s) => s.trim()).filter(Boolean);
      tail = tail.slice(0, f.index).trim();
    }

    // The name is quoted when it needs to be, bare otherwise. A trailing colon
    // just marks "has children" and carries nothing.
    if (tail.endsWith(':')) tail = tail.slice(0, -1).trim();
    const q = /^"([\s\S]*)"$/.exec(tail);
    const name = q ? q[1] : tail;

    out.push({ depth: Math.floor(indent / 2), role, name, flags, raw });
  }
  return out;
}

/** Every line whose role matches, in document order. */
export function byRole(lines, role) {
  return lines.filter((l) => l.role === role);
}

/** First line whose text (role name) matches a pattern. */
export function find(lines, re) {
  return lines.find((l) => re.test(l.name)) || null;
}

/** All lines whose text matches a pattern. */
export function findAll(lines, re) {
  return lines.filter((l) => re.test(l.name));
}

/**
 * First capture group of the first line matching `re`, or null.
 * @param {AxLine[]} lines
 * @param {RegExp} re  must contain at least one capture group
 */
export function capture(lines, re) {
  for (const l of lines) {
    const m = re.exec(l.name);
    if (m) return m[1];
  }
  return null;
}

/** Parse "$24.50" / "24.50" / "$1,234.50" into a number, or null. */
export function money(s) {
  if (s == null) return null;
  const m = /-?\$?\s*([\d,]+(?:\.\d{1,2})?)/.exec(String(s));
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** Parse "512" / "1,048" into a number, or null. */
export function count(s) {
  if (s == null) return null;
  const m = /([\d,]+)/.exec(String(s));
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** Does this line carry a bracketed state, e.g. [checked] or [disabled]? */
export function hasFlag(line, flag) {
  return !!line && line.flags.some((f) => f === flag || f.startsWith(flag + '='));
}

/** Value of a `key=value` flag, e.g. level on a heading. */
export function flagValue(line, key) {
  if (!line) return null;
  for (const f of line.flags) {
    const m = new RegExp(`^${key}=(.*)$`).exec(f);
    if (m) return m[1];
  }
  return null;
}
