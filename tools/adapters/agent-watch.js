// Agent Watch — shows, on the page itself, what an agent is doing on your
// behalf and where it stopped matching what you asked for.
//
// Every other adapter here adapts a page for a person who is looking at it.
// This one is for a person who is NOT looking at it, because they handed the
// task to something else. That inverts what the surface is for. It is not
// describing the page; it is reporting on a delegate.
//
// Three rules follow from that, and they are why this looks unlike the rest:
//
//   Quiet unless something is wrong. Delegation is supposed to save attention,
//   so a surface that narrates every step spends the thing it was meant to
//   save. Findings sit collapsed behind a count until one of them stops the
//   agent.
//
//   Say where it came from. Every finding carries the page's own words, so a
//   claim can be traced back rather than believed. An agent's summary is the
//   one source we cannot use to check an agent's summary.
//
//   Hand back the control, not just the news. What delegation removes is the
//   doing — re-sort, open a different one, change the size. A finding with no
//   control is bad news delivered on time.
//
// Reversible by construction, like every adapter here: one injected container
// and one injected stylesheet, both removed on disable(). It never touches the
// page's own DOM, which also means it cannot break the page it is reporting on.
//
// Pairs with the `contract-mismatch` auditor, which produces the findings.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';
import { renderShape, shapeCss, setActionHandler } from './agent-watch-shapes.js';
import { livingPlan, livingPrompt, rulebook, surfaceCss } from './agent-watch-surfaces.js';

const STYLE_ID = 'ai4a11y-agent-watch-style';

// Neutral defaults, used when no AbilityModel is supplied. Matches
// emptyAbilityModel() in toolkit/core/ability-model.js — the fields this
// surface can actually honour, and no others.
const NEUTRAL = {
  text: { size: 1.0 },
  vision: { contrast: 'standard', descriptions: false },
  motion: 'standard',
  audio: { speechRate: 1.0 },
  input: { keyboard: false },
  cognition: { simplify: false, summarize: false, progressCues: null },
};

const merge = (m) => ({
  text: { ...NEUTRAL.text, ...(m?.text || {}) },
  vision: { ...NEUTRAL.vision, ...(m?.vision || {}) },
  motion: m?.motion || NEUTRAL.motion,
  audio: { ...NEUTRAL.audio, ...(m?.audio || {}) },
  input: { ...NEUTRAL.input, ...(m?.input || {}) },
  cognition: { ...NEUTRAL.cognition, ...(m?.cognition || {}) },
});

