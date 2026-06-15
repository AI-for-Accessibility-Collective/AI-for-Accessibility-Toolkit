/* Agentic A11y — Skill Builder
 *
 * Single-page state machine that takes a user (or a queue from onboarding)
 * through: intent → target → generate → try/iterate → save → confirm.
 *
 * Skill execution always goes through the background service worker's
 * executeCustomSkill / saveCustomSkill / getActiveSkills messages. The few
 * chrome.* APIs used directly here are tab/window plumbing for the test
 * preview (chrome.windows.create, chrome.tabs.reload/get, chrome.tabs.onUpdated)
 * — none of these require a permission beyond what the manifest already grants.
 */

const SUPPORT_AREAS = [
  { id: 'vision',    label: 'Vision' },
  { id: 'cognitive', label: 'Cognitive' },
  { id: 'hearing',   label: 'Hearing' },
  { id: 'motor',     label: 'Motor' },
  { id: 'sensory',   label: 'Sensory' },
  { id: 'reading',   label: 'Reading' },
];

const EXAMPLE_CHIPS = [
  'Make the body text on news articles bigger and easier to read.',
  'Hide the comment section and ads on long articles.',
  'Summarize long articles into a few bullet points at the top.',
  'On YouTube, always show the captions panel under videos.',
  'Highlight the current step in recipe instructions.',
  'On shopping sites, dim everything except the product photo and price.',
];

const MAX_ITERATIONS = 8;

const PHASES = [
  'overview', 'intent', 'target', 'ai-choice', 'generate',
  'try', 'save', 'confirm', 'error',
];

// ============================================================
// State
// ============================================================
const state = {
  mode: 'single',            // 'single' or 'batch'
  queue: [],                 // remaining PendingSkill items in batch mode
  builtCount: 0,             // skills saved in this session
  current: null,             // working PendingSkill — { name, description, supportAreas }
  generatedCode: '',
  generatedExplanation: '',
  iterationCount: 0,
  targetTabId: null,
  targetUrl: '',
  scope: 'general',          // site scope for built skills (from a scoped request)
  useAI: false,              // whether the generated skill may call Gemini at runtime
  aiAssessment: null,        // last assessment payload from assessAINeed()
  prompts: { creator: '', refine: '' },
  previousPhase: null,
  currentPhase: null,
};

// ============================================================
// Boot
// ============================================================
async function init() {
  setupHeader();
  setupOverviewHandlers();
  setupIntentHandlers();
  setupTargetHandlers();
  setupAIChoiceHandlers();
  setupTryHandlers();
  setupSaveHandlers();
  setupConfirmHandlers();
  setupErrorHandlers();
  setupDevModeBanner();
  renderSaveAreas();

  // Fire-and-forget: warn the user if user-scripts isn't available so saved
  // skills will fail silently. Doesn't block the rest of init.
  checkUserScriptsStatus();

  await loadPrompts();
  parseEntryAndRoute();
}

function setupDevModeBanner() {
  document.getElementById('devModeBannerClose')?.addEventListener('click', () => {
    document.getElementById('devModeBanner').hidden = true;
  });
  document.getElementById('devModeRecheckBtn')?.addEventListener('click', () => {
    checkUserScriptsStatus({ announce: true });
  });
  // Re-check whenever the user comes back to this tab — typically after they
  // toggle "Allow user scripts" at chrome://extensions and switch back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkUserScriptsStatus();
  });
}

async function checkUserScriptsStatus(opts = {}) {
  const banner = document.getElementById('devModeBanner');
  const note = document.getElementById('devModeBannerNote');
  if (!banner) return;

  if (opts.announce && note) {
    note.textContent = 'Checking…';
  }

  let resp;
  try {
    resp = await sendMessage({ type: 'getUserScriptsStatus' });
  } catch {
    return; // service worker not ready yet — silent
  }

  console.log('[Skill Builder] getUserScriptsStatus ←', resp);

  if (resp?.available === true) {
    banner.hidden = true;
    if (note) note.textContent = '';
    return;
  }

  if (resp?.available === false) {
    if (note) {
      const lines = [];
      if (resp.message) lines.push(`Chrome reports: ${resp.message}`);
      if (resp.diag) {
        lines.push(`Diagnostic: chromeVersion=${resp.diag.chromeVersion}, ` +
                   `userScriptsType=${resp.diag.userScriptsType}, ` +
                   `hasGetScripts=${resp.diag.hasGetScripts}, ` +
                   `hasExecute=${resp.diag.hasExecute}, ` +
                   `hasRegister=${resp.diag.hasRegister}`);
      }
      note.textContent = lines.join(' · ');
    }
    banner.hidden = false;
    return;
  }

  // No reply (resp is undefined) or shape we don't recognise: keep the banner
  // hidden. The banner is preventive UX — if the user-scripts API is genuinely
  // unavailable, the user will hit a real error when they save or preview a
  // skill. Showing a blank-note banner here would just be noise.
  console.warn('[Skill Builder] no usable reply from getUserScriptsStatus; keeping banner hidden.', resp);
  banner.hidden = true;
  if (note) note.textContent = '';
}

document.addEventListener('DOMContentLoaded', init);

async function loadPrompts() {
  try {
    const [creator, refine] = await Promise.all([
      fetch('prompts/creator.txt').then(r => r.text()),
      fetch('prompts/refine.txt').then(r => r.text()),
    ]);
    state.prompts.creator = creator;
    state.prompts.refine = refine;
  } catch (e) {
    showError(
      'We couldn\'t load the AI prompt templates. Try reloading this page. If the problem continues, the extension may need to be reinstalled.',
      false
    );
    throw e;
  }
}

