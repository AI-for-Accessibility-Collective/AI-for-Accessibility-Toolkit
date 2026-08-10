// Protocol conformance test (Gap 3, deliverable 3) — proves the versioned
// JSON Schemas in toolkit/protocol/ actually describe what the engine
// produces and accepts, not just what someone wrote down.
//
//   (a) REAL output from toolkit/sync/blob.js (via librarian.exportProfileBlob)
//       and toolkit/sync/transport.js (via createSharedTransport, both the
//       export-envelope and inbox-entry flavors) validates against the
//       schemas. insight-outbox has no JS-side PRODUCER (only ArtInsight-style
//       consumer apps build one) — for that shape we instead prove the
//       inverse: a schema-valid outbox is exactly what
//       librarian.importInsightOutbox accepts.
//   (b) The valid/invalid example documents under toolkit/protocol/fixtures/
//       pass/fail exactly as their names claim.
//
// No ajv, no npm dependency: the validator below is a small, dependency-free
// subset of JSON Schema draft-07 — just the keywords the 3 schemas actually
// use (type, required, const, enum, properties, items, additionalProperties).
// It is intentionally not a general-purpose validator (no oneOf/anyOf/$ref/
// pattern/numeric bounds) — see protocol/README.md for what that tradeoff
// means for the transport-envelope schema's two flavors.
//
//   node toolkit/test/protocol-conformance-test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolkit, createSharedTransport } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_DIR = path.join(__dirname, '..', 'protocol');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

// ============================== the mini validator ==============================

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'object' | 'string' | 'number' | 'boolean'
}

