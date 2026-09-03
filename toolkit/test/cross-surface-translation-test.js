// Cross-surface translation proof — the executable evidence for
// docs/design/cross-surface-analysis.md.
//
// Drives everything through the PUBLIC toolkit API (createToolkit on an
// in-memory kv port — no chrome.*, no LLM) to prove the mission's two claims:
//   WEB   -> XR:     a web-recorded ability change reaches renderXRSettings.
//   XR    -> MOBILE: an XR-recorded ability change reaches renderMobileSettings.
// plus a round-trip guard (web still agrees with itself afterward — one
// understanding, three renderings) and a neutral-model baseline (no phantom
// adaptations on any surface).
//
// Run: node toolkit/test/cross-surface-translation-test.js
import { createToolkit } from '../index.js';
import { renderWebSettings } from '../surfaces/web.js';
import { renderXRSettings } from '../surfaces/xr.js';
import { renderMobileSettings } from '../surfaces/mobile.js';
import { deriveWebSettings, resolveWebPreferences } from '../platforms/chrome/web-surface.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}

// Every key WEB_DERIVATION (platforms/chrome/web-surface.js) can produce, so
// the ability baseline coerces cleanly and nothing in this test is reported
// `unmet` by surprise.
const settingsMeta = {
  fontScale: { type: 'number', range: [50, 200] },
  lineHeight: { type: 'number', range: [1.0, 3.0] },
  letterSpacing: { type: 'number', range: [0, 0.5] },
  darkMode: { type: 'boolean' },
  motionReducer: { type: 'boolean' },
  autoCaptions: { type: 'boolean' },
  autoSimplify: { type: 'boolean' },
  contrastMode: { type: 'string' },
  dyslexiaFont: { type: 'boolean' },
  speechRate: { type: 'number', range: [0.5, 2.0] },
};

const { librarian } = createToolkit({ kv: memKV(), toolsRegistry: { settingsMeta } });