function parseEntryAndRoute() {
  const params = new URLSearchParams(location.search);
  let pending = [];
  try {
    pending = JSON.parse(decodeURIComponent(params.get('pending') || '[]'));
  } catch { pending = []; }

  // Scope from a scoped popup request ("...on news sites"): applied to every
  // skill built in this session so the saved skill is gated to those sites.
  const scope = params.get('scope') || 'general';
  state.scope = /^(general|category:[a-z-]+|context:[a-z-]+|origin:[a-z0-9.-]+)$/.test(scope) ? scope : 'general';

  if (Array.isArray(pending) && pending.length > 0) {
    state.mode = 'batch';
    state.queue = pending
      .filter(p => p && typeof p.description === 'string')
      .map(p => ({
        name: typeof p.name === 'string' ? p.name : 'Untitled adapter',
        description: p.description,
        supportAreas: Array.isArray(p.supportAreas) ? p.supportAreas : [],
        enabled: true,
      }));
    renderOverview();
    showPhase('overview');
  } else {
    state.mode = 'single';
    showPhase('intent');
  }
}

// ============================================================
// Header (text-size toggle)
// ============================================================
function setupHeader() {
  const btn = document.getElementById('textSizeBtn');
  btn.addEventListener('click', () => {
    const on = !document.body.classList.contains('font-large');
    document.body.classList.toggle('font-large', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Use normal text size' : 'Use larger text');
  });
}

// ============================================================
// Phase routing
// ============================================================
function showPhase(name) {
  if (!PHASES.includes(name)) return;
  state.previousPhase = state.currentPhase;
  state.currentPhase = name;

  for (const p of PHASES) {
    document.getElementById('phase-' + p).hidden = (p !== name);
  }
  updateProgressStrip();

  const heading = document.querySelector('#phase-' + name + ' h2');
  if (heading) {
    requestAnimationFrame(() => heading.focus());
  }

  // Stop any read-aloud playback when leaving the try phase.
  if (name !== 'try' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

function updateProgressStrip() {
  const strip = document.getElementById('progressStrip');
  if (state.mode !== 'batch' || state.queue.length + state.builtCount === 0) {
    strip.hidden = true;
    return;
  }
  const enabled = state.queue.filter(s => s.enabled).length;
  const total = state.builtCount + enabled + (state.current ? 1 : 0);
  if (total <= 1) { strip.hidden = true; return; }
  strip.hidden = false;
  document.getElementById('progressLabel').textContent =
    `Adapter ${state.builtCount + 1} of ${total}`;
}

// ============================================================
// Overview phase (batch only)
// ============================================================
function setupOverviewHandlers() {
  document.getElementById('overviewSkipAll').addEventListener('click', () => {
    state.queue = [];
    finishAll();
  });
  document.getElementById('overviewStartBtn').addEventListener('click', () => {
    advanceToNextPending();
  });
}

function renderOverview() {
  const list = document.getElementById('pendingList');
  list.innerHTML = '';
  state.queue.forEach((skill, idx) => {
    const card = document.createElement('div');
    card.className = 'pending-card';
    card.setAttribute('role', 'listitem');

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'pending-card-name';
    name.textContent = skill.name;
    const desc = document.createElement('div');
    desc.className = 'pending-card-desc';
    desc.textContent = skill.description;
    left.appendChild(name);
    left.appendChild(desc);
    if (skill.supportAreas.length > 0) {
      const areas = document.createElement('div');
      areas.className = 'pending-card-areas';
      areas.textContent = skill.supportAreas.join(' · ');
      left.appendChild(areas);
    }

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = skill.enabled;
    checkbox.setAttribute('aria-label', `Build ${skill.name}`);
    const track = document.createElement('span');
    track.className = 'toggle-track';
    toggle.appendChild(checkbox);
    toggle.appendChild(track);

    checkbox.addEventListener('change', () => {
      skill.enabled = checkbox.checked;
      card.classList.toggle('skipped', !checkbox.checked);
    });

    card.appendChild(left);
    card.appendChild(toggle);
    list.appendChild(card);
  });
}

function advanceToNextPending() {
  state.queue = state.queue.filter(s => s.enabled);
  if (state.queue.length === 0) { finishAll(); return; }
  const next = state.queue.shift();
  state.current = {
    name: next.name,
    description: next.description,
    supportAreas: next.supportAreas.slice(),
  };
  state.iterationCount = 0;
  state.generatedCode = '';
  state.generatedExplanation = '';
  state.useAI = false;
  state.aiAssessment = null;
  prefillIntent();
  showPhase('intent');
}

// ============================================================
// Intent phase
// ============================================================
function setupIntentHandlers() {
  document.getElementById('intentNextBtn').addEventListener('click', () => {
    const description = document.getElementById('intentDescription').value.trim();
    if (description.length < 8) {
      flashFieldError('intentDescription', 'Describe what the adapter should do — a sentence or two is plenty.');
      return;
    }
    let name = document.getElementById('intentName').value.trim();
    if (!name) {
      name = guessName(description);
      // Reflect the auto-fill in the field so the user can review/edit on Back.
      document.getElementById('intentName').value = name;
    }
    state.current = state.current || { supportAreas: [] };
    state.current.name = name;
    state.current.description = description;
    showPhase('target');
  });

  document.getElementById('intentBackBtn').addEventListener('click', () => {
    if (state.mode === 'batch') showPhase('overview');
  });
}

function prefillIntent() {
  document.getElementById('intentName').value = state.current?.name || '';
  document.getElementById('intentDescription').value = state.current?.description || '';
  document.getElementById('intentBackBtn').hidden = (state.mode !== 'batch');

  // Help text and example chips depend on entry mode.
  const help = document.getElementById('intentHelp');
  if (state.mode === 'batch') {
    help.textContent = 'We pre-filled this from your onboarding answers. Edit anything that doesn\'t match what you wanted.';
    document.getElementById('exampleChips').hidden = true;
  } else {
    help.textContent = 'Describe what you want the adapter to do — in plain language, like you\'d describe it to a person.';
    renderExampleChips();
    document.getElementById('exampleChips').hidden = false;
  }
}

function renderExampleChips() {
  const row = document.getElementById('chipRow');
  row.innerHTML = '';
  EXAMPLE_CHIPS.forEach(text => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = text;
    btn.setAttribute('aria-label', `Use example: ${text}`);
    btn.addEventListener('click', () => {
      document.getElementById('intentDescription').value = text;
      if (!document.getElementById('intentName').value.trim()) {
        document.getElementById('intentName').value = guessName(text);
      }
    });
    row.appendChild(btn);
  });
}

function guessName(desc) {
  // Take the first clause (up to first sentence-ending punctuation), strip
  // trailing connector words, title-case the first ~5 meaningful words.
  const clause = desc.replace(/[.,;:!?].*$/, '').trim();
  const stop = new Set([
    'a','an','and','but','for','from','in','into','of','on','onto','or','out','so',
    'than','that','the','then','this','to','too','via','with','yet',
  ]);
  const words = clause.split(/\s+/).filter(Boolean);
  const picked = [];
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z0-9'-]/g, '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (picked.length === 0 || !stop.has(lower)) {
      picked.push(clean[0].toUpperCase() + clean.slice(1).toLowerCase());
    } else {
      picked.push(lower);
    }
    if (picked.length >= 5) break;
  }
  return picked.join(' ').slice(0, 50) || 'Untitled adapter';
}

// ============================================================
// Target phase
// ============================================================
function setupTargetHandlers() {
  document.getElementById('targetBackBtn').addEventListener('click', () => {
    showPhase('intent');
  });
  document.getElementById('targetNextBtn').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="targetMode"]:checked')?.value || 'skip';
    if (mode === 'skip') {
      state.targetTabId = null;
      state.targetUrl = '';
      await goToAIChoice();
      return;
    }
    if (mode === 'url') {
      const url = document.getElementById('targetUrl').value.trim();
      if (!isLikelyUrl(url)) {
        flashFieldError('targetUrl', 'Please enter a full website URL, like https://example.com.');
        return;
      }
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        const tabId = tab?.id ?? null;
        if (tabId == null) throw new Error('Could not open a tab for the test page.');
        state.targetTabId = tabId;
        state.targetUrl = url;
      } catch (e) {
        showError(
          'We couldn\'t open that page. Check the URL and try again, or pick "Skip preview".',
          true
        );
        return;
      }
      await goToAIChoice();
    }
  });
}

function isLikelyUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// ============================================================
// AI-choice phase — decide whether the skill uses runtime AI
// ============================================================
function setupAIChoiceHandlers() {
  document.getElementById('chooseWithAI').addEventListener('click', () => {
    state.useAI = true;
    runGenerate();
  });
  document.getElementById('chooseWithoutAI').addEventListener('click', () => {
    state.useAI = false;
    runGenerate();
  });
  document.getElementById('aiChoiceBackBtn').addEventListener('click', () => {
    showPhase('target');
  });
}

async function goToAIChoice() {
  showPhase('ai-choice');
  const loadingEl = document.getElementById('aiChoiceLoading');
  loadingEl.hidden = false;
  document.getElementById('aiChoiceCards').hidden = true;

  let assessment;
  try {
    assessment = await assessAINeed();
  } catch (e) {
    // Assessment failed — fall through to a static skill rather than blocking
    // the user. They can always rebuild later if AI would have helped.
    console.warn('AI assessment failed:', e);
    loadingEl.hidden = true;
    state.useAI = false;
    state.aiAssessment = null;
    await runGenerate();
    return;
  }

  loadingEl.hidden = true;
  state.aiAssessment = assessment;

  if (!assessment.couldUseAI) {
    // AI clearly wouldn't help — proceed without it, no extra screen.
    state.useAI = false;
    await runGenerate();
    return;
  }

  renderAIChoiceCards(assessment);
  document.getElementById('aiChoiceCards').hidden = false;
  // Re-focus the heading so the user lands on the new state.
  const heading = document.getElementById('ai-choice-heading');
  if (heading) heading.focus();
}

