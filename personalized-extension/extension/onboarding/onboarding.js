// -- Skill registry (inline to avoid module bundling for extension pages) --
const REGISTRY = [
  { id: 'auto-alt-text', name: 'Auto Alt Text', description: 'Generates descriptive alt text for images using AI.', supportAreas: ['vision'], siteRelevance: ['all'], icon: '\u{1F5BC}\uFE0F' },
  { id: 'fix-contrast', name: 'Fix Contrast', description: 'Fixes poor color contrast to meet WCAG AA standards.', supportAreas: ['vision'], siteRelevance: ['all'], icon: '\u{1F3A8}' },
  { id: 'simplify-text', name: 'Simplify Text', description: 'Rewrites complex text to a simpler reading level using AI.', supportAreas: ['cognitive', 'reading'], siteRelevance: ['news', 'education'], icon: '\u270F\uFE0F' },
  { id: 'dark-mode', name: 'Dark Mode', description: 'Inverts the page to a dark theme, reducing eye strain.', supportAreas: ['vision', 'sensory'], siteRelevance: ['all'], icon: '\u{1F319}' },
  { id: 'focus-mode', name: 'Focus Mode', description: 'Dims ads and distractions, highlights the paragraph you are reading.', supportAreas: ['cognitive', 'reading', 'sensory'], siteRelevance: ['news', 'education', 'social'], icon: '\u{1F3AF}' },
  { id: 'reader-mode', name: 'Reader Mode', description: 'Shows article content in a clean, distraction-free overlay.', supportAreas: ['cognitive', 'reading', 'sensory'], siteRelevance: ['news', 'education'], icon: '\u{1F4C4}' },
  { id: 'motion-reducer', name: 'Reduce Motion', description: 'Stops animations, GIFs, auto-playing videos, and parallax scrolling.', supportAreas: ['sensory', 'cognitive', 'vision'], siteRelevance: ['all'], icon: '\u23F8\uFE0F' },
  { id: 'large-cursor', name: 'Large Cursor', description: 'Replaces the mouse cursor with a larger, more visible one.', supportAreas: ['vision', 'motor'], siteRelevance: ['all'], icon: '\u{1F5B1}\uFE0F' },
  { id: 'dyslexia-font', name: 'Dyslexia Font', description: 'Applies OpenDyslexic font with wider spacing for dyslexic readers.', supportAreas: ['reading', 'cognitive'], siteRelevance: ['all'], icon: '\u{1F524}' },
  { id: 'keyboard-nav', name: 'Keyboard Navigation', description: 'Adds skip links, focus indicators, and keyboard shortcuts.', supportAreas: ['motor', 'vision'], siteRelevance: ['all'], icon: '\u2328\uFE0F' },
  { id: 'auto-captions', name: 'Auto Captions', description: 'Adds caption controls for video and audio without subtitles.', supportAreas: ['hearing'], siteRelevance: ['video', 'social', 'education'], icon: '\u{1F4AC}' },
  { id: 'color-filter', name: 'Color Blind Filter', description: 'Color correction for protanopia, deuteranopia, or tritanopia.', supportAreas: ['vision'], siteRelevance: ['all'], icon: '\u{1F3A8}' },
  { id: 'visual-assist', name: 'Visual Assist', description: 'Adjustable font size, line height, letter spacing, and reading guide.', supportAreas: ['vision', 'reading'], siteRelevance: ['all'], icon: '\u{1F441}\uFE0F' },
];

