// The additive merge behind chat onboarding, plus the sentences it produces.
//
// Chat onboarding MERGES ("I'm blind", then later "I also have dyslexia" →
// vision + reading), while the onboarding FORM replaces. The merge had no test,
// and it is the piece most able to lose or corrupt a profile quietly: it unions
// areas, appends free text, and recomputes the vision kind from the combined
// text so an unrelated addition can never flip blind to low-vision.
//
//   node onboarding/test/chat-profile.test.mjs

import { mergeOnboarding, onboardingReply, resetReply, NO_PROFILE_TO_RESET, profilePill, appliedSummary } from '../chat-profile.js';
import { visionKindOf } from '../chat-routing.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
const merge = (prev, next) => mergeOnboarding(prev, next, visionKindOf);

// ── support areas union ──────────────────────────────────────────────────────
{
  const r = merge({ supportAreas: ['vision'], freeText: "I'm blind" }, { supportAreas: ['reading'], freeText: 'I have dyslexia' });
  check('a new area is added to the old one', r.supportAreas.join() === 'vision,reading');

  const dup = merge({ supportAreas: ['vision'], freeText: "I'm blind" }, { supportAreas: ['vision'], freeText: 'I cannot see' });
  check('repeating an area does not duplicate it', dup.supportAreas.join() === 'vision');

  const first = merge({}, { supportAreas: ['motor'], freeText: 'I use a switch' });
  check('an empty prior profile just takes the new areas', first.supportAreas.join() === 'motor');
  check('an absent prior profile does not throw', merge(undefined, { supportAreas: [], freeText: '' }).supportAreas.length === 0);
}

// ── free text keeps its history ──────────────────────────────────────────────
{
  const r = merge({ supportAreas: ['vision'], freeText: "I'm blind." }, { supportAreas: ['reading'], freeText: 'I have dyslexia' });
  check('the new sentence is appended', r.freeText === "I'm blind. I have dyslexia");
  check('…and the old wording survives', r.freeText.includes("I'm blind"));

  const same = merge({ supportAreas: ['vision'], freeText: "I'm blind" }, { supportAreas: ['vision'], freeText: "I'm blind" });
  check('repeating yourself does not grow the text', same.freeText === "I'm blind");

  const contained = merge({ supportAreas: ['vision'], freeText: "I'm blind and use a screen reader" }, { supportAreas: ['vision'], freeText: "I'm BLIND" });
  check('a contained restatement is ignored, case-insensitively', contained.freeText === "I'm blind and use a screen reader");

  const trailing = merge({ supportAreas: [], freeText: 'I have ADHD...  ' }, { supportAreas: [], freeText: 'and dyslexia' });
  check('trailing dots and spaces are tidied before appending', trailing.freeText === 'I have ADHD. and dyslexia');

  const fresh = merge({ supportAreas: [], freeText: '' }, { supportAreas: ['hearing'], freeText: 'I am deaf' });
  check('an empty prior text is simply replaced', fresh.freeText === 'I am deaf');
}

// ── the vision kind is recomputed from the COMBINED text ─────────────────────
// This is the guard that matters: adding an unrelated need must never silently
// downgrade a blind profile to low-vision.
{
  const r = merge({ supportAreas: ['vision'], freeText: "I'm blind" }, { supportAreas: ['attention'], freeText: 'I have ADHD' });
  check('adding an unrelated need keeps the blind kind', r.visionKind === 'blind');

  const low = merge({ supportAreas: ['vision'], freeText: 'I have low vision' }, { supportAreas: ['reading'], freeText: 'I have dyslexia' });
  check('a low-vision profile stays low vision', low.visionKind === 'lowVision');

  const none = merge({ supportAreas: ['reading'], freeText: 'I have dyslexia' }, { supportAreas: ['attention'], freeText: 'I have ADHD' });
  check('with no vision area, no vision kind is sent', none.visionKind === undefined);

  const added = merge({ supportAreas: ['reading'], freeText: 'I have dyslexia' }, { supportAreas: ['vision'], freeText: "I'm blind" });
  check('adding vision later computes the kind', added.visionKind === 'blind');
}