async function assessAINeed() {
  const prompt =
`You are deciding whether a planned accessibility browser skill could meaningfully benefit from making runtime AI calls (i.e. once per page, calling Gemini for natural-language judgement).

Skills that DO benefit from runtime AI:
- Summarizing articles
- Simplifying complex sentences
- Generating image descriptions / alt text
- Translating page text
- Classifying or extracting key info from page content
- Answering questions about what's on the page

Skills that do NOT benefit from runtime AI (pure DOM/CSS is enough):
- Changing font size, line height, contrast, dark mode
- Hiding ads, comments, sidebars
- Adding keyboard shortcuts or skip links
- Fixed text replacements
- Stopping animations, autoplay

Skill description:
"""
${state.current.description}
"""

Return ONLY valid JSON, no Markdown fences. Schema:
{
  "couldUseAI": true | false,
  "recommendation": "with-ai" | "without-ai",
  "withAI": {
    "summary": "One short sentence describing what the AI version would do, in plain English.",
    "benefits": ["short benefit", "short benefit"],
    "tradeoffs": ["short tradeoff", "short tradeoff"]
  },
  "withoutAI": {
    "summary": "One short sentence describing what the static version would do.",
    "benefits": ["short benefit", "short benefit"],
    "tradeoffs": ["short tradeoff", "short tradeoff"]
  }
}

Rules:
- couldUseAI is true ONLY when AI would meaningfully change what the skill can do — not just for novelty.
- Each benefits/tradeoffs array should have 2–3 items, max ~80 chars each, no jargon.
- Mention concrete things: speed, API key usage, offline support, content adaptiveness.
- "recommendation" should be the option that would serve a typical user better for this specific skill.`;

  const raw = await callGemini(prompt);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Assessment response was not JSON.');
  const parsed = JSON.parse(m[0]);
  if (typeof parsed.couldUseAI !== 'boolean') throw new Error('Bad assessment shape.');
  if (!parsed.withAI || !parsed.withoutAI) throw new Error('Bad assessment shape.');
  // Defaults so render is safe.
  parsed.recommendation = parsed.recommendation === 'without-ai' ? 'without-ai' : 'with-ai';
  for (const k of ['withAI', 'withoutAI']) {
    parsed[k].summary = String(parsed[k].summary || '');
    parsed[k].benefits = Array.isArray(parsed[k].benefits) ? parsed[k].benefits.slice(0, 4) : [];
    parsed[k].tradeoffs = Array.isArray(parsed[k].tradeoffs) ? parsed[k].tradeoffs.slice(0, 4) : [];
  }
  return parsed;
}

function renderAIChoiceCards(assessment) {
  const recIsWith = assessment.recommendation === 'with-ai';

  document.getElementById('summaryWith').textContent =
    assessment.withAI.summary || 'It uses Gemini to read each page and adapt what it does.';
  fillBulletList('prosWith', assessment.withAI.benefits);
  fillBulletList('consWith', assessment.withAI.tradeoffs);
  document.getElementById('badgeWith').hidden = !recIsWith;
  document.getElementById('aiCardWith').classList.toggle('recommended', recIsWith);

  document.getElementById('summaryWithout').textContent =
    assessment.withoutAI.summary || 'It uses fixed rules — no AI calls, runs instantly.';
  fillBulletList('prosWithout', assessment.withoutAI.benefits);
  fillBulletList('consWithout', assessment.withoutAI.tradeoffs);
  document.getElementById('badgeWithout').hidden = recIsWith;
  document.getElementById('aiCardWithout').classList.toggle('recommended', !recIsWith);

  // Make the recommended card's button the visually-primary one.
  document.getElementById('chooseWithAI').className =
    recIsWith ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('chooseWithoutAI').className =
    recIsWith ? 'btn btn-secondary' : 'btn btn-primary';
}

function fillBulletList(elementId, items) {
  const ul = document.getElementById(elementId);
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = String(item);
    li.appendChild(span);
    ul.appendChild(li);
  }
}

function aiModeDirective(useAI) {
  if (useAI) {
    return `AI_MODE: with-ai
This skill MAY (and for natural-language tasks SHOULD) call \`chrome.runtime.sendMessage({ type: 'gemini', prompt }, callback)\` at runtime. The callback receives \`{ result: string }\` on success or \`{ error: string }\` on failure. Use it only where natural-language judgement is genuinely required (summarize, simplify, describe, translate, classify). Render a clear placeholder while the call is in flight, and a fallback if it errors.`;
  }
  return `AI_MODE: without-ai
This skill MUST be entirely static. Do NOT call \`chrome.runtime.sendMessage\`, \`fetch\`, \`XMLHttpRequest\`, or any other network/AI API. Use only DOM, CSS, selectors, and \`MutationObserver\`. The skill must run instantly with no network dependency, even with no API key configured.`;
}

// ============================================================
// Generate phase — staged progress
// ============================================================
const STEP_IDS = ['ai-generate', 'lint', 'load', 'run', 'explain'];

function resetSteps() {
  for (const id of STEP_IDS) setStep(id, 'pending');
  setText('generateStatus', 'Getting started…');
}
function setStep(id, state) {
  const li = document.querySelector(`#generateSteps [data-step="${id}"]`);
  if (li) li.dataset.state = state;
}
function setStatusLine(text) {
  setText('generateStatus', text);
}