const AREA_LABELS = {
  vision: 'Vision', cognitive: 'Cognitive', hearing: 'Hearing',
  motor: 'Motor', sensory: 'Sensory', reading: 'Reading',
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -- State --
let recommendations = null;
let wizardAreas = [];
let wizardStep = 0;
const wizardSelections = {};    // { areaId: Set<skillId> }
const wizardNewSkills = {};     // { areaId: string }

// -- Init --
document.addEventListener('DOMContentLoaded', () => {
  setupApiKey();
  setupPathButtons();
});

// -- Page navigation --
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(id);
  page.classList.add('active');
  const heading = page.querySelector('h2, h3');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

// -- API key --
function setupApiKey() {
  const input = document.getElementById('apiKeyInput');
  const toggle = document.getElementById('toggleKeyVisibility');
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? 'Show' : 'Hide';
    toggle.setAttribute('aria-label', showing ? 'Show API key' : 'Hide API key');
  });

  sendMessageSafe({ type: 'getApiKey' }).then((resp) => {
    if (resp?.apiKey) {
      input.value = resp.apiKey;
      document.getElementById('apiDetails').open = false;
    } else {
      document.getElementById('apiDetails').open = true;
    }
  }).catch(() => {
    document.getElementById('apiDetails').open = true;
  });
}

function getApiKey() {
  return document.getElementById('apiKeyInput').value.trim();
}

function requireApiKey() {
  const key = getApiKey();
  if (!key) {
    const status = document.getElementById('apiKeyStatus');
    status.textContent = 'An API key is required. Get one from Google AI Studio.';
    status.className = 'status-msg error';
    document.getElementById('apiDetails').open = true;
    document.getElementById('apiKeyInput').focus();
    return null;
  }
  chrome.runtime.sendMessage({ type: 'saveApiKey', apiKey: key });
  return key;
}

function getSelectedAreas() {
  return Array.from(document.querySelectorAll('input[name="support"]:checked')).map(c => c.value);
}

function getFreeText() {
  return document.getElementById('freeText').value.trim();
}

// -- Path buttons --
function setupPathButtons() {
  document.getElementById('quickStartBtn').addEventListener('click', startQuickStart);
  document.getElementById('personalizeBtn').addEventListener('click', startPersonalize);
  document.getElementById('recBackBtn').addEventListener('click', () => showPage('page-landing'));
  document.getElementById('recFinishBtn').addEventListener('click', finishFromRecommendations);
  document.getElementById('wizBackBtn').addEventListener('click', wizardBack);
  document.getElementById('wizNextBtn').addEventListener('click', wizardNext);
  document.getElementById('summaryBackBtn').addEventListener('click', () => {
    wizardStep = wizardAreas.length - 1;
    renderWizardStep();
    showPage('page-wizard');
  });
  document.getElementById('summaryFinishBtn').addEventListener('click', finishFromSummary);
}

// ============================================================
// QUICK START PATH
// ============================================================
async function startQuickStart() {
  const apiKey = requireApiKey();
  if (!apiKey) return;

  showPage('page-recommendations');
  const loading = document.getElementById('loadingIndicator');
  const container = document.getElementById('recommendationsContainer');
  const finishBtn = document.getElementById('recFinishBtn');

  loading.hidden = false;
  container.hidden = true;
  finishBtn.hidden = true;

  try {
    const prompt = buildPrompt(getSelectedAreas(), getFreeText());
    const raw = await callGemini(prompt, apiKey);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    recommendations = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(recommendations.recommended)) recommendations.recommended = [];
    if (!Array.isArray(recommendations.newSkills)) recommendations.newSkills = [];
    renderRecommendations();
  } catch (e) {
    console.error('Recommendation error:', e);
    document.getElementById('recSubtitle').textContent =
      'Something went wrong. You can go back and try again.';
    recommendations = { recommended: [], newSkills: [] };
    renderRecommendations();
  }

  loading.hidden = true;
  container.hidden = false;
  finishBtn.hidden = false;
  finishBtn.focus();
}

