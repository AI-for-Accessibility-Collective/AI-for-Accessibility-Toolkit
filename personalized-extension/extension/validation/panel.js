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

import { contractFromAsk, interview, readAnswer, describe as sayAsk } from './ask.js';

const KEY = 'aa.validation';

export function mountValidationPanel(root, { onControl } = {}) {
  root.classList.add('va');
  root.setAttribute('aria-live', 'polite');
  // The spoken channel is the primary one for a screen-reader user; this
  // surface is secondary, so its live region is polite and its updates never
  // steal focus. The gate is the exception and manages focus explicitly.
  root.setAttribute('aria-relevant', 'additions text');

  let state = null;

  // Forming the contract.
  //
  // A person opens with a word. Everything after it — every check that
  // compares the page against what they actually wanted — needs more than
  // that, and each missing field silently switches off the validators that
  // depend on it. An absent answer does not fail loudly; it just removes a
  // check nobody hears not happening.
  //
  // Before this existed the panel took one sentence and started. That is the
  // stage the flow calls "read back, confirmed", and skipping it meant the run
  // began against whatever could be parsed out of a single line.
  //
  // Four questions, not eleven: the standing tier is not asked up front,
  // because there is no delivery preference to state until checkout offers a
  // choice. Those are reached when the task reaches them.
  let draft = null;        // { contract, queue, i } while forming

  // Storage is shared with the service worker, so a field can arrive as a type
  // this view did not expect. One such value used to throw mid-render and
  // erase the whole panel — every finding gone, no error visible, looking
  // exactly like "nothing was found". A surface whose job is to report
  // problems must never fail silently, so a wrong type costs one section.
  const asList = (v) => (Array.isArray(v) ? v : []);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function render() {
    root.textContent = '';
    if (draft) { root.append(forming()); return; }
    if (!state || !state.contract) {
      root.append(startForm());
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

    // ── what wasn't said ────────────────────────────────────────────────────
    // A field left blank silently switches off the checks that depend on it.
    // Showing which ones is the difference between a layer that quietly does
    // less and one that says so — and it turns the omission into a question
    // the person can answer in one tap rather than a gap only we can see.
    for (const g of asList(state.unspecified)) {
      const q = el('section', 'va-gap');
      q.append(el('p', 'va-text', g.ask));
      q.append(el('p', 'va-where', `without it I can't check ${g.unchecked[0]}`));
      const b = el('button', 'va-do', 'Tell it');
      b.addEventListener('click', () => onControl?.({ action: 'fill-gap', field: g.field }));
      q.append(b);
      root.append(q);
    }

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

  // Checking without delegating.
  //
  // The layer's job is to hold a page to what someone said they wanted, and
  // that is worth doing whether or not an agent is the one clicking. Someone
  // shopping themselves still cannot see that the size on the page stopped
  // matching the size they asked for.
  //
  // It is also the only honest way to demonstrate the layer: an agent driving
  // a live retail site fails for its own reasons, and when it does, everyone
  // watching concludes the checking is what broke.
  function startForm() {
    const s = el('section', 'va-start');
    const id = 'va-ask-input';
    const label = el('label', null, 'What are you looking for?');
    label.setAttribute('for', id);
    s.append(label);

    const row = el('div', 'va-start-row');
    const input = el('input');
    input.id = id;
    input.type = 'text';
    input.placeholder = 'flat sandals with a back strap, size 5, under $40';
    const go = el('button', 'va-do primary', 'Start checking');

    const submit = () => {
      const said = input.value.trim();
      if (!said) { input.focus(); return; }
      // Parse what they said, then ask about what they did not — rather than
      // starting against a half-filled contract.
      const contract = contractFromAsk(said);
      draft = { contract, queue: interview(contract, state?.unlocks || {}), i: 0, notes: [] };
      render();
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    row.append(input, go);
    s.append(row);
    s.append(el('p', 'va-hint',
      'Say it however you like. Anything you leave out, I’ll ask about — '
      + 'I won’t assume it.'));
    return s;
  }

  // One question, then the next, then the whole thing read back.
  function forming() {
    const s = el('section', 'va-form');
    const q = draft.queue[draft.i];

    if (q) {
      s.append(el('p', 'va-form-step', `${draft.i + 1} of ${draft.queue.length}`));
      s.append(el('h2', 'va-form-ask', q.ask));
      // What the answer buys. The questions are derived, not designed — each
      // earns its place by switching specific checks back on — so saying so
      // is the difference between being asked and being interrogated.
      if (q.unlocks) {
        s.append(el('p', 'va-form-why',
          `Answering this switches on ${q.unlocks} check${q.unlocks === 1 ? '' : 's'}`
          + (q.examples?.length ? ` — ${q.examples.join(', ')}` : '')));
      } else {
        s.append(el('p', 'va-form-why', `Without it I can’t check ${q.unchecked[0]}`));
      }

      const row = el('div', 'va-start-row');
      const input = el('input', 'va-form-input');
      input.type = 'text';
      input.setAttribute('aria-label', q.ask);
      const next = () => {
        const { value, note } = readAnswer(q.field, input.value);
        if (value != null && value !== '') {
          draft.contract = { ...draft.contract, [q.field]: value };
          // How it was read, said back. "forty-ish" becoming a $40 ceiling is
          // a decision, and one the person can only correct if they hear it.
          if (note) draft.notes = [...(draft.notes || []), note];
        }
        draft.i += 1;
        render();
      };
      const go = el('button', 'va-do primary', 'Next');
      go.addEventListener('click', next);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
      const skip = el('button', 'va-do', 'Skip');
      // Skipping is allowed and is not free — the checks it would have switched
      // on stay off, and the panel keeps saying so rather than quietly moving on.
      skip.addEventListener('click', () => { draft.i += 1; render(); });

      // "That's everything" — done TELLING, not done with the task.
      //
      // Someone who has said all they have to say should not have to press
      // Skip once per remaining question. This jumps to the read-back, where
      // what stays unchecked is spelled out before anything starts.
      const enough = el('button', 'va-do', 'That’s everything');
      enough.addEventListener('click', () => { draft.i = draft.queue.length; render(); });
      row.append(input, go, skip, enough);
      s.append(row);
      const last = (draft.notes || [])[draft.notes.length - 1];
      if (last && draft.i > 0) s.append(el('p', 'va-form-note', last));
      requestAnimationFrame(() => input.focus());
      return s;
    }

    // Read back, and wait for a yes.
    s.append(el('h2', 'va-form-ask', 'Sound right?'));
    s.append(el('p', 'va-form-back', sayAsk(draft.contract)));
    const promises = el('ul', 'va-form-promises');
    for (const line of ['I won’t press Buy Now',
                        'I won’t place the order — I’ll bring it to you first',
                        'I’ll read facts from the page in its own words']) {
      promises.append(el('li', null, line));
    }
    s.append(promises);

    const left = interview(draft.contract, state?.unlocks || {});
    if (left.length) {
      s.append(el('p', 'va-form-why',
        `${left.length} thing${left.length === 1 ? '' : 's'} you skipped, so `
        + `${left.map((x) => x.unchecked[0]).join(' and ')} stay${left.length === 1 ? 's' : ''} unchecked.`));
    }

    const row = el('div', 'va-start-row');
    const yes = el('button', 'va-do primary', 'Yes, go');
    yes.addEventListener('click', () => {
      const c = draft.contract;
      draft = null;
      onControl?.({ action: 'start', contract: c });
    });
    const back = el('button', 'va-do', 'Change something');
    back.addEventListener('click', () => { draft.i = 0; render(); });
    row.append(yes, back);
    s.append(row);
    return s;
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