async function runGenerate() {
  showPhase('generate');
  resetSteps();

  // ---- Step 1: AI generation ----
  setStep('ai-generate', 'active');
  setStatusLine('Asking Gemini to write the code from your description… This usually takes 30–60 seconds.');

  let prompt = state.prompts.creator
    .replace('{{DESCRIPTION}}', state.current.description)
    .replace('{{NAME}}', state.current.name)
    .replace('{{TARGET_INFO}}', state.targetUrl
      ? `EXAMPLE_PAGE: ${state.targetUrl}\n(This is one page the user happened to test on. Treat it as a sample, not a constraint. Do NOT add a hostname/path check that limits the skill to this URL unless the USER_DESCRIPTION explicitly asks to scope to a particular site.)`
      : 'EXAMPLE_PAGE: (not provided)')
    .replace('{{AI_MODE}}', aiModeDirective(state.useAI));

  // The diagram's Engineer builds "from specs + user profile + task":
  // condition generation on the Librarian's ability profile so e.g. a
  // screen-reader user gets ARIA-careful DOM changes and a plain-language
  // user gets simpler in-page text. Best-effort — generation proceeds
  // without it if the Librarian isn't available.
  try {
    const resp = await sendMessage({ type: 'librarianGetProfile' });
    const p = resp?.profile;
    if (p && (p.supportAreas?.length || p.freeText)) {
      prompt += `\n\nUSER_ACCESSIBILITY_PROFILE: support areas: ${p.supportAreas.join(', ') || 'unspecified'}.`
        + (p.freeText ? ` In their words: "${p.freeText}".` : '')
        + ' Tailor the skill to these needs (e.g. preserve ARIA/semantics for screen-reader users, prefer simple wording for plain-language users), but do not narrow the skill beyond the USER_DESCRIPTION.';
    }
  } catch (_) {}

  let raw;
  const t0 = performance.now();
  try {
    raw = await callGemini(prompt);
  } catch (e) {
    setStep('ai-generate', 'failed');
    showApiError(e);
    return;
  }
  setStep('ai-generate', 'done');
  setStatusLine(`Got the code from Gemini in ${Math.round((performance.now() - t0) / 100) / 10}s. Checking it now…`);
  try { chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'skill', region: 'skillbuilder', label: 'Engineer built skill' }); } catch (_) {}

  // ---- Step 2: Lint ----
  setStep('lint', 'active');
  await sleep(120); // let the user see this step engage
  const code = normalizeCode(raw);
  const issues = lintGenerated(code, state.useAI);
  if (issues.length > 0) {
    setStep('lint', 'failed');
    showError(
      'The AI returned code that didn\'t look safe to run: ' + issues.join('; ') +
      '. Tap "Try again" to ask Gemini for another version.',
      true
    );
    return;
  }
  setStep('lint', 'done');

  state.generatedCode = code;
  state.iterationCount = 0;
  document.getElementById('codeView').textContent = code;

  // ---- Steps 3 & 4: Load + run on target ----
  if (state.targetTabId == null) {
    setStep('load', 'skipped');
    setStep('run', 'skipped');
    setStatusLine('No test page selected — moving on to save.');
  } else {
    await runOnTargetWithProgress(false);
  }

  // ---- Step 5: Plain-English explanation ----
  setStep('explain', 'active');
  setStatusLine('Asking Gemini to describe what this adapter does, in plain language…');
  try {
    await refreshExplanation();
    setStep('explain', 'done');
  } catch {
    setStep('explain', 'failed');
  }

  setStatusLine('Done.');
  await sleep(200);
  showPhase('try');
}

async function runOnTargetWithProgress(reload) {
  // ---- Step 3: Wait for target ready ----
  setStep('load', 'active');
  if (reload) {
    setStatusLine('Reloading the test page so the revision applies cleanly…');
    try {
      await chrome.tabs.reload(state.targetTabId);
    } catch {
      setStep('load', 'failed');
      setStep('run', 'skipped');
      const status = document.getElementById('tryStatus');
      setStatus(status, 'error',
        'The test window was closed. Pick "Different idea" or save without preview.');
      return;
    }
  } else {
    setStatusLine('Waiting for the test page to finish loading…');
  }

  try {
    await waitForTabComplete(state.targetTabId);
  } catch {
    setStep('load', 'failed');
    setStep('run', 'skipped');
    const status = document.getElementById('tryStatus');
    setStatus(status, 'error',
      'The test window was closed. Pick "Different idea" or save without preview.');
    return;
  }
  setStep('load', 'done');

  // ---- Step 4: Inject skill ----
  setStep('run', 'active');
  setStatusLine('Injecting the adapter into the test page…');
  const status = document.getElementById('tryStatus');

  try {
    const resp = await sendMessage({
      type: 'executeCustomSkill',
      tabId: state.targetTabId,
      code: wrapForPreview(state.generatedCode, state.current.name),
    });
    if (resp?.success) {
      setStep('run', 'done');
      setStatus(status, 'success',
        'Done. Check the side window — a banner will tell you whether the adapter actually changed the page.');
    } else {
      setStep('run', 'failed');
      setStatus(status, 'error', `That didn't run: ${resp?.error || 'unknown error'}.`);
    }
  } catch (e) {
    setStep('run', 'failed');
    setStatus(status, 'error', `That didn't run: ${e.message}`);
  }
}

/**
 * Wrap the generated skill code so that:
 *   1. A top-level `return` inside the skill's try-block doesn't exit the
 *      `new Function` body (which would skip our indicator).
 *   2. After the skill runs, we inject a visible banner on the test page that
 *      reports whether the skill actually applied any of the markers our
 *      generation prompt asks for (sentinel data attribute, `agentic-a11y-style-*`
 *      style tag, or `aa-skill-*` class). This is the only feedback the user
 *      gets that the code did something — without it, a skill that fails to
 *      match its selectors looks identical to a skill that worked.
 */
