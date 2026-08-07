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
  let lastPainted = null;   // skip rebuilds when nothing changed
  let focusedGate = null;   // focus the gate once per new hold, not per render

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
    // A storage write that changes nothing must not cost the person their
    // scroll position, their focus, or the text they are mid-typing.
    // `updated` is a timestamp that changes on every publish - leaving it in
    // meant the guard never matched and every publish rebuilt the panel.
    const now = JSON.stringify(state ? { ...state, updated: 0 } : null);
    if (now === lastPainted) return;
    lastPainted = now;

    // What the person had before the rebuild, restored after it.
    const openKeys = [...root.querySelectorAll('details[open] > summary')]
      .map((n) => n.textContent);
    const active = document.activeElement;
    // A stable key beats button text: several gap sections all say "Answer",
    // and matching by text sent focus to the first one - the wrong question,
    // for exactly the keyboard and screen reader users this panel serves.
    const activeKey = root.contains(active) ? (active.dataset?.vaKey || null) : null;
    const activeText = root.contains(active) ? active.textContent : null;
    const typing = root.contains(active) && active.tagName === 'INPUT'
      ? { value: active.value, start: active.selectionStart, end: active.selectionEnd }
      : null;
    const scroll = root.scrollTop;

    root.textContent = '';
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
      const b = el('button', 'va-do', 'Answer');
      b.dataset.vaKey = `gap:${g.field}`;
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
      // until this is answered - and only when the hold is new, so re-renders
      // while the person reads elsewhere do not keep dragging them back.
      const gateKey = (state.gate.waitingOn || []).join('|') + (state.gate.say || '');
      if (gateKey !== focusedGate) {
        focusedGate = gateKey;
        requestAnimationFrame(() => gate.querySelector('.va-do')?.focus());
      }
    }

    // ── findings ────────────────────────────────────────────────────────────
    // The finding the gate is holding for renders in the gate block above,
    // with the gate's own answers - listing it again below gave the same
    // question two different button rows. One question, one place.
    const heldNow = new Set(
      (state.gate && state.gate.allowed === false && state.gate.waitingOn) || []);
    const findings = (state.findings || [])
      .filter((f) => f.level !== 'ambient' || f.confirming)
      .filter((f) => !heldNow.has(f.widget));
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
          b.dataset.vaKey = `do:${f.widget}`;
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
      `${n} said aloud, ${state.spokenWords || 0} words`));
    const more = el('button', null, 'What else did you check?');
    more.addEventListener('click', () => onControl?.({ action: 'on-request' }));
    foot.append(more);
    root.append(foot);

    // ── restore what the rebuild would otherwise have taken ────────────────
    for (const sum of root.querySelectorAll('details > summary')) {
      if (openKeys.includes(sum.textContent)) sum.parentElement.open = true;
    }
    if (typing) {
      const input = root.querySelector('input');
      if (input) {
        input.value = typing.value;
        input.focus();
        try { input.setSelectionRange(typing.start, typing.end); } catch { /* number inputs */ }
      }
    } else if (activeKey || activeText) {
      const byKey = activeKey
        ? root.querySelector(`[data-va-key="${CSS.escape(activeKey)}"]`)
        : null;
      if (byKey) byKey.focus();
      else if (activeText) {
        for (const b of root.querySelectorAll('button')) {
          if (b.textContent === activeText) { b.focus(); break; }
        }
      }
    }
    root.scrollTop = scroll;
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
      onControl?.({ action: 'start', said });
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
    if (/count|result|loose|alarm/.test(w)) {
      return [['Narrow it down', 'narrow it down', true], ['Keep them all', 'keep them all', false]];
    }
    if (/photo/.test(w)) {
      return [['Describe the photos', 'describe the photos', true], ['Skip it', 'skip', false]];
    }
    if (/total|price|cost/.test(w)) {
      return [['Check it with me', 'read it to me first', true], ['Go ahead', 'go ahead', false]];
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