function buildPrompt(areas, text) {
  const reg = REGISTRY.map(s => ({ id: s.id, name: s.name, description: s.description, supportAreas: s.supportAreas }));
  return `You are an accessibility expert configuring a browser extension.

User needs:
- Support areas: ${areas.length > 0 ? areas.join(', ') : 'none selected'}
- Description: ${text || 'none provided'}

Available skills:
${JSON.stringify(reg, null, 2)}

Return JSON with:
1. "recommended" — array of { "skillId": string, "reason": string }. ALWAYS include every built-in skill that is relevant to the user's needs, even if you also suggest new custom skills. This array should never be empty if any built-in skills match.
2. "newSkills" — array of { "name": string, "description": string, "supportAreas": string[] } ONLY for needs that no built-in skill above can address. This is in addition to recommended, not instead of.

Rules: recommend ALL genuinely matching built-in skills first, then suggest new skills only for unmet needs. If no areas selected, infer from text. Return ONLY valid JSON.`;
}

function sendMessageSafe(msg, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    chrome.runtime.sendMessage(msg, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

async function callGemini(prompt, apiKey) {
  const resp = await sendMessageSafe({ type: 'gemini', prompt, apiKey });
  if (resp?.error) throw new Error(resp.error);
  return resp?.result || '';
}

function renderRecommendations() {
  const recList = document.getElementById('recommendedSkills');
  const newList = document.getElementById('newSkills');
  const newSection = document.getElementById('newSkillsSection');

  recList.innerHTML = '';
  newList.innerHTML = '';

  if (recommendations.recommended.length === 0 && recommendations.newSkills.length === 0) {
    recList.innerHTML = '<p class="empty-msg">No specific recommendations. You can enable skills from the popup anytime.</p>';
  }

  for (const rec of recommendations.recommended) {
    recList.appendChild(createSkillToggleCard(rec.skillId, true, rec.reason));
  }

  if (recommendations.newSkills.length > 0) {
    newSection.hidden = false;
    for (const skill of recommendations.newSkills) {
      newList.appendChild(createNewSkillCard(skill));
    }
  } else {
    newSection.hidden = true;
  }
}

function createSkillToggleCard(skillId, checked, reason) {
  const skill = REGISTRY.find(s => s.id === skillId);
  const card = document.createElement('div');
  card.className = `skill-card${checked ? ' enabled' : ''}`;
  card.setAttribute('role', 'listitem');

  const toggleId = `toggle-${skillId}-${Math.random().toString(36).slice(2, 6)}`;

  card.innerHTML = `
    <span class="skill-card-icon" aria-hidden="true">${escapeHtml(skill?.icon) || '\u26A1'}</span>
    <div class="skill-card-info">
      <div class="skill-card-name" id="label-${escapeHtml(toggleId)}">${escapeHtml(skill?.name || skillId)}</div>
      ${skill?.description ? `<div class="skill-card-desc">${escapeHtml(skill.description)}</div>` : ''}
      ${reason ? `<div class="skill-card-reason">${escapeHtml(reason)}</div>` : ''}
    </div>
    <label class="skill-toggle">
      <input type="checkbox" ${checked ? 'checked' : ''} data-skill-id="${escapeHtml(skillId)}"
             aria-labelledby="label-${escapeHtml(toggleId)}">
      <span class="skill-toggle-track" aria-hidden="true"></span>
    </label>
  `;

  const cb = card.querySelector('input');
  cb.addEventListener('change', () => card.classList.toggle('enabled', cb.checked));

  return card;
}

function createNewSkillCard(skill) {
  const card = document.createElement('div');
  card.className = 'skill-card new-skill';
  card.setAttribute('role', 'listitem');
  card.innerHTML = `
    <span class="skill-card-icon" aria-hidden="true">\u2728</span>
    <div class="skill-card-info">
      <div class="skill-card-name">${escapeHtml(skill.name)}</div>
      <div class="skill-card-desc">${escapeHtml(skill.description)}</div>
    </div>
  `;
  return card;
}

async function finishFromRecommendations() {
  const enabled = [];
  document.querySelectorAll('#recommendedSkills input:checked').forEach(cb => {
    enabled.push(cb.dataset.skillId);
  });
  await saveAndFinish(enabled, recommendations?.newSkills || []);
}

// ============================================================
// PERSONALIZED WIZARD PATH
// ============================================================
function startPersonalize() {
  const apiKey = requireApiKey();
  if (!apiKey) return;

  const selected = getSelectedAreas();
  wizardAreas = selected.length > 0 ? selected : Object.keys(AREA_LABELS);
  wizardStep = 0;

  for (const area of wizardAreas) {
    wizardSelections[area] = new Set();
    wizardNewSkills[area] = '';
  }

  renderWizardStep();
  showPage('page-wizard');
}

function renderWizardStep() {
  const area = wizardAreas[wizardStep];
  const container = document.getElementById('wizardContainer');
  const skills = REGISTRY.filter(s => s.supportAreas.includes(area));

  const stepEl = document.createElement('div');
  stepEl.className = 'wizard-step';

  const heading = document.createElement('h3');
  heading.textContent = `${AREA_LABELS[area]} Support`;
  heading.setAttribute('tabindex', '-1');

  const desc = document.createElement('p');
  desc.className = 'step-desc';
  desc.textContent = 'Select the skills you want to enable for this area.';

  const list = document.createElement('div');
  list.className = 'skill-list';
  list.setAttribute('role', 'list');

  for (const skill of skills) {
    const checked = wizardSelections[area].has(skill.id);
    list.appendChild(createSkillToggleCard(skill.id, checked));
  }

  // Wire toggles to update wizard state
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) wizardSelections[area].add(cb.dataset.skillId);
      else wizardSelections[area].delete(cb.dataset.skillId);
    });
  });

  const newSection = document.createElement('div');
  newSection.className = 'new-skill-input-section';
  const inputId = `new-skill-${area}`;
  newSection.innerHTML = `
    <label for="${inputId}">Need something not listed? Describe it:</label>
    <input type="text" id="${inputId}" placeholder="e.g. Highlight the current recipe step"
           value="${wizardNewSkills[area] || ''}">
  `;

  stepEl.appendChild(heading);
  stepEl.appendChild(desc);
  stepEl.appendChild(list);
  stepEl.appendChild(newSection);

  container.innerHTML = '';
  container.appendChild(stepEl);

  // Save new-skill text on input
  const newInput = stepEl.querySelector(`#${inputId}`);
  newInput.addEventListener('input', () => {
    wizardNewSkills[area] = newInput.value;
  });

  // Update progress
  const progress = document.getElementById('wizardProgress');
  progress.textContent = `Step ${wizardStep + 1} of ${wizardAreas.length}`;

  const nextBtn = document.getElementById('wizNextBtn');
  nextBtn.textContent = wizardStep === wizardAreas.length - 1 ? 'Review' : 'Next';

  // Focus the heading after render
  requestAnimationFrame(() => heading.focus());
}