function wrapForPreview(code, skillName) {
  const safeName = JSON.stringify(skillName || 'this adapter');
  return `
;(function __aaSkillSnapshot() {
  try {
    window.__aaSkillBefore = {
      elemCount: document.getElementsByTagName('*').length,
      sheetCount: document.styleSheets.length,
      bodyHTMLLen: (document.body && document.body.innerHTML.length) || 0
    };
  } catch (e) { window.__aaSkillBefore = null; }
})();

(function __aaSkillRun() {
${code}
})();

;(function __aaSkillBanner() {
  // Wait briefly so MutationObservers, microtasks, and any first-tick async
  // work (e.g. a runtime Gemini call placeholder) get a chance to mutate the
  // page before we measure.
  setTimeout(function () {
    try {
      var docEl = document.documentElement;

      // Convention-based markers from the skill prompt.
      // We accept both the current sentinel form (data-aa-skill-* attribute on
      // the root) and the legacy dataset.agenticA11ySkill_* form for skills
      // that were generated before the prompt change.
      var sentinelHit = false;
      var attrs = docEl.attributes;
      for (var i = 0; i < attrs.length; i++) {
        var n = attrs[i].name;
        if (n.indexOf('data-aa-skill-') === 0) { sentinelHit = true; break; }
      }
      if (!sentinelHit) {
        var ds = docEl.dataset || {};
        for (var k in ds) {
          if (k.indexOf('agenticA11ySkill') === 0 || k.indexOf('aaSkill') === 0) {
            sentinelHit = true; break;
          }
        }
      }
      var hasStyle = !!document.querySelector('style[id^="agentic-a11y-style-"]');
      var hasClass = !!document.querySelector('[class*="aa-skill-"]');

      // Fallback: raw DOM diff in case the skill mutated the page without
      // following the naming convention.
      var before = window.__aaSkillBefore || {};
      delete window.__aaSkillBefore;
      var domDiff = (
        before.elemCount !== document.getElementsByTagName('*').length
        || before.sheetCount !== document.styleSheets.length
        || Math.abs((before.bodyHTMLLen || 0) - ((document.body && document.body.innerHTML.length) || 0)) > 8
      );

      var applied = sentinelHit || hasStyle || hasClass || domDiff;

      var name = ${safeName};
      var prev = document.getElementById('__aa-skill-banner');
      if (prev) prev.remove();

      var banner = document.createElement('div');
      banner.id = '__aa-skill-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.textContent = applied
        ? '✓ Adapter applied: ' + name + ' — changes are now active on this page.'
        : '⚠ ' + name + ' ran but did not visibly change this page. Selectors may not match here — try refining the description or testing on a different URL.';

      Object.assign(banner.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        maxWidth: '380px',
        background: applied ? '#1a73e8' : '#c45c00',
        color: '#ffffff',
        padding: '14px 18px',
        borderRadius: '10px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '1.4',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        zIndex: '2147483647',
        opacity: '0',
        transition: 'opacity 0.25s ease',
        pointerEvents: 'none'
      });

      (document.body || docEl).appendChild(banner);
      requestAnimationFrame(function () { banner.style.opacity = '1'; });
      setTimeout(function () {
        banner.style.opacity = '0';
        setTimeout(function () { banner.remove(); }, 300);
      }, 6500);
    } catch (e) {
      console.warn('[AgenticA11y] preview banner error:', e);
    }
  }, 1500);
})();
`;
}

function normalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  // Strip Markdown fences if Gemini included them anyway.
  s = s.replace(/^```(?:javascript|js)?\s*/i, '').replace(/```\s*$/, '');
  return s.trim();
}

function lintGenerated(code, useAI) {
  const issues = [];
  if (!code || code.length < 30) issues.push('the code is too short');
  if (code.length > 30000) issues.push('the code is unexpectedly large');
  // Catch the most obviously bad patterns. Not a real sandbox.
  const bad = [
    { re: /\beval\s*\(/, msg: 'uses eval' },
    { re: /\bimport\s+/, msg: 'uses ES module import' },
    { re: /\bexport\s+(default|const|function|class|let|var)/, msg: 'uses ES module export' },
    { re: /document\.write\s*\(/, msg: 'uses document.write' },
    { re: /location\.(href|assign|replace)\s*=/, msg: 'navigates the page' },
    { re: /window\.open\s*\(/, msg: 'opens a new window' },
    { re: /(?:^|[^.\w])fetch\s*\(/, msg: 'fetches a URL directly' },
    { re: /XMLHttpRequest/, msg: 'uses XMLHttpRequest' },
  ];
  for (const { re, msg } of bad) if (re.test(code)) issues.push(msg);
  // The user opted out of AI, so the skill must not call Gemini at runtime.
  if (!useAI && /chrome\.runtime\.sendMessage\s*\(/.test(code)) {
    issues.push('uses runtime AI calls but you chose to skip AI for this adapter');
  }
  return issues;
}

// ============================================================
// Tab-load helper
// ============================================================
function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (err) reject(err); else resolve();
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    // If the tab is already complete (or has been closed), resolve/reject now.
    chrome.tabs.get(tabId).then(tab => {
      if (tab?.status === 'complete') finish();
    }).catch(err => finish(err));

    const timer = setTimeout(() => finish(), timeoutMs);
  });
}

async function refreshExplanation() {
  const el = document.getElementById('explainationText');
  el.textContent = 'Generating a plain-language explanation…';
  const prompt =
    'In two short sentences, plain English, no jargon, explain what this JavaScript snippet does to a webpage. ' +
    'Speak directly to a non-developer (use "this adapter"/"it" rather than "the code"). Be concrete about what visibly changes. ' +
    'Output only the two sentences.\n\n' +
    state.generatedCode;
  try {
    const result = await callGemini(prompt);
    state.generatedExplanation = result.trim() || 'It modifies the page based on your description.';
  } catch (e) {
    state.generatedExplanation = `It modifies the page based on your description. (We couldn't generate a fuller explanation: ${e.message}.)`;
  }
  el.textContent = state.generatedExplanation;
}

function setupTryHandlers() {
  document.getElementById('approveBtn').addEventListener('click', () => {
    prefillSave();
    showPhase('save');
  });

  document.getElementById('refineBtn').addEventListener('click', () => {
    if (state.iterationCount >= MAX_ITERATIONS) {
      const counter = document.getElementById('iterCounter');
      counter.hidden = false;
      counter.textContent = `You\'ve hit the ${MAX_ITERATIONS}-revision limit on this adapter. Try "Different idea" to start fresh.`;
      return;
    }
    document.getElementById('refineGroup').hidden = false;
    document.getElementById('refineFeedback').focus();
  });

  document.getElementById('refineCancelBtn').addEventListener('click', () => {
    document.getElementById('refineGroup').hidden = true;
    document.getElementById('refineFeedback').value = '';
  });

  document.getElementById('refineSubmitBtn').addEventListener('click', () => {
    const feedback = document.getElementById('refineFeedback').value.trim();
    if (feedback.length < 3) {
      flashFieldError('refineFeedback', 'Tell us what to change in a few words.');
      return;
    }
    runRefine(feedback);
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    state.generatedCode = '';
    state.generatedExplanation = '';
    state.iterationCount = 0;
    state.useAI = false;
    state.aiAssessment = null;
    showPhase('intent');
  });

  document.getElementById('readAloudBtn').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return;
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const utt = new SpeechSynthesisUtterance(state.generatedExplanation || 'Nothing to read yet.');
    utt.rate = 1.0;
    speechSynthesis.speak(utt);
  });
}

