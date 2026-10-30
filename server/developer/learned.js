// The Profiles page's "What your toolkit learned": the suggested profile
// changes waiting for an answer, the memories, pause, learn now and reset.
// Everything goes through the toolkit's profile_* MCP tools (the SDK's
// registry client, `.profile`), the same ones an app or a coding agent uses.

import { createRegistryClient } from '/sdk/toolkit/adapter-mcp/index.js';

const $ = id => document.getElementById(id);

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(className, text, onClick, label) {
  const b = element('button', className, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

const valueText = v => typeof v === 'string' ? v : JSON.stringify(v);

/** One suggested change in plain words. */
function changeText(p) {
  const c = p.change || {};
  if (c.op === 'profile-set') return `Set ${c.path.replace(/^fields\./, '')} to ${valueText(c.value)}.`;
  if (c.op === 'add-profile-action') return `Save "${c.action?.name || 'this task'}" as an action to run again.`;
  return '';
}

const SCOPE_TEXT = s => s === 'general' ? 'everywhere' : s.replace(/^origin:/, 'on ').replace(/^category:/, 'on ').replace(/^context:/, 'in ');

export function createLearnedPanel({ getClient, status, run, onProfileChanged }) {
  let tools = null, toolsFor = null;
  function profileTools() {
    const client = getClient();
    if (!client) return null;
    if (toolsFor !== client) {
      tools = createRegistryClient({ url: client.base, token: client.token }).profile;
      toolsFor = client;
    }
    return tools;
  }

  const controls = ['learned-paused', 'learned-now', 'learned-refresh', 'learned-reset', 'learned-reset-all'];
  function setEnabled(on) { for (const id of controls) $(id).disabled = !on; }

  function render(state) {
    const proposals = $('learned-proposals'), memories = $('learned-memories');
    proposals.replaceChildren();
    memories.replaceChildren();
    if (!state) {
      $('learned-summary').textContent = 'Sign in to see what your toolkit learned.';
      setEnabled(false);
      return;
    }
    setEnabled(true);
    $('learned-paused').checked = state.paused;
    $('learned-summary').textContent = [
      state.paused ? 'Learning is paused.' : 'Learning is on.',
      state.pendingObservations ? `${state.pendingObservations} observation${state.pendingObservations === 1 ? '' : 's'} to learn from.` : '',
      `${state.proposalsThisWeek} of ${state.proposalsPerWeek} suggestions this week.`,
    ].filter(Boolean).join(' ');

    for (const p of state.proposals) {
      const li = element('li', 'learned-item');
      li.append(element('strong', '', p.label));
      const what = changeText(p);
      if (what) li.append(element('p', '', what));
      if (p.rationale) li.append(element('p', 'hint', p.rationale));
      const actions = element('div', 'card-actions');
      actions.append(
        button('primary small', 'Accept', () => answer(p, 'accept'), `Accept: ${p.label}`),
        button('secondary small', 'Not now', () => answer(p, 'declineOnce'), `Not now: ${p.label}`),
        button('text-button', 'Stop suggesting this', () => answer(p, 'suppress'), `Stop suggesting: ${p.label}`),
      );
      li.append(actions);
      proposals.append(li);
    }
    if (!state.proposals.length) proposals.append(element('li', 'hint', 'No suggestions waiting.'));

    for (const m of state.memories) {
      const li = element('li', 'learned-item learned-memory');
      const text = element('p', '', m.text);
      const where = element('span', 'badge', m.kind === 'note' ? 'your note' : SCOPE_TEXT(m.scope || 'general'));
      li.append(text, where);
      // Learned from what one app or adapter gave: only it (and you) can read it.
      if (m.visibility === 'app' || m.visibility === 'adapter') li.append(element('span', 'badge', m.visibility === 'app' ? `only ${m.app}` : `only ${m.adapter}`));
      li.append(button('text-button', 'Forget', () => forget(m), `Forget: ${m.text}`));
      memories.append(li);
    }
    if (!state.memories.length) memories.append(element('li', 'hint', 'Nothing learned yet.'));
  }

  async function refresh() {
    const t = profileTools();
    if (!t) return render(null);
    render(await t.learned());
  }

  function answer(p, response) {
    run(async () => {
      const result = await profileTools().respond(p.id, response);
      if (result?.ok === false) throw new Error(`Could not answer that suggestion (${result.reason}).`);
      await refresh();
      if (response === 'accept') {
        await onProfileChanged?.();
        status(`Accepted: ${p.label}. Your profile changed, and connected apps follow it.`);
      } else {
        status(response === 'suppress' ? `Your toolkit stops suggesting this: ${p.label}.` : `Not now: ${p.label}.`);
      }
    });
  }

  function forget(m) {
    run(async () => {
      await profileTools().forget(m.id);
      await refresh();
      status('Forgot that memory.');
    });
  }

  $('learned-paused').addEventListener('change', () => run(async () => {
    const paused = $('learned-paused').checked;
    await profileTools().pause(paused);
    await refresh();
    status(paused ? 'Learning is paused. Your toolkit keeps no new observations.' : 'Learning is on again.');
  }));
  $('learned-now').addEventListener('click', () => run(async () => {
    status('Learning from the observations so far…');
    const result = await profileTools().learnNow();
    await refresh();
    status(result?.ran ? `Learned from ${result.observations} observation${result.observations === 1 ? '' : 's'}.`
      : result?.reason === 'empty' ? 'Nothing new to learn from.' : result?.reason === 'no-llm' ? 'This toolkit has no language model to learn with.' : 'Learning did not run.');
  }));
  $('learned-refresh').addEventListener('click', () => run(refresh));
  $('learned-reset').addEventListener('click', () => run(async () => {
    const { cleared } = await profileTools().reset();
    await refresh();
    status(`Reset the suggestions: cleared ${cleared.proposals}, and the weekly count starts again at zero.`);
  }));
  $('learned-reset-all').addEventListener('click', () => {
    if (!confirm('Reset everything your toolkit learned? This clears the suggestions, the memories and the observations not learned from yet. Your profile and your own notes stay.')) return;
    run(async () => {
      const { cleared } = await profileTools().reset({ memories: true });
      await refresh();
      status(`Reset everything learned: ${cleared.memories} memories, ${cleared.proposals} suggestions and ${cleared.observations} observations cleared.`);
    });
  });

  return { refresh, reset: () => { toolsFor = null; render(null); } };
}