export const AgentWatch = {
  containerId: 'ai4a11y-agent-watch',
  enabled: false,
  model: null,        // the person's AbilityModel, as merged above
  state: null,        // last published run state
  root: null,
  styleHandle: null,
  spoken: null,       // what has already been said, so nothing repeats
  settled: null,      // findings the person has answered or waved past
  openSurfaces: null, // which of the three the person has opened
  collapsed: false,  // open by default; only the person collapses it

  /**
   * @param {object} [options]
   * @param {object} [options.model]  AbilityModel — drives every rendering
   *                                  choice below. Omitted means neutral.
   * @param {object} [options.state]  initial run state, if one is in progress
   */
  enable(options = {}) {
    if (this.enabled) return;
    if (typeof document === 'undefined') return false;
    this.enabled = true;
    this.model = merge(options.model);
    this.spoken = new Set();
    this.settled = new Set();
    this.openSurfaces = new Set(['plan', 'prompt', 'rules']);
    this.collapsed = false;

    // Presses inside a shape are controls like any other — they go back to
    // whoever owns the run, not into a private path here.
    setActionHandler((a) => this.onControl?.({ ...a, fromShape: true }));

    this.styleHandle = injectStyle(STYLE_ID, css(this.model));

    const box = document.createElement('section');
    box.id = this.containerId;
    // Invisible to the agent, in every sense it can perceive.
    //
    // The agent enumerates the page and clicks by index, and this surface is
    // in that page. In a recorded run it spent ten steps trying to dismiss
    // "the helper overlay" to reach Amazon's buy box underneath, pressed our
    // own "Got it" and "Leave it" — which would have marked the person's
    // findings as dealt with — and at one point missed and clicked a size
    // radio instead. The layer that exists to check the agent was corrupting
    // the run and answering on the person's behalf.
    //
    // data-bh-ignore is the harness's own opt-out; the other two are for any
    // enumeration that walks the accessibility tree or the DOM instead.
    box.setAttribute('data-bh-ignore', 'true');
    box.setAttribute('data-ai4a11y-ui', 'true');
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label', 'What the agent is doing');
    // Polite: the agent working is not an emergency. The one thing that IS
    // urgent — a held gate — sets assertive on its own region below.
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
    this.root = box;

    if (options.state) this.update(options.state);
    else this.render();
    return true;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.root?.remove();
    this.root = null;
    this.styleHandle?.remove();
    this.styleHandle = null;
    this.state = null;
    this.spoken = null;
    this.settled = null;
  },

  /** New findings from the run. Re-renders, and speaks anything that must be. */
  update(state) {
    if (!this.enabled) return;
    this.state = state || null;
    for (const k of state?.acknowledged || []) this.settled.add(k);
    // Never auto-collapse. An earlier version folded the surface on pages
    // with nothing to check, and since phase is empty during every
    // navigation settle, the panel folded itself constantly. Everything
    // stays expanded; only the person collapses it, and only by choice.
    // A held agent is the one thing that opens the panel by itself, because
    // the task cannot continue until it is answered.
    if (state?.gate && state.gate.allowed === false) this.collapsed = false;
    this.render();
    this.speak();
  },

  /**
   * Announce what has to be heard, once each.
   *
   * Routed through announce() rather than a private speech path so this shares
   * one voice with every other adapter — two announcers in one page talk over
   * each other, and the screen reader user loses both.
   */
  speak() {
    const s = this.state;
    if (!s) return;
    const m = this.model;

    if (s.gate && s.gate.allowed === false && s.gate.say && !this.spoken.has('gate:' + s.gate.say)) {
      this.spoken.add('gate:' + s.gate.say);
      announce(s.gate.say);
      return;                       // the gate is the only thing worth hearing now
    }

    for (const f of visible(s, m)) {
      // Ambient findings are never spoken. They stay reachable on request,
      // which is the difference between available and announced.
      if (f.level === 'ambient') continue;
      const key = `${f.widget}|${f.say}`;
      if (this.spoken.has(key)) continue;
      this.spoken.add(key);
      announce(phrase(f, m));
    }
  },

  render() {
    if (!this.root) return;
    const s = this.state;
    const m = this.model;

    // The rebuild must not cost the person the box they are typing into or
    // their place in the panel. bhAgent writes several log entries per step,
    // and each one re-renders - without this, half-typed instructions were
    // erased within seconds. Same treatment panel.js already has.
    const prevField = this.root.querySelector('.aw-tell-input');
    const keepText = prevField ? prevField.value : '';
    const wasTyping = prevField && document.activeElement === prevField
      ? { start: prevField.selectionStart, end: prevField.selectionEnd }
      : null;
    const keepScroll = this.root.scrollTop;
    const restore = () => {
      const nf = this.root.querySelector('.aw-tell-input');
      if (nf && keepText) nf.value = keepText;
      if (nf && wasTyping) {
        nf.focus();
        try { nf.setSelectionRange(wasTyping.start, wasTyping.end); } catch { /* fine */ }
      }
      this.root.scrollTop = keepScroll;
    };
    this.root.textContent = '';

    if (!s || !s.contract) {
      this.root.classList.add('aw-idle');
      return;
    }
    this.root.classList.remove('aw-idle');

    // Newest page first.
    //
    // Findings persist across pages on purpose — a Search finding is still
    // true at Review order, and dropping it would make this a view of the
    // current page rather than of the task. But leaving them in arrival order
    // puts "70 products on this page" at the top while someone is looking at
    // their cart, which reads as though the layer has not noticed where they
    // are. What persists and what leads are different questions.
    const shown = byPhase(visible(s, m), s.phase);
    const queueLength = shown.filter((f) => !this.settled.has(keyOf(f))).length;
    // Counted from everything checked, NOT from what this person is shown.
    //
    // Asking for summaries hides findings from the list, and if the header
    // counted the list too, someone who asked for less would be told nothing
    // was checked. "Quieter" must never become "silent": what changes is how
    // much detail is listed, never whether the work is accounted for.
    const all = (s.findings || []).filter((f) => f.level !== 'ambient' || f.confirming);
    const stops = all.filter((f) => f.level === 'stop');
    const held = s.gate && s.gate.allowed === false;

    // ── the header: always the same one line ────────────────────────────────
    const head = document.createElement('button');
    head.className = 'aw-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!this.collapsed));
    // The headline is the agent's state - what the person handed the task to
    // is the thing they want one glance to answer for. The detail line below
    // carries the full step, so the head keeps just the short verb. Held
    // outranks everything: a waiting agent IS the agent's state.
    const ag = this.agent;
    const agentLine = ag?.status === 'running'
      ? `The agent is ${ag.verb
          || (ag.doing || 'working').split(' (')[0].replace(/^(\S+(?:\s\S+){0,3}).*/, '$1')}`
      : ag?.status === 'done' ? 'The agent says it’s done'
      : ag?.status === 'stopped' ? 'The agent stopped'
      : ag && ag.status && ag.status !== 'idle' ? 'The agent hit a problem'
      : null;
    head.textContent = held
      ? (s.gate?.unread
          ? `Waiting for you, ${s.gate.unread} unread`
          : 'Waiting for you')
      : agentLine
      || (!s.phase
        // Only when there is genuinely nothing in front of them. Saying
        // "nothing to check here" above a finding is the panel contradicting
        // itself in two adjacent lines.
        ? (queueLength ? `${queueLength} to look at, from earlier`
                       : `Nothing to check here, ${all.length} checked so far`)
      : stops.length
        ? `${stops.length} thing${stops.length === 1 ? '' : 's'} to look at`
        : all.length
          ? `Checked ${all.length} thing${all.length === 1 ? '' : 's'}`
          : 'Checking as it goes');
    head.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });
    this.root.appendChild(head);

    if (held) this.root.classList.add('aw-held');
    else this.root.classList.remove('aw-held');

    // ── say something to it, at any time ────────────────────────────────────
    //
    // The controls beside a finding cover the moves the analysis names —
    // re-sort, open a different one, change the size. They cannot cover
    // "actually she likes purple" or "skip anything from that seller", and a
    // person watching a delegate work will always have something to say that
    // nobody enumerated in advance.
    //
    // Without this the only way to redirect a run was to stop it and start
    // again, which throws away everything checked so far. It sits at the
    // bottom, always, whatever else the surface is showing.
    const tell = document.createElement('form');
    tell.className = 'aw-tell';
    const tellId = `${this.containerId}-tell`;
    const lab = document.createElement('label');
    lab.className = 'aw-tell-label';
    lab.setAttribute('for', tellId);
    lab.textContent = 'Tell the agent something';
    const field = document.createElement('input');
    field.id = tellId;
    field.type = 'text';
    field.className = 'aw-tell-input';
    field.placeholder = 'she likes purple, skip that seller, slow down';
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'aw-do';
    send.textContent = 'Send';
    tell.append(lab, field, send);

    const note = document.createElement('p');
    note.className = 'aw-tell-said';
    note.setAttribute('role', 'status');      // announced without stealing focus
    if (this.lastTold) note.textContent = `Told the agent: ${this.lastTold}`;
    tell.appendChild(note);

    // The subtitle under the headline. The head names the agent and the
    // verb; this carries the full step, so it does not repeat the subject.
    // When there is nothing to add, it is not rendered.
    const doing = document.createElement('p');
    doing.className = 'aw-doing';
    doing.setAttribute('role', 'status');
    const a = this.agent;
    doing.textContent = !a || a.status === 'idle'
      ? 'Nothing is running. You’re browsing, and I’m checking as you go.'
      : a.status === 'running'
        // The step number is the person's handle on progress; the sentence is
        // the agent's own reason, already said plainly by the host.
        ? (a.doing ? `${a.step ? `Step ${a.step}: ` : ''}${a.doing}` : '')
        : a.status === 'done' ? (a.summary || '')
        : a.status === 'stopped' ? ''
        : String(a.status);

    tell.addEventListener('submit', (e) => {
      e.preventDefault();
      const said = field.value.trim();
      if (!said) return;
      field.value = '';
      this.lastTold = said;
      this.onTell?.(said);
      // Said back immediately. An instruction is applied before the agent's
      // next action, which can be seconds away, and silence in between reads
      // as the message having gone nowhere.
      note.textContent = `Told the agent: ${said}`;
    });

    // ── the footer: counts on the left, the way out on the right ────────────
    //
    // A task has to be endable. Without this the only ways out were closing
    // the tab or letting the agent decide it had finished — and the agent
    // deciding is exactly the judgement this layer exists not to take on
    // trust. Ending is the person's call, and it stops the agent too.
    const foot = document.createElement('div');
    foot.className = 'aw-foot';
    // Progress cues are a preference with a real split: some people want to
    // know how much was checked, and for others a running tally is one more
    // thing demanding attention. `null` means no signal either way, so it is
    // shown — the count is the cheapest evidence that checking happened.
    if (m.cognition.progressCues !== false && !m.cognition.summarize) {
      const tally = document.createElement('span');
      const n = (s.said || []).length;
      tally.textContent = `${n} said aloud, ${s.spokenWords || 0} words`;
      foot.appendChild(tally);
    }
    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'aw-do aw-end';
    // "That's it, I'm done" reads as "I've finished telling you things" —
    // which is what a person is doing most of the time they look at this
    // panel. It ended the whole task instead. The label has to name the
    // consequence, not the mood.
    end.textContent = 'End this task';
    end.setAttribute('aria-label', 'End this task and stop the agent');
    end.addEventListener('click', () => this.onDone?.());
    foot.appendChild(end);

    // What is happening right now sits with the title, not inside the input
    // box - it is status, and the input is for talking back.
    if (doing.textContent) this.root.appendChild(doing);

    // The agent asked and offered choices - so the choices are buttons,
    // right under its question. Pressing one continues the task; the tell
    // box below stays the free-text way to answer differently.
    if (a?.status === 'done' && Array.isArray(a.options) && a.options.length) {
      const asks = document.createElement('div');
      asks.className = 'aw-row aw-asks';
      for (const opt of a.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aw-do';
        b.textContent = opt.length > 42 ? `${opt.slice(0, 39)}…` : opt;
        b.title = opt;
        b.setAttribute('aria-label', `Go with ${opt}`);
        b.addEventListener('click', () => {
          this.lastTold = opt;
          this.onTell?.(`Go with "${opt}". Do that now.`);
          this.render();
        });
        asks.appendChild(b);
      }
      this.root.appendChild(asks);
    }

    // Collapsed keeps the status and the two controls that must never be more
    // than one press away: the input and the way out.
    if (this.collapsed && !held) {
      this.root.appendChild(tell);
      this.root.appendChild(foot);
      restore();
      return;
    }

    // ── the gate ────────────────────────────────────────────────────────────
    if (held) {
      const g = document.createElement('div');
      g.className = 'aw-gate';
      g.setAttribute('role', 'alertdialog');
      g.setAttribute('aria-live', 'assertive');
      g.setAttribute('aria-label', 'Waiting for you');

      const p = document.createElement('p');
      p.textContent = s.gate.say || 'Something needs your decision.';
      g.appendChild(p);

      const row = document.createElement('div');
      row.className = 'aw-row';
      for (const [label, response, primary] of choices(s)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aw-do' + (primary ? ' aw-primary' : '');
        b.textContent = label;
        b.addEventListener('click', () => this.onAnswer?.(
          (s.gate.waitingOn || [])[0], response));
        row.appendChild(b);
      }
      g.appendChild(row);
      this.root.appendChild(g);
      // The only place focus moves on its own — the run cannot proceed
      // without an answer, so landing here saves hunting for it.
      const gateKey = (s.gate?.waitingOn || []).join('|') + (s.gate?.say || '');
      if (gateKey !== this._focusedGate) {
        this._focusedGate = gateKey;
        requestAnimationFrame(() => g.querySelector('.aw-do')?.focus());
      }
    }

    // ── the probe card: measured options, waiting for a pick ────────────────
    if (s.probe) {
      const pr = document.createElement('div');
      pr.className = 'aw-probe';
      pr.setAttribute('role', 'group');
      pr.setAttribute('aria-label', 'Narrower searches, measured');
      const q = document.createElement('p');
      q.className = 'aw-text';
      q.textContent = s.probe.ask || 'Pick one.';
      pr.appendChild(q);
      const row = document.createElement('div');
      row.className = 'aw-row';
      for (const o of s.probe.options || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aw-do';
        // The count is the point: it is read off the page, not estimated.
        b.textContent = o.count ? `${o.query} (${o.count} results)` : `${o.query} (count unreadable)`;
        b.addEventListener('click', () =>
          this.onControl?.({ action: 'probe-pick', query: o.query }));
        row.appendChild(b);
      }
      if ((s.probe.options || []).length) {
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'aw-do';
        keep.textContent = 'Keep the current search';
        keep.addEventListener('click', () => this.onControl?.({ action: 'probe-pick' }));
        row.appendChild(keep);
      }
      pr.appendChild(row);
      this.root.appendChild(pr);
    }

    // ── one thing at a time ─────────────────────────────────────────────────
    //
    // Not a list. A list of eleven findings is a dashboard, and a dashboard is
    // the wrong shape here in two separate ways.
    //
    // On a linear channel it is unusable: eleven items read aloud is a memory
    // test, and the corpus is explicit that facing "what would you like to
    // do?" after a long readback is the hardest moment in the task. But it is
    // wrong for someone who can see the page too, because each finding carries
    // a CONTROL — re-sort, open a different one, change the size — and acting
    // on one changes the page the others were about. Showing them together
    // implies they can be judged together, and they cannot.
    //
    // So: the most decisive unresolved finding, with its control, and a count
    // of what is behind it. Answer or wave it past, and the next arrives.
    // Nothing is hidden; it is queued.
    const heldNow = new Set((held && s.gate.waitingOn) || []);
    const queue = shown.filter((f) => !this.settled.has(keyOf(f)) && !heldNow.has(f.widget));
    if (!queue.length) {
      const note = document.createElement('p');
      note.className = 'aw-none';
      note.textContent = all.length
        ? (shown.length ? `All ${shown.length} looked at.`
                        : `Nothing needs you. ${all.length} checked so far.`)
        : 'Nothing to flag yet.';
      this.root.appendChild(note);
    } else {
      const f = queue[0];
      const li = document.createElement('div');
      li.className = `aw-item aw-one aw-${f.confirming ? 'ok' : f.level}`;

      const t = document.createElement('p');
      t.className = 'aw-text';
      t.textContent = phrase(f, m);
      li.appendChild(t);

      if (!m.cognition.summarize) {
        const shape = renderShape(f);
        if (shape) li.appendChild(shape);
      }
      if (f.from && !m.cognition.simplify) {
        const w = document.createElement('p');
        w.className = 'aw-from';
        w.textContent = f.from;
        li.appendChild(w);
      }

      const row = document.createElement('div');
      row.className = 'aw-row';
      if (f.control) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aw-do aw-primary';
        b.textContent = f.control.label;
        b.addEventListener('click', () => {
          this.settled.add(keyOf(f));
          // Control first, so the instruction is queued for the agent before
          // the acknowledge releases the hold - then acknowledge, because
          // acting on a finding IS dealing with it. Without the acknowledge
          // the session still counted it unread and kept the agent held, so
          // the very instruction this press just sent could never run.
          this.onControl?.(f.control);
          this.onAcknowledge?.(keyOf(f));
          this.render();
        });
        row.appendChild(b);
      }
      // Waving something past is a real answer, not a dismissal: it is how
      // someone says "understood, carry on" without the layer treating silence
      // as agreement.
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'aw-do';
      skip.textContent = f.control ? (f.control.decline || 'Leave it') : 'Got it';
      skip.addEventListener('click', () => {
        this.settled.add(keyOf(f));
        this.onAcknowledge?.(keyOf(f));
        this.render();
      });
      row.appendChild(skip);
      li.appendChild(row);

      if (queue.length > 1) {
        const more = document.createElement('p');
        more.className = 'aw-queue';
        more.textContent = `${queue.length - 1} more after this.`;
        li.appendChild(more);
      }
      this.root.appendChild(li);
      // Focus follows the queue, so answering does not send a keyboard or
      // screen-reader user back to the top of the panel each time.
      if (this.settled.size) {
        const oneKey = keyOf(f);
        if (oneKey !== this._focusedOne) {
          this._focusedOne = oneKey;
          requestAnimationFrame(() => li.querySelector('.aw-do')?.focus());
        }
      }
    }

    // ── the three surfaces, behind a disclosure ─────────────────────────────
    //
    // What is true right now, what is true for this task, what is true across
    // every task. They persist so that an utterance is never the only copy of
    // something — 17 of the recorded breakdowns are things said once and
    // unreachable afterwards, and that is what these exist to end.
    //
    // But persisting and being displayed are different questions. Shown by
    // default they bury the one thing that actually needs answering under a
    // history of what already happened, which is how this surface turned into
    // a dashboard.
    const nRules = (s.rules || []).length;

    // Each surface remembers whether it is open: the panel rebuilds on every
    // storage write, and a section that closes itself whenever a finding
    // lands cannot be read at all while a task is running.
    const remember = (node, key) => {
      if (!node) return node;
      node.open = this.openSurfaces.has(key) || node.open;
      node.addEventListener('toggle', () => {
        if (node.open) this.openSurfaces.add(key);
        else this.openSurfaces.delete(key);
      });
      return node;
    };

    const plan = remember(livingPlan(s.steps, { compact: m.cognition.summarize }), 'plan');
    if (plan) this.root.appendChild(plan);

    const prompt = remember(livingPrompt(s.contract, {
      invalidated: s.invalidated || [],
      onEdit: (field, value) => this.onEditAsk?.(field, value),
    }), 'prompt');
    if (prompt) this.root.appendChild(prompt);

    if (nRules || s.offer) {
      this.root.appendChild(remember(rulebook(s.rules || [], {
        offer: s.offer,
        onPromote: (o, always) => this.onPromote?.(o, always),
        onToggle: (r) => this.onToggleRule?.(r),
      }), 'rules'));
    }

    this.root.appendChild(tell);
    this.root.appendChild(foot);
    restore();
  },

  /** Set by the host: what to do when a control or a gate answer is clicked. */
  onControl: null,
  onAnswer: null,
  onAcknowledge: null,   // the person dealt with a finding; the agent may move on
  onTell: null,          // free text, straight to the agent, at any time
  onDone: null,          // the person says the task is finished
  lastTold: null,
  agent: null,           // {status, step, doing} — what the delegate is up to

  /** What the agent is doing, so the person is not talking into silence. */
  setAgent(a) {
    this.agent = a || null;
    if (this.enabled) this.render();
  },
  onEditAsk: null,      // a field of the Living Prompt was changed
  onPromote: null,      // an offered rule was accepted or declined
  onToggleRule: null,   // a standing rule was switched off or on
};

