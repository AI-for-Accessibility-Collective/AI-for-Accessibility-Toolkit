// Skill Builder — the user-facing surface for the skill layer.
//
// Wires the real Engineer + Librarian skill API (background `librarian*Skill`
// messages) to a UI where the user can:
//   - describe a need → an existing skill that covers it is offered first;
//   - if none fits, the Engineer composes existing adapters into a skill;
//   - TRY the built skill on the live page, and send it back with feedback
//     for revision, before deciding to SAVE it (consent gate);
//   - see built-in + their own skills;
//   - APPLY a skill to the current page (the "Apply" click is the consent) —
//     adapter recipes go to the content script, action recipes (saved
//     reusable tasks) run through the background's browser agent.
//
// No auto-application anywhere: every page change is a deliberate click.

const $ = (id) => document.getElementById(id);

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(resp || {});
    });
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// A skill's recipe → a readable "does X, Y, Z" list.
function describeAdapters(skill) {
  return (skill.recipe?.adapters || []).map((a) => {
    const keys = Object.keys(a.settings || {});
    const settingStr = keys.length ? ` (${keys.join(', ')})` : '';
    return { id: a.id, settingStr };
  });
}

// ---- Build a new skill (the Engineer) --------------------------------------
let builtSkill = null;

// The skill-creation flow's first question: does a skill for this need already
// exist? We check the skill db (built-in + yours) and offer the match BEFORE
// asking the Engineer to build. `checkedNeed` remembers what we last checked
// so "Build a new one anyway" (or a second Build click) goes straight through.
let checkedNeed = null;
let offeredSkill = null;

function hideReuseOffer() { $('reuseOffer').hidden = true; }

function renderReuseOffer(skill) {
  $('reuseText').innerHTML =
    `A skill for this may already exist: <strong>${escapeHtml(skill.name)}</strong>` +
    ` (${skill.source === 'mine' ? 'yours' : 'built-in'}) — ${escapeHtml(skill.description || '')}`;
  $('reuseOffer').hidden = false;
  $('buildStatus').textContent = 'Found an existing skill that may cover this.';
}

async function onBuild() {
  const need = $('needInput').value.trim();
  if (!need) { $('buildStatus').textContent = 'Type what you need first.'; return; }
  // Disable BEFORE the first await — a double-click must not race two
  // reuse checks or two Engineer builds.
  $('buildBtn').disabled = true;

  if (need !== checkedNeed) {
    checkedNeed = need;
    const { skill: match } = await sendBg({ type: 'librarianFindSkill', need });
    // The person kept typing while we checked — this answer is stale.
    if ($('needInput').value.trim() !== need) { $('buildBtn').disabled = false; return; }
    if (match) {
      $('buildBtn').disabled = false;
      offeredSkill = match;
      renderReuseOffer(match);
      return;
    }
  }
  hideReuseOffer();

  $('buildStatus').textContent = 'The Engineer is composing adapters…';
  $('preview').hidden = true;
  // A fresh build starts a fresh evaluation — don't carry feedback typed
  // against the previous skill into a revision of this new one.
  $('feedbackInput').value = '';

  const resp = await sendBg({ type: 'librarianBuildSkill', need });
  $('buildBtn').disabled = false;

  if (resp.error) { $('buildStatus').textContent = `Couldn't build: ${resp.error}`; return; }
  if (!resp.skill) {
    $('buildStatus').textContent = resp.errors?.length
      ? `The Engineer couldn't build this from existing adapters (${resp.errors.join('; ')}). Try the Adapter Builder for a fully custom capability.`
      : 'No skill was produced. Try rephrasing the need.';
    return;
  }

  builtSkill = resp.skill;
  $('buildStatus').textContent = resp.valid ? 'Built. Review it below.' : 'Built, but review the warnings.';
  renderPreview(resp.skill, resp.valid, resp.errors || []);
}

