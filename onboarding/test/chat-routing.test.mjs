// /chat routing heuristics — does a message read as the person DESCRIBING
// THEMSELVES (update their profile), or is it a command/request that belongs to
// the grammar and the app?
//
// The bias is toward NOT onboarding: a false positive silently rewrites
// someone's accessibility profile. The regression that prompted these tests:
// "stop live captions" onboarded the *hearing* area (the word "captions" was a
// hearing keyword, and any message of ≤4 words bypassed the self-description
// gate) instead of turning captions off.
//
// Run: node onboarding/test/chat-routing.test.mjs
import { detectOnboarding, visionKindOf, isResetToProfile } from '../chat-routing.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

// ── commands must NEVER onboard ──────────────────────────────────────────────
const COMMANDS = [
  'stop live captions', 'no live captions', 'show captions', 'turn on subtitles',
  'captions off', 'turn off cc', 'read this to me', 'bigger text', 'dark mode',
  'hide distractions', 'magnify this page', 'stop reading', 'reading ruler',
  'play a podcast from spotify', 'remember my spot', 'reduce motion',
];
for (const c of COMMANDS) check(`command not onboarded: "${c}"`, detectOnboarding(c) === null);

// ── self-descriptions DO onboard ─────────────────────────────────────────────
const SELF_DESC = [
  ["I'm blind", 'vision', 'blind'],
  ['I am deaf', 'hearing', undefined],
  ['I have dyslexia', 'reading', undefined],
  ['I use a screen reader', 'vision', 'blind'],
  ['I have low vision', 'vision', 'lowVision'],
  ['my hearing loss makes videos hard', 'hearing', undefined],
  ["I can't use a mouse", 'motor', undefined],
  ['I have ADHD', 'attention', undefined],
];
for (const [text, area, kind] of SELF_DESC) {
  const r = detectOnboarding(text);
  check(`self-description onboards: "${text}" → ${area}`, !!r && r.supportAreas.includes(area));
  if (kind) check(`  …with visionKind=${kind}`, r && r.visionKind === kind);
}

// ── a bare condition counts, with no lead-in ─────────────────────────────────
for (const [text, area] of [['blind', 'vision'], ['deaf', 'hearing'], ['dyslexia', 'reading'], ['low vision', 'vision'], ['adhd', 'attention']]) {
  const r = detectOnboarding(text);
  check(`bare condition onboards: "${text}" → ${area}`, !!r && r.supportAreas.includes(area));
}

// ── vision kind: blind vs low vision are OPPOSITE needs ──────────────────────
check('visionKindOf: "colour blind" is not blindness', visionKindOf('I am colour blind') === null);
check('visionKindOf: "legally blind" is not treated as no-vision', visionKindOf('I am legally blind') !== 'blind');
check('visionKindOf: screen reader → blind', visionKindOf('I use NVDA') === 'blind');
check('visionKindOf: low vision → lowVision', visionKindOf('I have low vision') === 'lowVision');

// ── nothing recognizable → null ──────────────────────────────────────────────
for (const c of ['', '   ', 'what is the weather', 'open google and search for apples']) {
  check(`no condition → null: "${c}"`, detectOnboarding(c) === null);
}

// ── multiple areas in one sentence ───────────────────────────────────────────
{
  const r = detectOnboarding('I am deaf and I have dyslexia');
  check('multiple areas detected together', !!r && r.supportAreas.includes('hearing') && r.supportAreas.includes('reading'));
}

// ── "back to my profile" ─────────────────────────────────────────────────────
for (const t of [
  'back to my profile', 'reset my settings', 'go back to my profile', 'start over',
  'start again', 'restore my preferences', 'reset to defaults', 'forget what I changed',
]) check(`reset recognized: "${t}"`, isResetToProfile(t) === true);

// Must NOT be confused with the question the grammar answers, or with undo.
for (const t of [
  'what are my settings', "what's set", 'show my settings', 'undo', 'undo that',
  'bigger text', "I'm blind", 'tell me my preferences', 'list my settings',
]) check(`reset NOT triggered: "${t}"`, isResetToProfile(t) === false);

console.log(`\nChat routing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
