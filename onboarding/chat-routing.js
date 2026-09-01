// chat-routing.js — the PURE routing heuristics behind /chat, split out so they
// can be unit-tested in node (chat.js itself imports browser-only modules).
//
// One job: decide whether a message is the person DESCRIBING THEMSELVES ("I'm
// blind") — which updates their profile — or something else (a command, a
// request) that belongs to the grammar / the receiving app.
//
// The bias is deliberately toward "not onboarding": a false positive silently
// rewrites someone's accessibility profile, which is far worse than passing a
// message through. That's why the gate below is a self-description lead-in or a
// bare condition — an earlier "any short message containing a condition word"
// rule turned "stop live captions" into a hearing profile.

// A self-description lead-in: "I'm blind", "I have dyslexia", "my hearing…",
// "I can't use a mouse".
export const SELF = /\b(i['’]?m|i am|i['’]?ve|i have|i use|i get|i can'?t|i cannot|i need|i struggle|i find|my|me)\b/i;

// A message that is JUST the condition still counts, with no lead-in. Strict
// whitelist ON PURPOSE — see the note above.
export const BARE_CONDITION = /^(blind|deaf|dyslexi[ac]|adhd|autistic|autism|low vision|partially sighted|colou?r ?blind|hard of hearing|visually impaired|screen ?reader user)\.?$/i;

// Keywords are self-DESCRIPTION words. Words that also appear in COMMANDS
// ("captions", "reading", bare "hearing", "magnify") are deliberately excluded:
// those are the grammar's job, and here they only cause false onboarding.
export const AREA_RULES = [
  { area: 'vision', re: /\bblind\b|low vision|partially sighted|visually impaired|can'?t see|cannot see|screen ?reader|voice ?over|nvda|jaws|talkback/i },
  { area: 'reading', re: /dyslexi|trouble reading|hard to read|letters (move|jump)/i },
  { area: 'cognitive', re: /cognitive|memory|plain language|simple language|trouble understanding|comprehen/i },
  { area: 'motor', re: /motor|tremor|parkinson|keyboard only|can'?t use (a |the )?mouse|switch access|shaky hands|dexterity/i },
  { area: 'hearing', re: /\bdeaf\b|hard of hearing|hearing (loss|impair|aid)|\bhoh\b/i },
  { area: 'sensory', re: /sensory|overwhelm|overload|autis|flashing/i },
  { area: 'attention', re: /adhd|attention deficit|can'?t focus|hard to focus|distracted|can'?t concentrate|trouble concentrat/i },
];

/**
 * Which visual population does this describe? A blind screen-reader user needs
 * the OPPOSITE of magnification, so "vision" must never be treated as one
 * answer. Mirrors the server's isBlindText.
 * @returns {'blind'|'lowVision'|null}
 */
export function visionKindOf(text) {
  const s = String(text || '').toLowerCase();
  if (/colou?r[- ]?blind/.test(s)) return null; // a colour-vision deficiency, not blindness
  if (/screen ?reader|voice ?over|nvda|jaws|talkback|can'?t see|cannot see|totally blind|completely blind|\bblind\b/.test(s)
      && !/legally blind/.test(s)) return 'blind';
  if (/low vision|partially sighted|bigger text|magnif|too small|hard to see/.test(s)) return 'lowVision';
  return null;
}

/**
 * @param {string} text
 * @returns {{supportAreas:string[], freeText:string, visionKind?:string}|null}
 *   null when the message is NOT a self-description (i.e. leave it alone).
 */
export function detectOnboarding(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const areas = [];
  for (const r of AREA_RULES) if (r.re.test(t)) areas.push(r.area);
  if (!areas.length) return null;
  // It must READ as a self-description, or be nothing but the condition itself.
  if (!SELF.test(t) && !BARE_CONDITION.test(t)) return null;
  const visionKind = areas.includes('vision') ? (visionKindOf(t) || undefined) : undefined;
  return { supportAreas: [...new Set(areas)], freeText: t, visionKind };
}