function renderPreview(skill, valid, errors) {
  $('previewName').textContent = skill.name;
  $('previewDesc').textContent = skill.description;
  const ul = $('previewAdapters');
  ul.innerHTML = '';
  for (const a of describeAdapters(skill)) {
    const li = document.createElement('li');
    li.innerHTML = `<code>${escapeHtml(a.id)}</code>${escapeHtml(a.settingStr)}`;
    ul.appendChild(li);
  }
  const errEl = $('previewErrors');
  if (!valid && errors.length) { errEl.textContent = 'Warnings: ' + errors.join('; '); errEl.hidden = false; }
  else errEl.hidden = true;
  $('saveBtn').disabled = !valid;
  $('tryBtn').disabled = !valid;
  $('preview').hidden = false;
}

async function onSave() {
  if (!builtSkill) return;
  $('saveBtn').disabled = true;
  const resp = await sendBg({ type: 'librarianSaveSkill', skill: builtSkill });
  if (resp.saved) {
    $('buildStatus').textContent = `Saved "${builtSkill.name}".`;
    $('preview').hidden = true;
    $('needInput').value = '';
    builtSkill = null;
    await loadSkills();
  } else {
    $('previewErrors').textContent = 'Could not save: ' + (resp.errors?.join('; ') || 'unknown error');
    $('previewErrors').hidden = false;
    $('saveBtn').disabled = false;
  }
}

// The evaluation loop's "fail" arrow: the person tried (or read) the built
// skill and it isn't right — send it back to the Engineer with their feedback
// and show the revised version in the same preview.
async function onImprove() {
  const feedback = $('feedbackInput').value.trim();
  if (!builtSkill) return;
  if (!feedback) { $('buildStatus').textContent = 'Say what to change first.'; return; }
  $('improveBtn').disabled = true;
  $('buildStatus').textContent = 'The Engineer is revising the skill…';

  const need = $('needInput').value.trim();
  const resp = await sendBg({ type: 'librarianBuildSkill', need, previous: builtSkill, feedback });
  $('improveBtn').disabled = false;

  if (resp.error || !resp.skill) {
    $('buildStatus').textContent = `Couldn't revise: ${resp.error || resp.errors?.join('; ') || 'no skill produced'}`;
    return;
  }
  builtSkill = resp.skill;
  $('feedbackInput').value = '';
  $('buildStatus').textContent = resp.valid ? 'Revised. Review it below.' : 'Revised, but review the warnings.';
  renderPreview(resp.skill, resp.valid, resp.errors || []);
}

// ---- List + apply + delete -------------------------------------------------
let matchName = null;

async function loadSkills() {
  $('listStatus').textContent = 'Loading…';
  const resp = await sendBg({ type: 'librarianListSkills' });
  const skills = resp.skills || [];
  const list = $('skillList');
  list.innerHTML = '';
  if (!skills.length) { $('listStatus').textContent = 'No skills yet — build one above.'; return; }
  $('listStatus').textContent = '';
  for (const skill of skills) list.appendChild(renderCard(skill));
}

function renderCard(skill) {
  const li = document.createElement('li');
  li.className = 'skill-card' + (skill.name === matchName ? ' is-match' : '');
  const adapters = describeAdapters(skill).map((a) => a.id).join(', ');
  const tasks = (skill.recipe?.actions || []).map((a) => a.name || a.prompt).join('; ');
  const does = [
    adapters ? `Applies: ${escapeHtml(adapters)}` : '',
    tasks ? `Runs: ${escapeHtml(tasks)}` : '',
  ].filter(Boolean).join(' · ');
  li.innerHTML = `
    <div class="skill-head">
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      <span class="skill-src">${skill.source === 'mine' ? 'yours' : 'built-in'}</span>
    </div>
    <p class="skill-desc">${escapeHtml(skill.description || '')}</p>
    <p class="skill-adapters">${does}</p>
    <div class="skill-actions"></div>`;
  const actions = li.querySelector('.skill-actions');

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary';
  applyBtn.textContent = 'Apply to this page';
  applyBtn.addEventListener('click', () => applySkill(skill, applyBtn));
  actions.appendChild(applyBtn);

  if (skill.source === 'mine') {
    const del = document.createElement('button');
    del.className = 'btn btn-text';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      del.disabled = true;
      await sendBg({ type: 'librarianDeleteSkill', name: skill.name });
      await loadSkills();
    });
    actions.appendChild(del);
  }
  return li;
}