// ── what the person actually sees ───────────────────────────────────────────

/**
 * Which findings to show, given who is looking.
 *
 * `summarize` is the sharp one: it drops everything that is not a stop. That
 * is a real loss of information, and it is the right trade for someone who
 * asked for less — an unread list of twelve is worth less than a read list of
 * two.
 */
/**
 * The current page's findings first, everything earlier after it.
 *
 * Stable within each group, so the order a page produced them in — which is
 * the order the checks ran, roughly most-decisive first — survives.
 */
function byPhase(findings, current) {
  const key = (f) => [
    current && f.phase === current ? 0 : 1,   // this page before earlier ones
    URGENCY[f.level] ?? 3,                    // a held agent before anything advisory
    f.control ? 0 : 1,                        // actionable before informational
  ];
  return findings.slice().sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

/** What identifies one finding across re-renders. */
const keyOf = (f) => `${f.widget}|${f.phase}|${f.say}`;

const URGENCY = { stop: 0, aside: 1, ambient: 2 };

function visible(s, m) {
  let out = (s.findings || []).filter((f) => f.level !== 'ambient' || f.confirming);
  if (m.cognition.summarize) out = out.filter((f) => f.level === 'stop');
  return out;
}

/**
 * The wording, adapted.
 *
 * Plain language is not a shorter version of the same sentence — it is the
 * same claim with the subordinate clause removed. So this cuts at the first
 * sentence boundary rather than truncating, which would leave a fragment.
 */
function phrase(f, m) {
  const say = String(f.say || '');
  if (!m.cognition.simplify) return say;
  const first = say.match(/^[^.!?]+[.!?]/);
  return first ? first[0] : say;
}

/**
 * Answers offered at a gate.
 *
 * Taken from the control the held finding already carries, not from a table of
 * phrasings kept here. Those controls come from the analysis — they are the
 * actions delegation took away, named there — so a hand-written map in this
 * file is the same wording maintained in two places, drifting apart. It also
 * could not keep up: it matched on the widget's name, so a widget the analysis
 * renamed silently fell through to a generic yes/no.
 *
 * The second option is always to stop, because that is the one answer no
 * finding has to supply: a gate you cannot decline is not a checkpoint.
 */
function choices(s) {
  const waiting = new Set(s.gate?.waitingOn || []);
  const held = (s.findings || []).find((f) => waiting.has(f.widget) && f.control?.label);
  return held
    ? [[held.control.label, held.control.label, true], ['Stop here', 'stop', false]]
    : [['Go on', 'go on', true], ['Stop here', 'stop', false]];
}

// ── the stylesheet, built from the model ────────────────────────────────────
//
// Generated rather than static because the values that matter here come from
// the person: type scale, contrast, whether anything is allowed to move. A
// fixed stylesheet plus overrides would mean the neutral case is the only one
// that was actually designed.
function css(m) {
  const base = 14 * (m.text.size || 1);
  const high = m.vision.contrast === 'high';
  const fg = high ? '#000' : '#1d1d1f';
  const bg = high ? '#fff' : '#fff';
  const line = high ? '#000' : '#e5e5e7';
  const muted = high ? '#000' : '#6b7280';
  // Someone who relies on descriptions is not reading this box — the spoken
  // channel is their channel. It stays in the DOM for the screen reader and
  // stops competing for space it is not being read in.
  const width = m.vision.descriptions ? 300 : 360;

  return `
#${AgentWatch.containerId} {
  /* Bottom-right, not top-right.
     Top-right is where a shop puts the thing you are trying to reach — on a
     product page that is the buy box, price and Add to Cart. Sitting on top of
     it made the surface an obstacle for a sighted person and a trap for the
     agent. */
  position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
  width: ${width}px; max-height: 62vh; overflow-y: auto;
  background: ${bg}; color: ${fg};
  border: ${high ? '3px solid #000' : '1px solid #d1d5db'};
  border-radius: 10px;
  box-shadow: ${high ? 'none' : '0 6px 28px rgba(0,0,0,.14)'};
  font: ${base}px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  ${m.motion === 'reduced' ? '' : 'transition: box-shadow .18s ease;'}
}
#${AgentWatch.containerId}.aw-idle { display: none; }
#${AgentWatch.containerId}.aw-held { border-color: ${high ? '#000' : '#991b1b'}; }

#${AgentWatch.containerId} .aw-head {
  display: block; width: 100%; text-align: left;
  padding: 11px 14px; border: 0; border-bottom: 1px solid ${line};
  background: none; color: inherit; font: inherit; font-weight: 600;
  cursor: pointer; border-radius: 10px 10px 0 0;
}
#${AgentWatch.containerId} .aw-head:focus-visible { outline: 3px solid #1a73e8; outline-offset: -3px; }

#${AgentWatch.containerId} .aw-gate {
  margin: 12px 14px; padding: 12px;
  border: 1px solid ${high ? '#000' : '#fca5a5'}; border-radius: 8px;
  background: ${high ? '#fff' : '#fee2e2'};
}
#${AgentWatch.containerId} .aw-gate p { margin: 0 0 10px; font-weight: 500; }
#${AgentWatch.containerId} .aw-row { display: flex; gap: 8px; flex-wrap: wrap; }

#${AgentWatch.containerId} .aw-list { list-style: none; margin: 0; padding: 4px 0; }
#${AgentWatch.containerId} .aw-item {
  /* The marker gutter scales with the type. Fixed at 26px it collides with
     the text as soon as anyone turns the size up, which is precisely the
     person this adapter is scaling for. */
  padding: 9px 14px 9px ${Math.round(base * 1.85)}px; position: relative;
}
#${AgentWatch.containerId} .aw-item + .aw-item { border-top: 1px solid ${line}; }

/* One at a time: the single open question gets the room a list would have
   spent on nine others, so it can carry its shape and its control unhurried. */
#${AgentWatch.containerId} .aw-one { padding: 12px 14px 14px ${Math.round(base * 1.85)}px; }
#${AgentWatch.containerId} .aw-one .aw-row { margin-top: 11px; }
#${AgentWatch.containerId} .aw-queue {
  margin: 10px 0 0; font-size: ${Math.round(base * 0.78)}px; color: ${muted};
}

/* Never colour alone: each level carries its own mark, so the distinction
   survives any colour vision and any high-contrast mode that flattens hue. */
#${AgentWatch.containerId} .aw-item::before {
  position: absolute; left: ${Math.round(base * 0.78)}px; top: 9px; font-weight: 700;
}
#${AgentWatch.containerId} .aw-ok::before     { content: "✓"; color: ${high ? '#000' : '#059669'}; }
#${AgentWatch.containerId} .aw-aside::before  { content: "!"; color: ${high ? '#000' : '#b45309'}; }
#${AgentWatch.containerId} .aw-stop::before   { content: "■"; color: ${high ? '#000' : '#991b1b'}; }
#${AgentWatch.containerId} .aw-ambient::before{ content: "·"; color: ${muted}; }

#${AgentWatch.containerId} .aw-text { margin: 0; }
#${AgentWatch.containerId} .aw-from {
  margin: 3px 0 0; font-size: ${Math.round(base * 0.78)}px; color: ${muted};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${AgentWatch.containerId} .aw-do {
  margin-top: 7px; font: inherit; font-size: ${Math.round(base * 0.86)}px;
  padding: 5px 12px; border: 1px solid ${high ? '#000' : '#d1d5db'};
  border-radius: 6px; background: ${bg}; color: ${fg}; cursor: pointer;
}
#${AgentWatch.containerId} .aw-row .aw-do { margin-top: 0; }
#${AgentWatch.containerId} .aw-do:hover { background: ${high ? '#eee' : '#f3f4f6'}; }
#${AgentWatch.containerId} .aw-do:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
#${AgentWatch.containerId} .aw-primary {
  background: ${high ? '#000' : '#1a73e8'}; border-color: ${high ? '#000' : '#1a73e8'}; color: #fff;
}
#${AgentWatch.containerId} .aw-primary:hover { background: ${high ? '#000' : '#1858b8'}; }
#${AgentWatch.containerId} .aw-none {
  margin: 0; padding: 14px; color: ${muted};
}
/* Tell the agent something — always there, whatever else is on screen. */
#${AgentWatch.containerId} .aw-tell {
  display: grid; grid-template-columns: 1fr auto; gap: 7px;
  padding: 10px 14px; border-top: 1px solid ${line};
}
#${AgentWatch.containerId} .aw-tell-label {
  grid-column: 1 / -1; font-size: ${Math.round(base * 0.78)}px;
  text-transform: uppercase; letter-spacing: .5px; color: ${muted};
}
#${AgentWatch.containerId} .aw-tell-input {
  font: inherit; min-width: 0; padding: 6px 11px;
  border: 1px solid ${high ? '#000' : '#d1d5db'}; border-radius: 6px;
  background: ${bg}; color: ${fg};
}
#${AgentWatch.containerId} .aw-tell-input:focus-visible { outline: 3px solid #1a73e8; outline-offset: 1px; }
#${AgentWatch.containerId} .aw-tell .aw-do { margin-top: 0; }
#${AgentWatch.containerId} .aw-probe {
  margin: 10px 14px; padding: 10px 12px;
  border: 1px solid ${line}; border-radius: 8px;
}
#${AgentWatch.containerId} .aw-probe .aw-row { margin-top: 8px; }
#${AgentWatch.containerId} .aw-asks { padding: 0 14px 10px; }
#${AgentWatch.containerId} .aw-asks .aw-do { margin-top: 0; }
#${AgentWatch.containerId} .aw-doing {
  margin: 0; padding: 8px 14px 10px;
  font-size: ${Math.round(base * 0.86)}px; color: ${fg};
}
#${AgentWatch.containerId} .aw-end { margin: 0 0 0 auto; flex: 0 0 auto; }
#${AgentWatch.containerId} .aw-tell-said {
  grid-column: 1 / -1; margin: 0; font-size: ${Math.round(base * 0.78)}px; color: ${muted};
}

#${AgentWatch.containerId} .aw-foot {
  margin: 0; padding: 8px 14px; border-top: 1px solid ${line};
  font-size: ${Math.round(base * 0.78)}px; color: ${muted};
  display: flex; align-items: center; gap: 10px;
}
#${AgentWatch.containerId} .aw-foot .aw-do { margin-top: 0; }
@media (prefers-reduced-motion: reduce) {
  #${AgentWatch.containerId} { transition: none; }
}
${shapeCss(AgentWatch.containerId, base, muted, line, high, bg)}
${surfaceCss(AgentWatch.containerId, base, muted, line, high)}
`;
}
