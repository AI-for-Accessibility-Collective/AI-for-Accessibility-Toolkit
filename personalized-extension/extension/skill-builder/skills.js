// Skill Builder — the user-facing surface for the skill layer.
//
// Wires the real Engineer + Librarian skill API (background `librarian*Skill`
// messages) to a UI where the user can:
//   - describe a need → the Engineer composes existing adapters into a skill;
//   - review it (what adapters, what settings) and SAVE it (consent gate);
//   - see built-in + their own skills;
//   - APPLY a skill to the current page (the "Apply" click is the consent) —
//     which resolves the skill to settings and hands them to the content
//     script's adapter path.
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

async function onBuild() {
  const need = $('needInput').value.trim();
  if (!need) { $('buildStatus').textContent = 'Type what you need first.'; return; }
  $('buildBtn').disabled = true;
  $('buildStatus').textContent = 'The Engineer is composing adapters…';
  $('preview').hidden = true;

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
  li.innerHTML = `
    <div class="skill-head">
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      <span class="skill-src">${skill.source === 'mine' ? 'yours' : 'built-in'}</span>
    </div>
    <p class="skill-desc">${escapeHtml(skill.description || '')}</p>
    <p class="skill-adapters">Applies: ${escapeHtml(adapters)}</p>
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
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'applySkill', plan: resp.plan });
    btn.textContent = 'Applied ✓';
  } catch {
    btn.textContent = 'Reload the page, then retry';
  }
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
  $('discardBtn').addEventListener('click', () => { $('preview').hidden = true; builtSkill = null; });
  $('suggestBtn').addEventListener('click', onSuggest);
  loadSkills();
}

init();