async function runRefine(feedback) {
  document.getElementById('refineGroup').hidden = true;
  document.getElementById('refineFeedback').value = '';
  state.iterationCount += 1;
  const counter = document.getElementById('iterCounter');
  counter.hidden = false;
  counter.textContent = `Revision ${state.iterationCount} of ${MAX_ITERATIONS}.`;

  showPhase('generate');
  resetSteps();

  // ---- Step 1: AI revision ----
  setStep('ai-generate', 'active');
  setStatusLine(`Asking Gemini to revise the code based on your feedback: "${feedback.slice(0, 80)}${feedback.length > 80 ? '…' : ''}"`);

  const prompt = state.prompts.refine
    .replace('{{CURRENT_CODE}}', state.generatedCode)
    .replace('{{DESCRIPTION}}', state.current.description)
    .replace('{{NAME}}', state.current.name)
    .replace('{{FEEDBACK}}', feedback)
    .replace('{{TARGET_INFO}}', state.targetUrl
      ? `EXAMPLE_PAGE: ${state.targetUrl}\n(This is one page the user happened to test on. Treat it as a sample, not a constraint. Do NOT add a hostname/path check that limits the skill to this URL unless the USER_FEEDBACK or ORIGINAL_DESCRIPTION explicitly asks to scope to a particular site.)`
      : 'EXAMPLE_PAGE: (not provided)')
    .replace('{{AI_MODE}}', aiModeDirective(state.useAI));

  let raw;
  const t0 = performance.now();
  try {
    raw = await callGemini(prompt);
  } catch (e) {
    setStep('ai-generate', 'failed');
    showApiError(e);
    return;
  }
  setStep('ai-generate', 'done');
  setStatusLine(`Got the revision in ${Math.round((performance.now() - t0) / 100) / 10}s. Checking it now…`);

  // ---- Step 2: Lint ----
  setStep('lint', 'active');
  await sleep(120);
  const code = normalizeCode(raw);
  const issues = lintGenerated(code, state.useAI);
  if (issues.length > 0) {
    setStep('lint', 'failed');
    showError('The revised code didn\'t look safe to run: ' + issues.join('; ') + '.', true);
    return;
  }
  setStep('lint', 'done');

  state.generatedCode = code;
  document.getElementById('codeView').textContent = code;

  // ---- Steps 3 & 4: Reload + run on target ----
  if (state.targetTabId == null) {
    setStep('load', 'skipped');
    setStep('run', 'skipped');
    setStatusLine('No test page selected — moving on.');
  } else {
    await runOnTargetWithProgress(true);
  }

  // ---- Step 5: Explanation ----
  setStep('explain', 'active');
  setStatusLine('Asking Gemini to describe the revised adapter in plain language…');
  await refreshExplanation();
  setStep('explain', 'done');

  setStatusLine('Done.');
  await sleep(200);
  showPhase('try');
}

// ============================================================
// Save phase
// ============================================================
function setupSaveHandlers() {
  document.getElementById('saveBackBtn').addEventListener('click', () => {
    showPhase('try');
  });
  document.getElementById('saveSubmitBtn').addEventListener('click', () => {
    persistSkill();
  });
}

function renderSaveAreas() {
  const row = document.getElementById('saveAreas');
  row.innerHTML = '';
  for (const area of SUPPORT_AREAS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.area = area.id;
    btn.textContent = area.label;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
    });
    row.appendChild(btn);
  }
}

function prefillSave() {
  document.getElementById('saveName').value = state.current?.name || '';
  const set = new Set((state.current?.supportAreas || []).map(s => String(s).toLowerCase()));
  for (const btn of document.querySelectorAll('#saveAreas .chip')) {
    btn.setAttribute('aria-pressed', set.has(btn.dataset.area) ? 'true' : 'false');
  }
}