/** Returns an array of human-readable error strings; empty = valid. */
function validate(schema, data, at = '$') {
  const errors = [];
  if (schema.const !== undefined) {
    if (JSON.stringify(data) !== JSON.stringify(schema.const)) {
      errors.push(`${at}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
    }
    return errors; // const is exact-value; nothing else meaningfully adds to it
  }
  if (schema.enum !== undefined && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(data))) {
    errors.push(`${at}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.includes(typeOf(data))) {
      errors.push(`${at}: expected type ${types.join('|')}, got ${typeOf(data)}`);
      return errors; // wrong shape entirely; descending further would be noise
    }
  }
  if (typeOf(data) === 'object' && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    for (const key of (schema.required || [])) {
      if (!(key in data)) errors.push(`${at}: missing required property "${key}"`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties || {})) {
      if (key in data) errors.push(...validate(subSchema, data[key], `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) errors.push(`${at}: unexpected property "${key}"`);
      }
    }
  }
  if (typeOf(data) === 'array' && schema.items) {
    data.forEach((item, i) => errors.push(...validate(schema.items, item, `${at}[${i}]`)));
  }
  return errors;
}

function isValid(schema, data) { return validate(schema, data).length === 0; }

// ============================== load schemas + fixtures ==============================

function readJSON(...parts) { return JSON.parse(readFileSync(path.join(...parts), 'utf8')); }

const schemas = {
  profileBlob: readJSON(PROTOCOL_DIR, 'profile-blob.schema.json'),
  insightOutbox: readJSON(PROTOCOL_DIR, 'insight-outbox.schema.json'),
  transportEnvelope: readJSON(PROTOCOL_DIR, 'transport-envelope.schema.json'),
};

// A couple of self-tests for the validator itself, so a bug in it can't
// silently make every fixture check below pass for the wrong reason.
check('validator: rejects a document missing a required property', !isValid({ type: 'object', required: ['a'] }, {}));
check('validator: rejects an out-of-enum value', !isValid({ type: 'string', enum: ['x', 'y'] }, 'z'));
check('validator: rejects a wrong const', !isValid({ const: 1 }, 2));
check('validator: rejects an unexpected property under additionalProperties:false',
  !isValid({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { a: 'ok', b: 'nope' }));
check('validator: accepts a genuinely matching document',
  isValid({ type: 'object', required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: false }, { a: 'ok' }));

// ============================== (b) fixtures pass/fail as claimed ==============================

function checkFixtureSet(label, schema, validFile, invalidFile) {
  const validDoc = readJSON(PROTOCOL_DIR, 'fixtures', validFile);
  const validDocs = Array.isArray(validDoc) ? validDoc : [{ name: '(single)', doc: validDoc }];
  for (const { name, doc } of validDocs) {
    const errors = validate(schema, doc);
    check(`${label} valid fixture "${name}" passes`, errors.length === 0);
    if (errors.length) console.log('   ', errors.join('\n    '));
  }
  const invalidDocs = readJSON(PROTOCOL_DIR, 'fixtures', invalidFile);
  for (const { name, doc } of invalidDocs) {
    check(`${label} invalid fixture "${name}" is rejected`, !isValid(schema, doc));
  }
}

checkFixtureSet('profile-blob', schemas.profileBlob, 'profile-blob.valid.json', 'profile-blob.invalid.json');
checkFixtureSet('insight-outbox', schemas.insightOutbox, 'insight-outbox.valid.json', 'insight-outbox.invalid.json');
checkFixtureSet('transport-envelope', schemas.transportEnvelope, 'transport-envelope.valid.json', 'transport-envelope.invalid.json');

// ============================== (a) real engine output conforms ==============================

function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area]?.[key]; },
    async set(area, key, value) {
      areas[area] = areas[area] || {};
      if (value === undefined) delete areas[area][key];
      else areas[area][key] = JSON.parse(JSON.stringify(value));
    },
    async getAll(area) { return { ...(areas[area] || {}) }; },
  };
}
const clock = { now: () => 5_000_000 };
const toolsRegistry = {
  settingsMeta: { fontScale: { type: 'number', range: [50, 200] } },
  settingsVocabularyLines: () => [],
};

const { datastore, librarian } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await datastore.runMigrations();
await librarian.setProfileField('supportAreas', ['vision']);
await librarian.setProfileField('fields.needs', [
  { dimension: 'textSize', value: 1.6, strength: 'preference', source: 'xr-headset' },
]);

// --- profile blob, produced by the REAL blob.js via exportProfileBlob() ---
const realBlob = await librarian.exportProfileBlob();
const blobErrors = validate(schemas.profileBlob, realBlob);
check('real exportProfileBlob() output conforms to profile-blob.schema.json', blobErrors.length === 0);
if (blobErrors.length) console.log('   ', blobErrors.join('\n    '));

// --- transport envelopes, produced by the REAL transport.js ---
function sharedStore() {
  const box = {};
  return {
    async get(k) { return box[k]; },
    async set(k, v) { if (v === undefined) delete box[k]; else box[k] = JSON.parse(JSON.stringify(v)); },
    async remove(k) { delete box[k]; },
    _raw: box, // test-only escape hatch to inspect what the transport actually wrote
  };
}
const shared = sharedStore();
const transport = createSharedTransport({ shared, clock });

const grantReq = await librarian.requestGrant('artinsight', ['ability.categories', 'settings.text'], { appLabel: 'ArtInsight' });
await librarian.respondToProposal(grantReq.proposalId, 'accept');
await transport.publishExports(librarian);
const exportEnvelope = shared._raw['aa.shared.export.artinsight'];
const exportErrors = validate(schemas.transportEnvelope, exportEnvelope);
check('real publishExports() export-envelope conforms to transport-envelope.schema.json', exportErrors.length === 0);
if (exportErrors.length) console.log('   ', exportErrors.join('\n    '));

await transport.postInsight('artinsight', {
  kind: 'visual.textSize', confidence: 0.8, label: 'test', rationale: 'test',
  change: { op: 'profile-set', path: 'fields.needs', value: [{ dimension: 'textSize', value: 1.7, strength: 'preference' }] },
});
const inboxEnvelope = shared._raw['aa.shared.inbox'][0];
const inboxErrors = validate(schemas.transportEnvelope, inboxEnvelope);
check('real postInsight() inbox-entry envelope conforms to transport-envelope.schema.json', inboxErrors.length === 0);
if (inboxErrors.length) console.log('   ', inboxErrors.join('\n    '));

// --- insight outbox: no JS-side producer, so prove the INVERSE — a
// schema-valid outbox is exactly what the real importInsightOutbox accepts. ---
const outboxFixture = readJSON(PROTOCOL_DIR, 'fixtures', 'insight-outbox.valid.json');
check('the valid outbox fixture conforms to insight-outbox.schema.json', isValid(schemas.insightOutbox, outboxFixture));
const outboxResult = await librarian.importInsightOutbox(outboxFixture);
check('the real engine accepts a schema-valid outbox (grant already active)',
  outboxResult.ok === true && outboxResult.results.every(r => r.ok === true));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
