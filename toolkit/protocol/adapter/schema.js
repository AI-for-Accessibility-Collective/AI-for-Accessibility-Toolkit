// A small JSON Schema 2020-12 validator for the subset Adapter MCP uses.
//
// Adapter descriptors carry JSON Schemas (inputSchema, outputSchema,
// stateSchema, targetRefSchema) that a provider must enforce before it runs
// anything. The toolkit has no dependencies, so instead of pulling in a full
// validator this file implements the keywords those schemas need and FAILS
// CLOSED on the rest: `checkSchema` rejects a schema that uses an assertion
// keyword this file does not implement, so a publisher learns at registration
// time that a constraint would have been silently ignored.
//
// Supported assertions: type, enum, const, properties, required,
// additionalProperties, items, minItems, maxItems, uniqueItems, minimum,
// maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength,
// maxLength, pattern, anyOf, oneOf, allOf, not, $ref (local "#/$defs/…" only).
// Everything else that is not a known assertion is treated as an annotation
// (title, description, default, examples, format, unit, x-*, …) and ignored,
// as the JSON Schema spec allows.

const SUPPORTED = new Set([
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength',
  'maxLength', 'pattern', 'anyOf', 'oneOf', 'allOf', 'not', '$ref', '$defs',
]);

// Assertion keywords from 2020-12 this validator does not implement. A schema
// using one is rejected by checkSchema rather than half-enforced.
const UNSUPPORTED = new Set([
  'patternProperties', 'propertyNames', 'dependentRequired', 'dependentSchemas',
  'if', 'then', 'else', 'contains', 'minContains', 'maxContains', 'prefixItems',
  'unevaluatedItems', 'unevaluatedProperties', 'minProperties', 'maxProperties',
  '$dynamicRef', '$anchor', '$dynamicAnchor', '$recursiveRef', 'definitions',
]);

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const MAX_DEPTH = 64;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'non-finite';
  return typeof value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep equality over JSON values (for enum, const and uniqueItems). */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

/**
 * Check that `schema` is a schema this validator can enforce completely.
 * @param {unknown} schema
 * @param {string} [path]
 * @returns {{path: string, message: string}[]} empty when the schema is usable
 */
