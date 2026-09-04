// The additive merge behind chat onboarding, plus the sentences it produces.
//
// Chat onboarding MERGES ("I'm blind", then later "I also have dyslexia" →
// vision + reading), while the onboarding FORM replaces. The merge had no test,
// and it is the piece most able to lose or corrupt a profile quietly: it unions
// areas, appends free text, and recomputes the vision kind from the combined
// text so an unrelated addition can never flip blind to low-vision.
//
//   node onboarding/test/chat-profile.test.mjs

import { mergeOnboarding, onboardingReply, resetReply, resetChanges, NO_PROFILE_TO_RESET, profilePill, appliedSummary } from '../chat-profile.js';
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

// ── a reset has to reach the page, not only the store ────────────────────────
// Re-rendering the profile restores the keys the profile governs and nothing
// else, so a change the profile never mentions (dark mode, turned on by hand)
// survived a reset the reply said had forgotten it (issue #26). resetChanges
// decides which keys to send back to their "not set" value: the ones the server
// forgot, plus the ones the receiver reports as active, minus the ones the
// profile is about to render anyway.
{
  const meta = {
    darkMode:     { type: 'boolean' },
    dyslexiaFont: { type: 'boolean' },
    fontScale:    { type: 'number', range: [50, 200] },
    contrastMode: { type: 'enum', options: ['none', 'light', 'yellow-black'] },
    translateTo:  { type: 'string' },
  };
  const plan = (input) => resetChanges(input, meta);

  const stored = plan({ forgotten: [{ key: 'darkMode' }], active: {}, profile: {} });
  check('a forgotten key the profile never mentions is cleared', stored.clear.darkMode === false);
  check('…but a key that was never showing is not reported as cleared', stored.showing.length === 0);

  const types = plan({ forgotten: [{ key: 'darkMode' }, { key: 'fontScale' }, { key: 'contrastMode' }, { key: 'translateTo' }], active: {}, profile: {} });
  check('a boolean clears to false', types.clear.darkMode === false);
  check('a number clears to null, the receiver’s not-set value', types.clear.fontScale === null);
  check('an enum clears to its first option', types.clear.contrastMode === 'none');
  check('a string clears to null', types.clear.translateTo === null);

  const governed = plan({ forgotten: [{ key: 'dyslexiaFont' }], active: { dyslexiaFont: false }, profile: { dyslexiaFont: true } });
  check('a key the profile governs is left to the profile', !('dyslexiaFont' in governed.clear));
  check('…and is not reported as cleared either', governed.showing.length === 0);

  // The chat surface stores nothing, so in a chat-only session the server
  // forgets nothing and the receiver is the only record of a manual change.
  const session = plan({ forgotten: [], active: { darkMode: true, fontScale: 120, dyslexiaFont: true }, profile: { dyslexiaFont: true } });
  check('a key active on the page is cleared even when nothing was stored', session.clear.darkMode === false && session.clear.fontScale === null);
  check('…and reported as showing', session.showing.join() === 'darkMode,fontScale');
  check('…while the profile’s own key is left alone', !('dyslexiaFont' in session.clear));

  const quiet = plan({ forgotten: [], active: { darkMode: false, fontScale: null, contrastMode: 'none' }, profile: {} });
  check('a key already at its not-set value is not showing', quiet.showing.length === 0);
  check('…and nothing is sent for it', Object.keys(quiet.clear).length === 0);

  const unknown = plan({ forgotten: [], active: { mystery: true }, profile: {} });
  check('a showing key the registry does not know cannot be cleared', unknown.unclearable.join() === 'mystery');
  check('…is still reported as showing', unknown.showing.join() === 'mystery');
  check('…and nothing is sent for it', !('mystery' in unknown.clear));

  // A receiver is free to report any key at all, and the registry is a plain
  // object, so a key that names one of Object.prototype's members must not read
  // as a registry entry with a not-set value of its own.
  const inherited = plan({ forgotten: [], active: { toString: 'x', constructor: true }, profile: {} });
  check('a key inherited from Object.prototype is not treated as a registry entry',
    Object.keys(inherited.clear).length === 0 && inherited.unclearable.join() === 'toString,constructor');

  const unknownStored = plan({ forgotten: [{ key: 'textSize' }], active: {}, profile: {} });
  check('a forgotten key the registry does not know, and the page does not show, is ignored',
    Object.keys(unknownStored.clear).length === 0 && unknownStored.unclearable.length === 0);

  const empty = resetChanges({}, meta);
  check('missing inputs are treated as empty', Object.keys(empty.clear).length === 0 && empty.showing.length === 0 && empty.unclearable.length === 0);
}

