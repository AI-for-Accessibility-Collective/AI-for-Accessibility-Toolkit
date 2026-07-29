// The validation panel.
//
// Renders the run's findings for someone who can see the page. Two rules shape
// everything here:
//
//   Quiet by default. This persona has not lost perception — they can look at
//   the page. A finding is a mark beside the thing it concerns, not an
//   announcement, because interrupting someone who could simply look is pure
//   cost. The only loud element is the gate, and it is loud because the agent
//   is genuinely held.
//
//   Controls, not descriptions. What delegation took from this person is the
//   doing: re-sort, open a different one, change the size, remove the extras.
//   Telling them what is wrong without handing back the control is just bad
//   news delivered on time.
//
// It reads chrome.storage rather than keeping its own copy, so the panel and
// the spoken channel can never disagree about what the run found.

const KEY = 'aa.validation';

export function mountValidationPanel(root, { onControl } = {}) {
  root.classList.add('va');
  root.setAttribute('aria-live', 'polite');
  // The spoken channel is the primary one for a screen-reader user; this
  // surface is secondary, so its live region is polite and its updates never
  // steal focus. The gate is the exception and manages focus explicitly.
  root.setAttribute('aria-relevant', 'additions text');

  let state = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function render() {
    root.textContent = '';
    if (!state || !state.contract) {
      root.append(el('div', 'va-empty', 'No task running.'));
      return;
    }

    // ── the ask, always visible and editable ────────────────────────────────
    const c = state.contract;
    const ask = el('section', 'va-ask');
    ask.append(el('h2', null, 'What you asked for'));
    ask.append(el('p', null, describe(c)));
    const edit = el('button', 'va-edit', 'Change something');
    edit.addEventListener('click', () => onControl?.({ action: 'edit-ask' }));
    ask.append(edit);
    root.append(ask);

    // ── the gate, when the agent is held ────────────────────────────────────
    if (state.gate && state.gate.allowed === false) {
      const gate = el('section', 'va-gate');
      gate.setAttribute('role', 'alertdialog');
      gate.setAttribute('aria-label', 'The agent is waiting for you');
      gate.append(el('h2', null, 'Waiting for you'));
      gate.append(el('p', null, state.gate.say || 'Something needs your decision.'));

      const answers = el('div', 'va-answers');
      for (const [label, response, primary] of gateChoices(state)) {
        const b = el('button', `va-do${primary ? ' primary' : ''}`, label);
        b.addEventListener('click', () => onControl?.({
          action: 'answer', widget: (state.gate.waitingOn || [])[0], response,
        }));
        answers.append(b);
      }
      gate.append(answers);
      root.append(gate);
      // The one place focus moves on its own, because the run cannot proceed
      // until this is answered.
      requestAnimationFrame(() => gate.querySelector('.va-do')?.focus());
    }

    // ── findings ────────────────────────────────────────────────────────────
    const findings = (state.findings || []).filter((f) => f.level !== 'ambient' || f.confirming);
    if (!findings.length) {
      root.append(el('div', 'va-empty', 'Nothing to flag yet.'));
    } else {
      const list = el('ul', 'va-list');
      for (const f of findings) {
        const li = el('li', `va-item ${tone(f)}`);
        li.append(el('span', 'va-dot'));
        const body = el('div', 'va-body');
        body.append(el('p', 'va-text', f.say));
        if (f.from) body.append(el('p', 'va-where', f.from));
        if (f.control) {
          const b = el('button', 'va-do', f.control.label);
          b.addEventListener('click', () => onControl?.(f.control));
          body.append(b);
        }
        li.append(body);
        list.append(li);
      }
      root.append(list);
    }

    // ── footer ──────────────────────────────────────────────────────────────
    const foot = el('div', 'va-foot');
    const n = (state.said || []).length;
    foot.append(el('span', null,
      `${n} thing${n === 1 ? '' : 's'} said · ${state.spokenWords || 0} words`));
    const more = el('button', null, 'What else did you check?');
    more.addEventListener('click', () => onControl?.({ action: 'on-request' }));
    foot.append(more);
    root.append(foot);
  }

  const tone = (f) => (f.confirming ? 'ok'
    : f.level === 'stop' ? 'stop' : f.level === 'aside' ? 'note' : 'quiet');

  // Answers offered at a gate, derived from what is being waited on so the
  // person is answering a question about their own task rather than picking
  // from a generic yes/no.
  function gateChoices(s) {
    const w = ((s.gate.waitingOn || [])[0] || '').toLowerCase();
    if (/size/.test(w)) {
      return [['Use it anyway', 'use it', false], ['Change the size', 'change it', true]];
    }
    if (/extra items|cap/.test(w)) {
      return [['Remove the extras', 'remove them', true], ['Go ahead', 'go ahead', false]];
    }
    if (/land/.test(w)) {
      return [['Try again', 'try again', true], ['Stop here', 'stop', false]];
    }
    return [['Go on', 'go on', true], ['Stop here', 'stop', false]];
  }

  function describe(c) {
    const bits = [c.item];
    if (c.mustHaves?.length) bits.push(c.mustHaves.join(' and '));
    if (c.size) bits.push(`size ${c.size}`);
    if (c.budget) bits.push(`under ${c.budget}`);
    if (c.deadline) bits.push(`by ${c.deadline}`);
    return `${bits.filter(Boolean).join(', ')}.`;
  }

  chrome.storage.local.get(KEY).then((r) => { state = r[KEY] || null; render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    state = changes[KEY].newValue;
    render();
  });

  return { render, get state() { return state; } };
}
