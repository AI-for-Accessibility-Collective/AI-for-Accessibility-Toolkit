// The person's profile in plain words: the support areas and the neutral
// needs a web page can meet (platforms/chrome/web-surface.js
// WEB_DERIVATION), with the names a person reads and the values each takes.
// The `profile` AI task (blocks/ai/prompts.js) turns a person's own
// description of their abilities into these; the extension's Profile tab
// shows them and lets the person change them. Pure: no DOM, no network.

import { SUPPORT_AREAS } from '../core/ability.js';

const AREA_NAMES = { vision: 'Vision', hearing: 'Hearing', motor: 'Movement and dexterity', cognitive: 'Memory and attention', reading: 'Reading', sensory: 'Sensory sensitivity' };
export const PROFILE_AREAS = Object.freeze(SUPPORT_AREAS.map(id => ({ id, name: AREA_NAMES[id] || id })));

// kind 'number': a value in [min, max]; kind 'on': true when the need is there.
export const PROFILE_NEEDS = Object.freeze([
  { id: 'textSize', name: 'Larger text', kind: 'number', min: 1, max: 3, step: 0.1, start: 1.25, unit: 'times the page’s size', show: (v) => `${Math.round(v * 100)}%` },
  { id: 'lineSpacing', name: 'More space between lines', kind: 'number', min: 1, max: 3, step: 0.1, start: 1.5, unit: 'times the text height', show: (v) => `${v}` },
  { id: 'letterSpacing', name: 'More space between letters', kind: 'number', min: 0, max: 0.5, step: 0.02, start: 0.12, unit: 'em', show: (v) => `${v} em` },
  { id: 'contrast', name: 'More contrast', kind: 'on' },
  { id: 'darkTheme', name: 'Dark pages', kind: 'on' },
  { id: 'reduceMotion', name: 'Less motion and animation', kind: 'on' },
  { id: 'simplify', name: 'Simpler words', kind: 'on' },
  { id: 'readAloud', name: 'Read pages aloud', kind: 'on' },
  { id: 'readAloudRate', name: 'Reading-aloud speed', kind: 'number', min: 0.5, max: 2, step: 0.1, start: 1, unit: 'times normal speed', show: (v) => `${v}×` },
  { id: 'captions', name: 'Captions on videos', kind: 'on' },
  { id: 'describeImages', name: 'Describe images', kind: 'on' },
  { id: 'labelControls', name: 'Name unlabeled buttons and fields', kind: 'on' },
  { id: 'keyboardAccess', name: 'Use pages by keyboard', kind: 'on' },
  { id: 'skipLinks', name: 'Skip to the main content', kind: 'on' },
  { id: 'pageStructure', name: 'An outline of each page', kind: 'on' },
  { id: 'repairLandmarks', name: 'Repair page regions for screen readers', kind: 'on' },
  { id: 'announceUpdates', name: 'Announce changes on the page', kind: 'on' },
  { id: 'spaAnnounce', name: 'Announce new views in web apps', kind: 'on' },
]);

/** How a need reads to the person, e.g. "Larger text: 150%", or null for one that is off. */
export function needText(n) {
  const d = PROFILE_NEEDS.find(x => x.id === n?.dimension);
  if (!d) return null;
  if (d.kind === 'number') return Number.isFinite(Number(n.value)) ? `${d.name}: ${d.show(Number(n.value))}` : null;
  return n.value ? d.name : null;
}

/**
 * A model's reading of a description, checked: only known areas and needs,
 * values in range. Returns {supportAreas, needs: [{dimension, value}],
 * plainLanguage, summary} or null when it is not that shape.
 */
export function cleanProfileReading(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    try { o = JSON.parse(text); } catch { return null; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const supportAreas = [...new Set((Array.isArray(o.supportAreas) ? o.supportAreas : []).filter(a => SUPPORT_AREAS.includes(a)))];
  const needs = [];
  // {dimension: value} from the model, or [{dimension, value}] as this returns it (read twice: the service, then the extension).
  const given = Array.isArray(o.needs) ? Object.fromEntries(o.needs.filter(n => n && typeof n.dimension === 'string').map(n => [n.dimension, n.value]))
    : o.needs && typeof o.needs === 'object' ? o.needs : {};
  for (const d of PROFILE_NEEDS) {
    if (!(d.id in given)) continue;
    const v = given[d.id];
    if (d.kind === 'on') { if (v === true) needs.push({ dimension: d.id, value: true }); continue; }
    const n = Number(v);
    if (typeof v === 'boolean' || !Number.isFinite(n)) continue;
    const stepped = Math.round(Math.round(n / d.step) * d.step * 1000) / 1000;
    needs.push({ dimension: d.id, value: Math.min(d.max, Math.max(d.min, stepped)) });
  }
  return {
    supportAreas, needs,
    plainLanguage: o.plainLanguage === true,
    summary: typeof o.summary === 'string' ? o.summary.trim().slice(0, 300) : '',
  };
}