function wizardBack() {
  if (wizardStep > 0) {
    wizardStep--;
    renderWizardStep();
  } else {
    showPage('page-landing');
  }
}

function wizardNext() {
  if (wizardStep < wizardAreas.length - 1) {
    wizardStep++;
    renderWizardStep();
  } else {
    showSummary();
  }
}

// ============================================================
// SUMMARY PAGE
// ============================================================
function showSummary() {
  const allSkills = new Set();
  for (const area of wizardAreas) {
    for (const id of wizardSelections[area]) {
      allSkills.add(id);
    }
  }

  const newSkills = [];
  for (const area of wizardAreas) {
    const text = (wizardNewSkills[area] || '').trim();
    if (text) {
      newSkills.push({ name: text, description: text, supportAreas: [area] });
    }
  }

  const skillList = document.getElementById('summarySkills');
  skillList.innerHTML = '';

  if (allSkills.size === 0) {
    skillList.innerHTML = '<p class="empty-msg">No skills selected. You can enable them later from the popup.</p>';
  } else {
    for (const id of allSkills) {
      const skill = REGISTRY.find(s => s.id === id);
      const card = document.createElement('div');
      card.className = 'skill-card enabled';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <span class="skill-card-icon" aria-hidden="true">${escapeHtml(skill?.icon) || '\u26A1'}</span>
        <div class="skill-card-info">
          <div class="skill-card-name">${escapeHtml(skill?.name || id)}</div>
          <div class="skill-card-desc">${escapeHtml(skill?.description || '')}</div>
        </div>
      `;
      skillList.appendChild(card);
    }
  }

  const newSection = document.getElementById('summaryNewSection');
  const newList = document.getElementById('summaryNewSkills');
  newList.innerHTML = '';

  if (newSkills.length > 0) {
    newSection.hidden = false;
    for (const ns of newSkills) {
      newList.appendChild(createNewSkillCard(ns));
    }
  } else {
    newSection.hidden = true;
  }

  // Store for finish
  showSummary._skills = Array.from(allSkills);
  showSummary._newSkills = newSkills;

  const finishBtn = document.getElementById('summaryFinishBtn');
  finishBtn.textContent = newSkills.length > 0 ? 'Open Skill Builder' : 'Finish Setup';

  showPage('page-summary');
}

async function finishFromSummary() {
  await saveAndFinish(showSummary._skills || [], showSummary._newSkills || []);
}

// ============================================================
// SHARED FINISH
// ============================================================

// Maps onboarding skill registry IDs to the chrome.storage.sync keys the popup/content use.
const SKILL_TO_SETTINGS = {
  'dark-mode':      { darkMode: true },
  'focus-mode':     { focusMode: true, hideDistractions: true, showProgress: true },
  'reader-mode':    { readerMode: true },
  'motion-reducer': { motionReducer: true },
  'keyboard-nav':   { keyboardNav: true },
  'voice-commands': { voiceCommands: true },
  'auto-alt-text':  { autoDescribe: true },
  'fix-contrast':   { autoWcagFix: true },
  'simplify-text':  { autoSimplify: true },
  'auto-captions':  { autoCaptions: true },
  'color-filter':   { colorBlindMode: 'protanopia' },
  'large-cursor':   { largeCursor: true },
  'dyslexia-font':  { dyslexiaFont: true, letterSpacing: 0.12, lineHeight: 2.0 },
  'visual-assist':  { fontScale: 130, lineHeight: 1.8, enhanceFocus: true, readingGuide: true },
  'generate-labels':   { autoFixLabels: true },
  'generate-captions': { autoCaptions: true },
  'wcag-fixes':        { autoWcagFix: true },
  'read-aloud':        {},
};

function skillIdsToSyncSettings(enabledSkillIds) {
  const numericKeys = ['fontScale', 'lineHeight', 'letterSpacing'];
  const merged = {};
  for (const id of enabledSkillIds) {
    const mapping = SKILL_TO_SETTINGS[id];
    if (!mapping) continue;
    for (const [key, value] of Object.entries(mapping)) {
      if (numericKeys.includes(key) && typeof value === 'number') {
        merged[key] = Math.max(merged[key] || 0, value);
      } else {
        merged[key] = merged[key] || value;
      }
    }
  }
  return merged;
}

async function saveAndFinish(enabledSkillIds, newSkills) {
  const profile = {
    supportAreas: getSelectedAreas(),
    freeText: getFreeText(),
    createdAt: new Date().toISOString(),
  };

  await sendMessageSafe({ type: 'saveUserProfile', profile });
  await sendMessageSafe({ type: 'setActiveSkills', skills: enabledSkillIds });

  const syncSettings = skillIdsToSyncSettings(enabledSkillIds);
  syncSettings.enabled = true;
  syncSettings.onboardingComplete = true;
  await chrome.storage.sync.set(syncSettings);

  if (newSkills.length > 0) {
    chrome.runtime.sendMessage({ type: 'openSkillBuilder', pendingSkills: newSkills });
  }

  window.close();
}