// ── and the reply says only what happened ────────────────────────────────────
{
  const both = resetReply({ forgotten: [{ key: 'textSize' }] }, { cleared: ['darkMode'], kept: [] });
  check('a stored change and a page change are both reported', /forgot 1 change/.test(both) && /cleared darkMode on this page/.test(both));
  check('…in one sentence', /\(textSize\) and cleared darkMode on this page\./.test(both));

  const pageOnly = resetReply({ forgotten: [] }, { cleared: ['fontScale', 'darkMode'], kept: [] });
  check('with nothing stored, a page change alone still goes back to the profile', /^Back to your profile/.test(pageOnly));
  check('…names what was cleared', /cleared fontScale, darkMode on this page/.test(pageOnly));
  check('…and does not claim a stored change', !/forgot/.test(pageOnly) && !/already on your profile/.test(pageOnly));

  // The usual case: the key the store forgot is the key the page was showing.
  const same = resetReply({ forgotten: [{ key: 'fontScale' }, { key: 'darkMode' }] }, { cleared: ['fontScale', 'darkMode'], kept: [] });
  check('a key forgotten and cleared is named once, not once per clause', !/darkMode.*darkMode/.test(same));
  check('…and the page is still said to have been cleared', /\(fontScale, darkMode\) and cleared them on this page\./.test(same));

  const overlap = resetReply({ forgotten: [{ key: 'fontScale' }] }, { cleared: ['fontScale', 'darkMode'], kept: [] });
  check('a partial overlap names only the keys the store clause did not', /and cleared darkMode on this page\./.test(overlap));

  // The store forgot a key the page was never showing, so the page clause
  // cannot stand in for the whole list without claiming a clear that did not
  // happen.
  const fewer = resetReply({ forgotten: [{ key: 'fontScale' }, { key: 'darkMode' }] }, { cleared: ['fontScale'], kept: [] });
  check('the page clause does not stand in for a key the page did not clear',
    /\(fontScale, darkMode\) and cleared fontScale on this page\./.test(fewer));

  const kept = resetReply({ forgotten: [{ key: 'textSize' }] }, { cleared: [], kept: ['textSize'] });
  check('a key the page could not clear is admitted', /couldn’t clear textSize on this page/.test(kept));
  check('…and said to stay as it was', /stays as you left it/.test(kept));

  const keptTwo = resetReply({ forgotten: [] }, { cleared: [], kept: ['textSize', 'darkMode'] });
  check('two kept keys read as plural', /they stay as you left them/.test(keptTwo));
  check('with nothing forgotten and nothing cleared, the reply does not say “back to your profile”', !/Back to your profile/.test(keptTwo));
  check('…but says why', /no stored changes to forget/.test(keptTwo));

  check('the new branches still promise the profile itself is unchanged',
    [both, pageOnly, kept, keptTwo].every((r) => /profile itself is unchanged/.test(r)));
  check('a missing page report keeps the old wording', /forgot 1 change you'd made \(textSize\)\. Your profile/.test(resetReply({ forgotten: [{ key: 'textSize' }] })));
  check('nothing stored and nothing on the page is still “already on your profile”',
    /already on your profile/.test(resetReply({ forgotten: [] }, { cleared: [], kept: [] })));
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