export function checkSchema(schema, path = '') {
  const errors = [];
  const root = schema;
  function visit(node, at, depth) {
    if (depth > MAX_DEPTH) { errors.push({ path: at, message: 'schema is nested too deeply' }); return; }
    if (typeof node === 'boolean') return;
    if (!isPlainObject(node)) { errors.push({ path: at, message: 'a schema must be an object or a boolean' }); return; }
    for (const key of Object.keys(node)) {
      if (UNSUPPORTED.has(key)) errors.push({ path: `${at}/${key}`, message: `"${key}" is not supported by the Adapter MCP validator; express the constraint with the supported subset` });
    }
    if ('type' in node) {
      const list = Array.isArray(node.type) ? node.type : [node.type];
      if (!list.length || list.some(t => !TYPES.has(t))) errors.push({ path: `${at}/type`, message: 'type must be one of object, array, string, number, integer, boolean, null' });
    }
    if ('enum' in node && (!Array.isArray(node.enum) || !node.enum.length)) errors.push({ path: `${at}/enum`, message: 'enum must be a non-empty array' });
    if ('required' in node && (!Array.isArray(node.required) || node.required.some(r => typeof r !== 'string'))) errors.push({ path: `${at}/required`, message: 'required must be an array of strings' });
    if ('pattern' in node) {
      try { new RegExp(node.pattern, 'u'); } catch { errors.push({ path: `${at}/pattern`, message: 'pattern is not a valid regular expression' }); }
    }
    if ('$ref' in node && (typeof node.$ref !== 'string' || !/^#\/\$defs\/[^/]+$/.test(node.$ref) || !isPlainObject(root) || !isPlainObject(root.$defs) || !Object.hasOwn(root.$defs, node.$ref.slice(8)))) {
      errors.push({ path: `${at}/$ref`, message: '$ref must point at an existing local "#/$defs/<name>"' });
    }
    for (const n of ['minItems', 'maxItems', 'minLength', 'maxLength']) {
      if (n in node && !(Number.isInteger(node[n]) && node[n] >= 0)) errors.push({ path: `${at}/${n}`, message: `${n} must be a non-negative integer` });
    }
    for (const n of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (n in node && typeOf(node[n]) !== 'number') errors.push({ path: `${at}/${n}`, message: `${n} must be a number` });
    }
    if ('multipleOf' in node && !(typeOf(node.multipleOf) === 'number' && node.multipleOf > 0)) errors.push({ path: `${at}/multipleOf`, message: 'multipleOf must be a positive number' });
    if (isPlainObject(node.properties)) for (const [k, v] of Object.entries(node.properties)) visit(v, `${at}/properties/${k}`, depth + 1);
    else if ('properties' in node) errors.push({ path: `${at}/properties`, message: 'properties must be an object' });
    if (isPlainObject(node.$defs)) for (const [k, v] of Object.entries(node.$defs)) visit(v, `${at}/$defs/${k}`, depth + 1);
    if ('additionalProperties' in node) visit(node.additionalProperties, `${at}/additionalProperties`, depth + 1);
    if ('items' in node) visit(node.items, `${at}/items`, depth + 1);
    if ('not' in node) visit(node.not, `${at}/not`, depth + 1);
    for (const n of ['anyOf', 'oneOf', 'allOf']) {
      if (!(n in node)) continue;
      if (!Array.isArray(node[n]) || !node[n].length) errors.push({ path: `${at}/${n}`, message: `${n} must be a non-empty array` });
      else node[n].forEach((s, i) => visit(s, `${at}/${n}/${i}`, depth + 1));
    }
  }
  visit(schema, path, 0);
  return errors;
}

/**
 * Validate `value` against `schema`. The schema should already have passed
 * checkSchema; an unsupported keyword here is ignored, not enforced.
 * @param {unknown} schema
 * @param {unknown} value
 * @param {string} [path] JSON-pointer-ish prefix for error paths
 * @returns {{path: string, message: string}[]} empty when valid
 */
export function validate(schema, value, path = '') {
  const errors = [];
  const root = schema;
  function visit(node, v, at, depth) {
    if (depth > MAX_DEPTH) { errors.push({ path: at, message: 'value is nested too deeply' }); return; }
    if (node === true || node === undefined) return;
    if (node === false) { errors.push({ path: at, message: 'no value is allowed here' }); return; }
    if (!isPlainObject(node)) return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/') && isPlainObject(root) && isPlainObject(root.$defs)) {
      visit(root.$defs[node.$ref.slice(8)], v, at, depth + 1);
    }
    const t = typeOf(v);
    if (t === 'non-finite' || t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
      errors.push({ path: at, message: 'value is not JSON (NaN, Infinity, undefined and functions cannot be sent)' });
      return;
    }
    if ('type' in node) {
      const allowed = Array.isArray(node.type) ? node.type : [node.type];
      const ok = allowed.some(a => a === t || (a === 'integer' && t === 'number' && Number.isInteger(v)) || (a === 'number' && t === 'number'));
      if (!ok) { errors.push({ path: at, message: `must be ${allowed.join(' or ')}` }); return; }
    }
    if ('const' in node && !jsonEqual(node.const, v)) errors.push({ path: at, message: `must equal ${JSON.stringify(node.const)}` });
    if (Array.isArray(node.enum) && !node.enum.some(e => jsonEqual(e, v))) errors.push({ path: at, message: `must be one of ${node.enum.map(e => JSON.stringify(e)).join(', ')}` });
    if (t === 'number') {
      if (typeof node.minimum === 'number' && v < node.minimum) errors.push({ path: at, message: `must be at least ${node.minimum}` });
      if (typeof node.maximum === 'number' && v > node.maximum) errors.push({ path: at, message: `must be at most ${node.maximum}` });
      if (typeof node.exclusiveMinimum === 'number' && v <= node.exclusiveMinimum) errors.push({ path: at, message: `must be more than ${node.exclusiveMinimum}` });
      if (typeof node.exclusiveMaximum === 'number' && v >= node.exclusiveMaximum) errors.push({ path: at, message: `must be less than ${node.exclusiveMaximum}` });
      if (typeof node.multipleOf === 'number' && node.multipleOf > 0) {
        const q = v / node.multipleOf;
        if (Math.abs(q - Math.round(q)) > 1e-9) errors.push({ path: at, message: `must be a multiple of ${node.multipleOf}` });
      }
    }
    if (t === 'string') {
      const length = [...v].length;
      if (Number.isInteger(node.minLength) && length < node.minLength) errors.push({ path: at, message: `must be at least ${node.minLength} characters` });
      if (Number.isInteger(node.maxLength) && length > node.maxLength) errors.push({ path: at, message: `must be at most ${node.maxLength} characters` });
      if (typeof node.pattern === 'string') {
        let re = null;
        try { re = new RegExp(node.pattern, 'u'); } catch { /* checkSchema reports it */ }
        if (re && !re.test(v)) errors.push({ path: at, message: `must match ${node.pattern}` });
      }
    }
    if (t === 'array') {
      if (Number.isInteger(node.minItems) && v.length < node.minItems) errors.push({ path: at, message: `must have at least ${node.minItems} items` });
      if (Number.isInteger(node.maxItems) && v.length > node.maxItems) errors.push({ path: at, message: `must have at most ${node.maxItems} items` });
      if (node.uniqueItems === true) {
        for (let i = 0; i < v.length; i++) {
          if (v.slice(0, i).some(o => jsonEqual(o, v[i]))) { errors.push({ path: `${at}/${i}`, message: 'items must be unique' }); break; }
        }
      }
      if ('items' in node) v.forEach((item, i) => visit(node.items, item, `${at}/${i}`, depth + 1));
    }
    if (t === 'object') {
      if (Array.isArray(node.required)) {
        for (const key of node.required) if (!Object.hasOwn(v, key)) errors.push({ path: `${at}/${key}`, message: 'is required' });
      }
      const props = isPlainObject(node.properties) ? node.properties : {};
      for (const [key, child] of Object.entries(v)) {
        if (Object.hasOwn(props, key)) visit(props[key], child, `${at}/${key}`, depth + 1);
        else if ('additionalProperties' in node) {
          if (node.additionalProperties === false) errors.push({ path: `${at}/${key}`, message: 'is not an allowed property' });
          else visit(node.additionalProperties, child, `${at}/${key}`, depth + 1);
        }
      }
    }
    const sub = (s) => { const before = errors.length; visit(s, v, at, depth + 1); const found = errors.splice(before); return found; };
    if (Array.isArray(node.allOf)) for (const s of node.allOf) errors.push(...sub(s));
    if (Array.isArray(node.anyOf) && !node.anyOf.some(s => sub(s).length === 0)) errors.push({ path: at, message: 'must match at least one of the allowed shapes (anyOf)' });
    if (Array.isArray(node.oneOf)) {
      const matches = node.oneOf.filter(s => sub(s).length === 0).length;
      if (matches !== 1) errors.push({ path: at, message: `must match exactly one of the allowed shapes (oneOf matched ${matches})` });
    }
    if ('not' in node && sub(node.not).length === 0) errors.push({ path: at, message: 'must not match the excluded shape (not)' });
  }
  visit(schema, value, path, 0);
  return errors;
}

/** One readable line for a list of validation errors. */
export function formatErrors(errors, limit = 5) {
  const shown = errors.slice(0, limit).map(e => `${e.path || '(root)'} ${e.message}`);
  if (errors.length > limit) shown.push(`and ${errors.length - limit} more`);
  return shown.join('; ');
}
