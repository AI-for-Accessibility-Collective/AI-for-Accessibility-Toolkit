// Canonical JSON (RFC 8785, JCS) and the descriptor digest.
//
// A client pins the exact descriptor it checked with `descriptorDigest`, so
// both sides must serialize the same descriptor to the same bytes. JCS gets
// there with three rules: object keys sorted by UTF-16 code units, numbers in
// ECMAScript's shortest round-trip form, and strings escaped the way
// JSON.stringify escapes them. In JavaScript those are the built-in
// behaviours, so the reference implementation is short; the fixtures in
// fixtures/digest-vectors.json pin the bytes for implementations in other
// languages.
//
// Values JCS cannot represent are rejected rather than coerced: NaN and
// Infinity, undefined, functions, symbols, bigints, strings with lone
// surrogates, and objects that are not plain JSON objects (a Date would
// otherwise turn into a string through toJSON).

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Serialize a JSON value per RFC 8785.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical JSON: numbers must be finite');
      return JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new TypeError('canonical JSON: strings must be valid Unicode');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new TypeError('canonical JSON: only plain objects can be serialized');
      const keys = Object.keys(value).sort();
      return `{${keys.map(k => {
        if (LONE_SURROGATE.test(k)) throw new TypeError('canonical JSON: keys must be valid Unicode');
        return `${JSON.stringify(k)}:${canonicalize(value[k])}`;
      }).join(',')}}`;
    }
    default:
      throw new TypeError(`canonical JSON: ${typeof value} values cannot be serialized`);
  }
}

/** Lowercase hex SHA-256 of a UTF-8 string, through Web Crypto (browsers and Node 19+). */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('sha256: Web Crypto (globalThis.crypto.subtle) is not available in this runtime');
  const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// The fields that make up a descriptor's identity (adapter-mcp.md §4):
// the table's fields plus appId, id, name and description. Timestamps,
// ownership, availability, publishing links and the digest itself are left out.
export const DIGEST_FIELDS = Object.freeze([
  'appId', 'id', 'name', 'description', 'version', 'adapterProtocol', 'exposure',
  'reach', 'mode', 'capabilities', 'platformConstraints', 'surfaces', 'targets',
  'targetRefSchema', 'inputSchema', 'outputSchema', 'stateSchema', 'requires',
  'effects', 'operations',
]);

/** The digest-relevant subset of a descriptor, with absent fields left out. */
export function digestInput(descriptor) {
  const picked = {};
  for (const field of DIGEST_FIELDS) {
    if (descriptor[field] !== undefined) picked[field] = descriptor[field];
  }
  return picked;
}

/**
 * `sha256:<hex>` over the JCS form of `{descriptor, executionArtifactDigest}`.
 * `executionArtifactDigest` pins the installed build; it is null for a
 * metadata-only listing, which cannot execute.
 * @param {object} descriptor
 * @param {string|null} [executionArtifactDigest]
 * @returns {Promise<string>}
 */
export async function descriptorDigest(descriptor, executionArtifactDigest = null) {
  const text = canonicalize({ descriptor: digestInput(descriptor), executionArtifactDigest: executionArtifactDigest ?? null });
  return `sha256:${await sha256Hex(text)}`;
}