// The user clicking "Apply" IS the consent. Resolve the skill to settings and
// hand them to the active tab's content script (which runs the adapters).
async function applySkill(skill, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Applying…';
  const tab = await activeTab();
  if (!tab?.id || /^chrome/.test(tab.url || '')) {
    btn.textContent = 'Open a normal page first';
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
    return;
  }
  const resp = await sendBg({ type: 'librarianResolveSkill', skill });
  if (!resp || resp.error || !resp.plan) {
    // Don't claim success when the skill couldn't be resolved — the whole
    // point of Apply is that the user can trust it happened.
    btn.textContent = 'Could not apply';
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
    return;
  }
  // A plan can carry adapter settings (content script applies them), agent
  // actions (the background's browser agent runs them), or both. Track each
  // part separately: with a mixed skill, one part succeeding must not mask
  // the other failing — "Applied ✓" only when everything that was attempted
  // ran, so the person can trust the whole skill happened.
  const plan = resp.plan;
  const hasAdapters = !!plan.adapterIds?.length;
  const hasActions = !!plan.actions?.length;
  let adapterOk = !hasAdapters;
  let actionOk = !hasActions;
  let failText = 'Could not apply';
  if (hasAdapters) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'applySkill', plan });
      adapterOk = true;
    } catch {
      failText = 'Reload the page, then retry';
    }
  }
  if (hasActions) {
    const r = await sendBg({ type: 'runSkillActions', actions: plan.actions, tabId: tab.id });
    if (r?.started) actionOk = true;
    else if (r?.reason === 'agent_busy') failText = 'The assistant is busy — try again soon';
  }
  btn.textContent = (adapterOk && actionOk && (hasAdapters || hasActions)) ? 'Applied ✓' : failText;
  setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
}

async function onSuggest() {
  const tab = await activeTab();
  if (!tab?.url) return;
  const { skill } = await sendBg({ type: 'librarianRetrieveSkill', url: tab.url });
  matchName = skill?.name || null;
  await loadSkills();
  $('listStatus').textContent = skill
    ? `Best fit for this page: "${skill.name}" (highlighted).`
    : 'No built-in or saved skill matches this page yet.';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function init() {
  $('buildBtn').addEventListener('click', onBuild);
  $('saveBtn').addEventListener('click', onSave);
  // The adaptive evaluation step: experience the built skill on the real page
  // BEFORE deciding to save it. Same consent-by-click path as Apply.
  $('tryBtn').addEventListener('click', () => { if (builtSkill) applySkill(builtSkill, $('tryBtn')); });
  $('improveBtn').addEventListener('click', onImprove);
  // Enter submits feedback, matching the popup's aiInput/taskInput convention
  // (keyboard operability matters most in an accessibility tool).
  $('feedbackInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onImprove(); });
  $('discardBtn').addEventListener('click', () => {
    $('preview').hidden = true;
    builtSkill = null;
    $('feedbackInput').value = '';
  });
  $('suggestBtn').addEventListener('click', onSuggest);
  // Reuse offer: "Use it" highlights the existing skill in the list below
  // (Apply from there is the consent click); "Build a new one anyway" falls
  // through to the Engineer because the need was already checked.
  $('reuseUseBtn').addEventListener('click', async () => {
    hideReuseOffer();
    if (!offeredSkill) return;
    matchName = offeredSkill.name;
    await loadSkills();
    $('listStatus').textContent = `"${offeredSkill.name}" is highlighted below — Apply it from there.`;
    document.querySelector('.skills-list-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  $('reuseBuildBtn').addEventListener('click', () => { hideReuseOffer(); onBuild(); });
  $('needInput').addEventListener('input', () => { checkedNeed = null; hideReuseOffer(); });
  loadSkills();
}

init();