// ── the sentences ────────────────────────────────────────────────────────────
{
  const blind = onboardingReply({ supportAreas: ['vision'], visionKind: 'blind' });
  check('the reply lists the support areas', /vision/.test(blind));
  check('a blind profile is described without magnification', /screen-reader \/ no magnification/.test(blind));

  const low = onboardingReply({ supportAreas: ['vision'], visionKind: 'lowVision' });
  check('a low-vision profile is described as low vision', /low vision/.test(low));

  const plain = onboardingReply({ supportAreas: ['reading'] });
  check('with no vision kind, no parenthetical is added', !/\(/.test(plain));

  const empty = onboardingReply({ supportAreas: [] });
  check('an empty profile says “none” rather than trailing off', /Support areas: none/.test(empty));
}

// ── the page changed, so the answer has to say so ────────────────────────────
// Onboarding applies settings immediately. A page that rearranges itself with
// no explanation is worse than one that does nothing, so the reply names what
// it did, using the registry's own words rather than a second set of labels.
{
  check('nothing applied means nothing claimed', appliedSummary({}) === '');
  check('null is not a claim either', appliedSummary(null) === '');

  check('one change is named', appliedSummary({ fontScale: 150 }) === 'larger text');
  check('two changes read as a pair',
    appliedSummary({ fontScale: 150, contrastMode: 'yellow-black' }) === 'larger text and higher contrast');
  check('three changes read as a list',
    appliedSummary({ lineHeight: 1.8, dyslexiaFont: true, autoSimplify: true })
      === 'more line spacing, a dyslexia-friendly font and simpler wording');

  // A blind profile applies six at once; a wall of them is not an answer.
  const many = appliedSummary({ autoDescribe: true, autoFixLabels: true, fixLandmarks: true, skipLinks: true, announceUpdates: true });
  check('beyond three, the rest are counted', /, and 2 more$/.test(many));
  check('…and the first three are still named', many.startsWith('image descriptions, form and button labels, page landmarks'));

  // The three caption mechanisms are ONE thing to the person they were applied
  // for. Listing them separately describes our plumbing, not their page.
  check('the caption settings collapse to one word',
    appliedSummary({ showCaptions: true, liveCaptions: true, autoCaptions: true }) === 'captions');
  check('…and so do the two announcement settings',
    appliedSummary({ announceUpdates: true, spaFocus: true }) === 'screen-reader announcements');

  // The registry is the fallback for anything without a person-facing label,
  // lowercased to sit mid-sentence but never mangling its own capitals.
  const meta = { bigTargets: { description: 'Enlarge small controls' }, autoDescribe: { description: 'AI image descriptions' } };
  check('an unlabelled key falls back to the registry', appliedSummary({ bigTargets: true }, meta) === 'enlarge small controls');
  check('a labelled key ignores the registry wording', appliedSummary({ autoDescribe: true }, meta) === 'image descriptions');
  check('with no label and no registry, the key itself is used', appliedSummary({ mysterySetting: true }) === 'mysterySetting');

  const reply = onboardingReply({ supportAreas: ['reading'] }, 'a dyslexia-friendly font');
  check('the reply says the page changed', /changed this page to match/.test(reply));
  check('…and names the change', /a dyslexia-friendly font/.test(reply));
  check('…and still reports the profile', /Support areas: reading/.test(reply));

  // A motor-only profile derives nothing today, so it must not claim otherwise.
  const quiet = onboardingReply({ supportAreas: ['motor'] }, '');
  check('with nothing applied, no page change is claimed', !/changed this page/.test(quiet));
  check('…but the profile update is still reported', /Support areas: motor/.test(quiet));
}

{
  check('a reset with nothing to forget says so', /already on your profile/.test(resetReply({ forgotten: [] })));
  check('a missing forgotten list is treated as empty', /already on your profile/.test(resetReply({})));

  const one = resetReply({ forgotten: [{ key: 'textSize' }] });
  check('one forgotten change is singular', /forgot 1 change /.test(one));
  check('…and names the key', /textSize/.test(one));

  const many = resetReply({ forgotten: [{ key: 'textSize' }, { key: 'contrast' }] });
  check('two forgotten changes are plural', /forgot 2 changes/.test(many));

  const dupes = resetReply({ forgotten: [{ key: 'textSize' }, { key: 'textSize' }] });
  check('a repeated key is listed once', (dupes.match(/textSize/g) || []).length === 1);
  check('…but the COUNT still reflects both changes', /forgot 2 changes/.test(dupes));

  check('the reset reply promises the profile itself is unchanged', /profile itself is unchanged/.test(one));
  check('with no profile at all, it explains rather than erroring', /nothing to go back to/.test(NO_PROFILE_TO_RESET));
}

// ── the pill ─────────────────────────────────────────────────────────────────
{
  check('no uid means an empty pill', profilePill('', { supportAreas: ['vision'] }).empty === true);
  check('no model means an empty pill', profilePill('u-abc', null).empty === true);

  const p = profilePill('u-abc', { supportAreas: ['vision', 'reading'], freeText: "I'm blind" });
  check('the pill carries the uid', p.uid === 'u-abc');
  check('the pill lists the areas', p.detail.includes('vision, reading'));
  check('the pill quotes the free text', p.detail.includes('“I’m blind”') || p.detail.includes("“I'm blind”"));

  const bare = profilePill('u-abc', { supportAreas: [] });
  check('a profile with nothing recorded has no detail', bare.detail === '');
  check('…and is still not empty, because the person exists', bare.empty === false);
}

console.log(`\nChat profile merge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
