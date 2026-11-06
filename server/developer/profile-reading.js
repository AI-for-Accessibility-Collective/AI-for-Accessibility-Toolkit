// The free text's Update button: the toolkit's reading of the words (the
// `profile` AI task, as the extension's Profile tab saves them) changes the
// profile below only where it differs. Areas and needs the reading does not
// know about stay as they are; a need it keeps the same value for is left
// untouched, its level and source included. Pure: no DOM, no network.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Apply a reading (blocks/profile-words.js cleanProfileReading) to a profile
 * in place. Returns what changed, in words, empty when nothing needed to.
 * @param {object} profile
 * @param {string} words
 * @param {{supportAreas: string[], needs: {dimension: string, value: any}[], plainLanguage: boolean, summary: string}} reading
 * @param {{areas: {id: string, name: string}[], needs: object[]}} vocabulary  PROFILE_AREAS and PROFILE_NEEDS
 */
export function applyProfileReading(profile, words, reading, vocabulary) {
  const changes = [];
  const areaNames = new Map(vocabulary.areas.map(a => [a.id, a.name.toLowerCase()]));
  const needOf = new Map(vocabulary.needs.map(d => [d.id, d]));
  const shown = (dimension, value) => {
    const d = needOf.get(dimension);
    return d.kind === 'number' ? `${d.name} ${d.show(Number(value))}` : d.name;
  };
  const list = items => items.join(', ');

  profile.freeText = words;

  const areas = Array.isArray(profile.supportAreas) ? profile.supportAreas : [];
  const addedAreas = reading.supportAreas.filter(a => !areas.includes(a));
  const removedAreas = areas.filter(a => areaNames.has(a) && !reading.supportAreas.includes(a));
  if (addedAreas.length || removedAreas.length) {
    profile.supportAreas = [...areas.filter(a => !removedAreas.includes(a)), ...addedAreas];
    if (addedAreas.length) changes.push(`added support for ${list(addedAreas.map(a => areaNames.get(a)))}`);
    if (removedAreas.length) changes.push(`removed support for ${list(removedAreas.map(a => areaNames.get(a)))}`);
  }

  const needs = Array.isArray(profile.fields?.needs) ? profile.fields.needs : [];
  const read = new Map(reading.needs.map(n => [n.dimension, n.value]));
  const next = [], added = [], changed = [], removed = [];
  for (const need of needs) {
    const d = needOf.get(need?.dimension);
    if (!d) { next.push(need); continue; }
    if (!read.has(d.id)) {
      // A switch that is already off says what the reading says.
      if (d.kind === 'on' && need.value !== true) next.push(need);
      else removed.push(shown(d.id, need.value));
      continue;
    }
    const value = read.get(d.id);
    read.delete(d.id);
    if (same(need.value, value)) next.push(need);
    else {
      next.push({ ...need, value, source: 'person-words' });
      changed.push(d.kind === 'number' && Number.isFinite(Number(need.value)) ? `${d.name} from ${d.show(Number(need.value))} to ${d.show(Number(value))}` : shown(d.id, value));
    }
  }
  for (const [dimension, value] of read) {
    next.push({ dimension, value, strength: 'preference', source: 'person-words' });
    added.push(shown(dimension, value));
  }
  if (added.length || changed.length || removed.length) {
    profile.fields = { ...(profile.fields || {}), needs: next };
    if (added.length) changes.push(`added ${list(added)}`);
    if (changed.length) changes.push(`changed ${list(changed)}`);
    if (removed.length) changes.push(`removed ${list(removed)}`);
  }

  const summary = profile.fields?.wordsSummary ?? '';
  if (reading.summary !== summary) {
    profile.fields = { ...(profile.fields || {}) };
    if (reading.summary) profile.fields.wordsSummary = reading.summary;
    else delete profile.fields.wordsSummary;
    changes.push('updated the summary');
  }

  const language = reading.plainLanguage ? 'plain' : 'standard';
  if ((profile.metaPreferences?.language ?? 'standard') !== language) {
    profile.metaPreferences = { ...(profile.metaPreferences || {}), language };
    changes.push(`turned plain language ${reading.plainLanguage ? 'on' : 'off'}`);
  }
  return changes;
}