async function persistSkill() {
  const name = document.getElementById('saveName').value.trim();
  if (!name) {
    flashFieldError('saveName', 'Please give the adapter a name.');
    return;
  }
  const areas = Array.from(document.querySelectorAll('#saveAreas .chip[aria-pressed="true"]'))
    .map(btn => btn.dataset.area);

  const id = await uniqueSlugFor(name);
  const now = new Date().toISOString();
  const skill = {
    id,
    name,
    description: state.current.description,
    supportAreas: areas,
    code: state.generatedCode,
    enabled: true,
    // Site scope from a scoped request; 'general' = runs everywhere. The
    // background translates this into a runtime gate at registration time.
    scope: state.scope || 'general',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const saveResp = await sendMessage({ type: 'saveCustomSkill', skill });
    if (!saveResp?.success) throw new Error('saveCustomSkill returned no success');
  } catch (e) {
    showError('We couldn\'t save the adapter: ' + e.message, true);
    return;
  }

  // Custom skills are auto-applied by the existing content script on every
  // page load (it reads customSkills directly from storage), so we do not
  // also push the id into activeSkills — that array is used only for built-in
  // skill toggles in the popup, and adding a custom id there shows it as a
  // raw "custom-foo" row in the wrong section.

  state.builtCount += 1;
  const where = (() => {
    const s = state.scope || 'general';
    if (s.startsWith('category:')) return `on ${s.slice(9)} sites`;
    if (s.startsWith('origin:')) return `on ${s.slice(7)}`;
    if (s.startsWith('context:')) return `for ${s.slice(8)} content`;
    return 'on every page';
  })();
  document.getElementById('confirmMessage').textContent =
    `“${name}” is saved. It will run automatically ${where} until you turn it off from the popup.`;

  const hasMore = state.queue.length > 0;
  document.getElementById('confirmNextBtn').hidden = !hasMore;
  showPhase('confirm');
}

async function uniqueSlugFor(name) {
  const base = 'custom-' + name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';
  try {
    const resp = await sendMessage({ type: 'getActiveSkills' });
    const taken = new Set((resp?.customSkills || []).map(s => s.id));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  } catch {
    return `${base}-${Date.now().toString(36)}`;
  }
}

// ============================================================
// Confirm phase
// ============================================================
function setupConfirmHandlers() {
  document.getElementById('confirmNextBtn').addEventListener('click', () => {
    advanceToNextPending();
  });
  document.getElementById('confirmAnotherBtn').addEventListener('click', () => {
    state.mode = 'single';
    state.current = null;
    state.generatedCode = '';
    state.iterationCount = 0;
    state.useAI = false;
    state.aiAssessment = null;
    document.getElementById('intentName').value = '';
    document.getElementById('intentDescription').value = '';
    document.getElementById('refineGroup').hidden = true;
    prefillIntent();
    showPhase('intent');
  });
  document.getElementById('confirmDoneBtn').addEventListener('click', () => {
    finishAll();
  });
}

function finishAll() {
  // Best effort: close the tab. If the browser refuses (window has only one
  // tab and it's ours), navigate somewhere harmless.
  try { window.close(); } catch { /* ignore */ }
  setTimeout(() => {
    if (!document.hidden) {
      document.body.innerHTML =
        '<div style="padding:40px; max-width:500px; margin:auto; font-family:sans-serif;">' +
        '<h1 style="font-size:1.4rem; margin-bottom:12px;">All done.</h1>' +
        '<p>You can close this tab now. Your saved adapters will run automatically as you browse.</p>' +
        '</div>';
    }
  }, 300);
}

// ============================================================
// Error phase
// ============================================================
function setupErrorHandlers() {
  document.getElementById('errorBackBtn').addEventListener('click', () => {
    // If we already have working code, the user came from the try phase and
    // probably wants to keep their iteration. Otherwise drop them at intent.
    if (state.generatedCode) showPhase('try');
    else if (state.mode === 'batch') showPhase('overview');
    else showPhase('intent');
  });
  document.getElementById('errorRetryBtn').addEventListener('click', () => {
    runGenerate();
  });
}

function showError(message, retryable) {
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorRetryBtn').hidden = !retryable;
  showPhase('error');
}

function showApiError(err) {
  const msg = err?.message || String(err);
  if (/api key/i.test(msg)) {
    document.getElementById('errorMessage').innerHTML =
      'We need a Gemini API key to generate adapters, but none is configured. ' +
      'Open the extension popup and paste your key into Settings, then come back. ' +
      '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a Gemini key</a>.';
    document.getElementById('errorRetryBtn').hidden = false;
    showPhase('error');
    return;
  }
  showError(`Gemini didn\'t answer: ${msg}`, true);
}

// ============================================================
// Background message wrappers
// ============================================================
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

async function callGemini(prompt) {
  const resp = await sendMessage({ type: 'gemini', prompt, model: 'gemini-2.5-flash' });
  if (resp?.error) throw new Error(resp.error);
  if (typeof resp?.result !== 'string' || resp.result.length === 0) {
    throw new Error('Gemini returned an empty response.');
  }
  return resp.result;
}

// ============================================================
// Small helpers
// ============================================================
function setStatus(el, kind, text) {
  el.classList.remove('pending', 'success', 'error');
  if (kind) el.classList.add(kind);
  el.querySelector('.status-text').textContent = text;
  const icon = el.querySelector('.status-icon');
  icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '✕' : '•';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function flashFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--red)';
  el.focus();
  // Lightweight aria announcement.
  let live = document.getElementById('liveError');
  if (!live) {
    live = document.createElement('div');
    live.id = 'liveError';
    live.setAttribute('role', 'alert');
    live.className = 'visually-hidden';
    document.body.appendChild(live);
  }
  live.textContent = msg;
  setTimeout(() => { el.style.borderColor = ''; }, 2500);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
