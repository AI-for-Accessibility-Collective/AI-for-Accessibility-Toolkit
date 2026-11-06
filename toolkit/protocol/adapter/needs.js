// A need an adapter or an app says it meets, so the toolkit's profile agent
// can decide whether a person has it. No toolkit can list every need, so an
// adapter declares its own (descriptor `needs`) and an app registers its own
// (the profile_need_register tool): a plain phrase, what it does, and the
// abilities it is relevant to. The agent reads the person's profile and
// suggests adding the need, or taking it out; the person answers. A person
// who switches the adapter on has answered already.
//
// In the profile a need is `{dimension: "<appId>/<id>", value, ...}`, next to
// the toolkit's own needs (textSize, captions, ...). Pure data, no imports.

// descriptor.js's SLUG; not imported, since descriptor.js imports this file.
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_NEEDS = 8;

export const NEED_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['id', 'phrase', 'description', 'abilities'],
  properties: {
    id: { type: 'string', pattern: SLUG.source, description: 'Short id, unique within the app: "bigger-targets".' },
    phrase: { type: 'string', minLength: 3, maxLength: 80, description: 'What it does for a person, in plain words, as they would say it: "Bigger buttons and links".' },
    description: { type: 'string', minLength: 10, maxLength: 400, description: 'What changes on the page or in the app when the need is met.' },
    abilities: { type: 'string', minLength: 10, maxLength: 400, description: 'Who it helps, as the barrier and the abilities involved, in plain words. Conditions may be named as examples, so the profile agent can match a person\'s own words, never as who the person is: "Small targets are hard to hit: a tremor, limited hand control, a pointer held in the mouth."' },
    value: {
      type: 'object', additionalProperties: false, required: ['kind'],
      description: 'What the need holds: on (the default), or a number in a range the adapter or app reads.',
      properties: {
        kind: { enum: ['on', 'number'] },
        min: { type: 'number' }, max: { type: 'number' }, start: { type: 'number' },
        unit: { type: 'string', maxLength: 40, description: 'What the number measures, in words: "pixels", "times the usual size".' },
      },
    },
  },
});

/** Every problem with a list of needs, as {path, message}. */
export function checkNeeds(needs, base = '/needs') {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!Array.isArray(needs) || needs.length > MAX_NEEDS) { err(base, `must be a list of at most ${MAX_NEEDS} needs`); return errors; }
  const ids = new Set();
  needs.forEach((n, i) => {
    const at = `${base}/${i}`;
    if (!n || typeof n !== 'object' || Array.isArray(n)) { err(at, 'must be {id, phrase, description, abilities}'); return; }
    for (const k of Object.keys(n)) if (!NEED_SCHEMA.properties[k]) err(`${at}/${k}`, 'is not a need property (id, phrase, description, abilities, value)');
    if (typeof n.id !== 'string' || !SLUG.test(n.id)) err(`${at}/id`, 'must be a short id: lowercase letters, digits and hyphens');
    else if (ids.has(n.id)) err(`${at}/id`, `repeats "${n.id}"`);
    else ids.add(n.id);
    for (const k of ['phrase', 'description', 'abilities']) {
      const { minLength, maxLength } = NEED_SCHEMA.properties[k];
      if (typeof n[k] !== 'string' || n[k].trim().length < minLength || n[k].length > maxLength) err(`${at}/${k}`, `must be text of ${minLength} to ${maxLength} characters`);
    }
    if (n.value !== undefined) {
      const v = n.value;
      if (!v || typeof v !== 'object' || !['on', 'number'].includes(v.kind)) err(`${at}/value`, 'must be {kind: "on"} or {kind: "number", min, max}');
      else if (v.kind === 'number' && !(Number.isFinite(v.min) && Number.isFinite(v.max) && v.min < v.max && (v.start === undefined || (v.start >= v.min && v.start <= v.max)))) {
        err(`${at}/value`, 'a number needs min below max, and start between them');
      } else if (v.unit !== undefined && (typeof v.unit !== 'string' || v.unit.length > 40)) err(`${at}/value/unit`, 'must be text of at most 40 characters');
    }
  });
  return errors;
}

/** The need's name in a profile: "<appId>/<id>". */
export const needKey = (appId, id) => `${appId}/${id}`;