(async () => {
  // ============================================================
  // 0. NEUTRAL BASELINE — empty model renders neutral everywhere
  // ============================================================
  const neutral = await librarian.getAbilityModel();
  check('neutral model has no needs', neutral.needs.length === 0);

  const webNeutral = renderWebSettings(neutral);
  check('web neutral: no settings rendered (empty object)', Object.keys(webNeutral).length === 0);

  const xrNeutral = renderXRSettings(neutral);
  check('XR neutral: base angular text, no captions/motion/contrast/dark',
    Math.abs(xrNeutral.text.angularSizeDeg - 0.35) < 1e-9
    && xrNeutral.captions.enabled === false
    && xrNeutral.motion.reduced === false
    && xrNeutral.ui.highContrast === false
    && xrNeutral.ui.darkEnvironmentPreferred === false);

  const mobileNeutral = renderMobileSettings(neutral);
  check('mobile neutral: OS defaults, no phantom adaptations',
    mobileNeutral.text.scalePercent === 100
    && mobileNeutral.text.lineSpacing === 1.0
    && mobileNeutral.text.boldText === false
    && mobileNeutral.display.darkMode === false
    && mobileNeutral.display.highContrast === false
    && mobileNeutral.display.reduceTransparency === false
    && mobileNeutral.motion.reduceMotion === false
    && mobileNeutral.media.captions === false
    && mobileNeutral.speech.rate === 1.0
    && mobileNeutral.simplifyLanguage === false
    && mobileNeutral.touch.largeTargets === false
    && mobileNeutral.touch.minTargetPt === 44);

  // ============================================================
  // 1. WEB -> XR
  // ============================================================
  // The web UI (popup) records two ordinary setting flips the way it always
  // has: recordExplicitSetting, the fast/no-LLM lane every manual toggle
  // uses. This writes the SETTINGS vocabulary (fontScale/darkMode) into a
  // memory shard — it does not touch profile.fields.needs.
  await librarian.recordExplicitSetting('fontScale', 160, 'popup');
  await librarian.recordExplicitSetting('darkMode', true, 'popup');

  // DISCOVERY: recordExplicitSetting/recordScopedSettings alone do NOT reach
  // the AbilityModel. WEB_DERIVATION (platforms/chrome/web-surface.js) only
  // maps needs -> settings; there is no settings -> needs reverse. getAbilityModel()
  // (toolkit/core/ability.js#toAbilityModel) reads ONLY profile.fields.needs,
  // which recordScopedSettings never writes. See docs/design/cross-surface-analysis.md
  // for why this matters.
  const afterExplicitOnly = await librarian.getAbilityModel();
  check('recordExplicitSetting alone does NOT reach the AbilityModel (documented gap)',
    afterExplicitOnly.needs.length === 0);

  // The web host's actual cross-surface-relevant write: the SAME change also
  // recorded as a structured, modality-neutral need — the extract-free fast
  // path every current fields.needs writer uses (onboarding in
  // hosts/xr-demo/demo.js, every toolkit/test/*.js fixture). No LLM
  // involved; this is the one writer path toAbilityModel actually reads.
  await librarian.setProfileField('fields.needs', [
    { dimension: 'textSize', value: 1.6, strength: 'preference', source: 'web-popup' },
    { dimension: 'darkTheme', value: true, strength: 'preference', source: 'web-popup' },
  ]);

  const afterWeb = await librarian.getAbilityModel();
  check('getAbilityModel carries the web-recorded needs',
    afterWeb.needs.some(n => n.dimension === 'textSize' && n.value === 1.6)
    && afterWeb.needs.some(n => n.dimension === 'darkTheme' && n.value === true));

  const xrAfterWeb = renderXRSettings(afterWeb);
  check('XR text is larger after the web change (no XR-specific code path)',
    xrAfterWeb.text.angularSizeDeg > xrNeutral.text.angularSizeDeg);
  check('XR angular size scales exactly with the web-set textSize (0.35deg * 1.6)',
    Math.abs(xrAfterWeb.text.angularSizeDeg - 0.35 * 1.6) < 1e-9);
  check('XR dark environment now preferred after the web change',
    xrAfterWeb.ui.darkEnvironmentPreferred === true && xrNeutral.ui.darkEnvironmentPreferred === false);

  // ============================================================
  // 2. XR -> MOBILE
  // ============================================================
  // Try the mission's other suggested path first, to confirm empirically
  // that it does NOT reach the AbilityModel either — recordScopedSettings is
  // a settings-vocabulary writer regardless of which surface/scope calls it,
  // so an XR-labeled scope doesn't change that.
  await librarian.recordScopedSettings('context:xr', { autoCaptions: true }, { origin: 'xr-host' });
  const afterXRScopedSettings = await librarian.getAbilityModel();
  check('recordScopedSettings from an XR context ALSO does not reach the AbilityModel',
    !afterXRScopedSettings.needs.some(n => n.dimension === 'captions'));

  // The path that DOES work today: the cross-app grant + importInsight
  // consent flow (mirrors toolkit/hosts/xr-demo/demo.js's "INSIGHT FLOWS
  // BACK" step). XR must first be granted read access — a request is not a
  // grant; only the LOCAL user surface accepting it mints one.
  const req = await librarian.requestGrant('xr-host', ['ability.categories', 'settings.text'], {
    appLabel: 'XR Host',
    rationale: 'XR Host wants to read your accessibility needs so it can adapt its headset UI.',
  });
  check('XR grant request drafted', req.ok === true);
  await librarian.respondToProposal(req.proposalId, 'accept');
  const grants = await librarian.listGrants();
  check('XR host granted', grants.some(g => g.appId === 'xr-host'));

  // ...then the XR host contributes its OWN settings update as an insight.
  // `profile-set` REPLACES fields.needs wholesale (setProfileField, not a
  // merge), so the insight must carry the web-set needs forward alongside
  // its own new ones — exactly the pattern hosts/xr-demo/demo.js uses for
  // its FOV insight.
  const insight = await librarian.importInsight('xr-host', {
    kind: 'accessibility.captionsMotion',
    label: 'turning on captions and reduced motion from XR settings',
    change: {
      op: 'profile-set', path: 'fields.needs', value: [
        { dimension: 'textSize', value: 1.6, strength: 'preference', source: 'web-popup' },
        { dimension: 'darkTheme', value: true, strength: 'preference', source: 'web-popup' },
        { dimension: 'captions', value: true, strength: 'preference', source: 'xr-host' },
        { dimension: 'reduceMotion', value: true, strength: 'preference', source: 'xr-host' },
      ],
    },
    rationale: 'You turned on captions and reduced motion in the XR settings panel.',
    confidence: 0.9,
  });
  check('XR insight drafted as a proposal (never silent)', insight.ok === true);

  const beforeAcceptModel = await librarian.getAbilityModel();
  check('NEVER SILENT: AbilityModel unchanged before the person accepts',
    !beforeAcceptModel.needs.some(n => n.dimension === 'captions'));

  const pendingInsights = (await librarian.listProposals('pending')).filter(p => p.change?.op === 'cross-app-insight');
  check('exactly one pending cross-app insight', pendingInsights.length === 1);
  await librarian.respondToProposal(pendingInsights[0].id, 'accept');

  const afterXR = await librarian.getAbilityModel();
  const mobileAfterXR = renderMobileSettings(afterXR);
  const mobileBeforeXR = renderMobileSettings(afterWeb); // web-only state, pre-XR-update

  check('mobile media.captions flips on after the XR update',
    mobileBeforeXR.media.captions === false && mobileAfterXR.media.captions === true);
  check('mobile motion.reduceMotion flips on after the XR update',
    mobileBeforeXR.motion.reduceMotion === false && mobileAfterXR.motion.reduceMotion === true);
  check('mobile text.scalePercent still carries the earlier WEB-set textSize (no data loss)',
    mobileAfterXR.text.scalePercent === 160);
  check('mobile display.darkMode still carries the earlier WEB-set darkTheme',
    mobileAfterXR.display.darkMode === true);

  // ============================================================
  // 3. ROUND-TRIP GUARD — web still agrees with itself
  // ============================================================
  // One understanding, three renderings: the XR-originated needs must also
  // show up on WEB, not just mobile — getAbilityModel is the single source,
  // web.js/xr.js/mobile.js are just three views over it.
  const webAfterXR = renderWebSettings(afterXR);
  check('web still renders the original web-set fontScale/darkMode after the XR update',
    webAfterXR.fontScale === 160 && webAfterXR.darkMode === true);
  check('web NOW ALSO renders the XR-originated captions/motionReducer (one model, three surfaces)',
    webAfterXR.autoCaptions === true && webAfterXR.motionReducer === true);

  // surfaces/web.js is a thin delegate over deriveWebSettings — same object,
  // single source of truth for "what a need renders as on the web".
  check('surfaces/web.js delegates verbatim to platforms/chrome/web-surface.js#deriveWebSettings',
    JSON.stringify(webAfterXR) === JSON.stringify(deriveWebSettings(afterXR).settings));

  // getEffectivePreferences' full composition (explicit records UNDER the
  // ability baseline) agrees too: fontScale/darkMode have explicit records
  // (section 1) so they stay attributed to the user's own choice; autoCaptions
  // /motionReducer have none, so they're filled in and honestly marked derived.
  const resolved = await resolveWebPreferences({ librarian, settingsMeta, url: 'https://example.com' });
  check('resolveWebPreferences composes explicit + ability-derived settings consistently',
    resolved.settings.fontScale === 160 && resolved.settings.darkMode === true
    && resolved.settings.autoCaptions === true && resolved.settings.motionReducer === true);
  check('resolveWebPreferences provenance: explicit user records still win their own keys',
    resolved.provenance.fontScale !== 'derived:ability' && resolved.provenance.darkMode !== 'derived:ability');
  check('resolveWebPreferences provenance: XR-originated keys are honestly marked derived',
    resolved.provenance.autoCaptions === 'derived:ability' && resolved.provenance.motionReducer === 'derived:ability');
  check('web surface reports fully satisfied (every need this model carries has a web rendering)',
    resolved.surface.satisfied === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
