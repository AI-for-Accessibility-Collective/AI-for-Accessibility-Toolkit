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
import { renderShape, shapeCss } from './agent-watch-shapes.js';
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
  collapsed: true,

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
    this.collapsed = true;

    this.styleHandle = injectStyle(STYLE_ID, css(this.model));

    const box = document.createElement('section');
    box.id = this.containerId;
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label', 'What the assistant is doing');
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
  },

  /** New findings from the run. Re-renders, and speaks anything that must be. */
  update(state) {
    if (!this.enabled) return;
    const wasPhase = this.state?.phase;
    this.state = state || null;
    // Landing somewhere with nothing to check — a sign-in wall, a help page —
    // folds the surface back up. The task's findings are still there and one
    // press away; what changes is that they stop being presented as though
    // they were about the page in front of you.
    if (state && !state.phase && wasPhase !== state.phase) this.collapsed = true;
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
    head.textContent = held
      ? 'Waiting for you'
      : !s.phase
        ? `Nothing to check here · ${all.length} from this task`
      : stops.length
        ? `${stops.length} thing${stops.length === 1 ? '' : 's'} to look at`
        : all.length
          ? `Checked ${all.length} thing${all.length === 1 ? '' : 's'}`
          : 'Checking as it goes';
    head.addEventListener('click', () => { this.collapsed = !this.collapsed; this.render(); });
    this.root.appendChild(head);

    if (held) this.root.classList.add('aw-held');
    else this.root.classList.remove('aw-held');

    if (this.collapsed && !held) return;

    // ── the gate ────────────────────────────────────────────────────────────
    if (held) {
      const g = document.createElement('div');
      g.className = 'aw-gate';
      g.setAttribute('role', 'alertdialog');
      g.setAttribute('aria-live', 'assertive');
      g.setAttribute('aria-label', 'The assistant is waiting for you');

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
      requestAnimationFrame(() => g.querySelector('.aw-do')?.focus());
    }

    // ── the findings ────────────────────────────────────────────────────────
    //
    // An empty list has two very different causes, and collapsing them would
    // be the exact confusion this layer exists to remove: nothing checked yet,
    // versus checked and nothing needs you. Say which.
    if (!shown.length) {
      const note = document.createElement('p');
      note.className = 'aw-none';
      note.textContent = all.length
        ? `Nothing needs you. ${all.length} thing${all.length === 1 ? '' : 's'} checked so far.`
        : 'Nothing to flag yet.';
      this.root.appendChild(note);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'aw-list';
    for (const f of shown) {
      const li = document.createElement('li');
      li.className = `aw-item aw-${f.confirming ? 'ok' : f.level}`;

      const t = document.createElement('p');
      t.className = 'aw-text';
      t.textContent = phrase(f, m);
      li.appendChild(t);

      // The shape carries the judgment the sentence leaves to the reader.
      // Someone who asked for summaries is asking for less to take in, so the
      // geometry goes and the sentence stays — it is the sentence that holds
      // the claim.
      if (!m.cognition.summarize) {
        const shape = renderShape(f);
        if (shape) li.appendChild(shape);
      }

      // Provenance is the page's own words. Dropped only when someone has
      // asked for simpler content, where a second line of raw page text costs
      // more than the traceability buys.
      if (f.from && !m.cognition.simplify) {
        const w = document.createElement('p');
        w.className = 'aw-from';
        w.textContent = f.from;
        li.appendChild(w);
      }

      if (f.control) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aw-do';
        b.textContent = f.control.label;
        b.addEventListener('click', () => this.onControl?.(f.control));
        li.appendChild(b);
      }
      list.appendChild(li);
    }
    this.root.appendChild(list);

    // ── the three surfaces ──────────────────────────────────────────────────
    //
    // Order matters and it is the reverse of the time scales: what is true
    // right now sits closest to the findings it explains, and the standing
    // rules sit furthest away because they change least. Someone scanning
    // top-down reads the task, then the moment, then the permanent.
    const plan = livingPlan(s.steps, { compact: m.cognition.summarize });
    if (plan) this.root.appendChild(plan);

    const prompt = livingPrompt(s.contract, {
      invalidated: s.invalidated || [],
      onEdit: (field) => this.onEditAsk?.(field),
    });
    if (prompt) this.root.appendChild(prompt);

    // Shown when there is anything to show, or anything to offer. An empty
    // rulebook with no offer is not worth the space — but an empty rulebook
    // WITH an offer is the moment the whole promotion idea becomes visible.
    if ((s.rules || []).length || s.offer) {
      this.root.appendChild(rulebook(s.rules || [], {
        offer: s.offer,
        onPromote: (o, always) => this.onPromote?.(o, always),
        onToggle: (r) => this.onToggleRule?.(r),
      }));
    }

    // Progress cues are a preference with a real split: some people want to
    // know how much was checked, and for others a running tally is one more
    // thing demanding attention. `null` means no signal either way, so it is
    // shown — the count is the cheapest evidence that checking happened.
    if (m.cognition.progressCues !== false && !m.cognition.summarize) {
      const foot = document.createElement('p');
      foot.className = 'aw-foot';
      const n = (s.said || []).length;
      foot.textContent = `${n} said aloud · ${s.spokenWords || 0} words`;
      this.root.appendChild(foot);
    }
  },

  /** Set by the host: what to do when a control or a gate answer is clicked. */
  onControl: null,
  onAnswer: null,
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
  if (!current) return findings;
  const here = findings.filter((f) => f.phase === current);
  const earlier = findings.filter((f) => f.phase !== current);
  return here.concat(earlier);
}

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

// Answers offered at a gate, derived from what is being waited on so the
// person answers a question about their own task rather than a generic yes/no.
function choices(s) {
  const w = ((s.gate?.waitingOn || [])[0] || '').toLowerCase();
  if (/size/.test(w)) return [['Change the size', 'change it', true], ['Use it anyway', 'use it', false]];
  if (/extra|cap/.test(w)) return [['Remove the extras', 'remove them', true], ['Go ahead', 'go ahead', false]];
  if (/land|match/.test(w)) return [['Try again', 'try again', true], ['Stop here', 'stop', false]];
  return [['Go on', 'go on', true], ['Stop here', 'stop', false]];
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
  const muted = high ? '#000' : '#6e6e73';
  // Someone who relies on descriptions is not reading this box — the spoken
  // channel is their channel. It stays in the DOM for the screen reader and
  // stops competing for space it is not being read in.
  const width = m.vision.descriptions ? 300 : 360;

  return `
#${AgentWatch.containerId} {
  position: fixed; top: 16px; right: 16px; z-index: 2147483646;
  width: ${width}px; max-height: 76vh; overflow-y: auto;
  background: ${bg}; color: ${fg};
  border: ${high ? '3px solid #000' : '1px solid #d2d2d7'};
  border-radius: 12px;
  box-shadow: ${high ? 'none' : '0 6px 28px rgba(0,0,0,.14)'};
  font: ${base}px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  ${m.motion === 'reduced' ? '' : 'transition: box-shadow .18s ease;'}
}
#${AgentWatch.containerId}.aw-idle { display: none; }
#${AgentWatch.containerId}.aw-held { border-color: ${high ? '#000' : '#e5534b'}; }

#${AgentWatch.containerId} .aw-head {
  display: block; width: 100%; text-align: left;
  padding: 11px 14px; border: 0; border-bottom: 1px solid ${line};
  background: none; color: inherit; font: inherit; font-weight: 600;
  cursor: pointer; border-radius: 12px 12px 0 0;
}
#${AgentWatch.containerId} .aw-head:focus-visible { outline: 3px solid #06c; outline-offset: -3px; }

#${AgentWatch.containerId} .aw-gate {
  margin: 12px 14px; padding: 12px;
  border: 1px solid ${high ? '#000' : '#ffd0cd'}; border-radius: 10px;
  background: ${high ? '#fff' : '#fff5f5'};
}
#${AgentWatch.containerId} .aw-gate p { margin: 0 0 10px; }
#${AgentWatch.containerId} .aw-row { display: flex; gap: 8px; flex-wrap: wrap; }

#${AgentWatch.containerId} .aw-list { list-style: none; margin: 0; padding: 4px 0; }
#${AgentWatch.containerId} .aw-item {
  /* The marker gutter scales with the type. Fixed at 26px it collides with
     the text as soon as anyone turns the size up, which is precisely the
     person this adapter is scaling for. */
  padding: 9px 14px 9px ${Math.round(base * 1.85)}px; position: relative;
}
#${AgentWatch.containerId} .aw-item + .aw-item { border-top: 1px solid ${line}; }
/* Never colour alone: each level carries its own mark, so the distinction
   survives any colour vision and any high-contrast mode that flattens hue. */
#${AgentWatch.containerId} .aw-item::before {
  position: absolute; left: ${Math.round(base * 0.78)}px; top: 9px; font-weight: 700;
}
#${AgentWatch.containerId} .aw-ok::before     { content: "✓"; color: ${high ? '#000' : '#1d8a4e'}; }
#${AgentWatch.containerId} .aw-aside::before  { content: "!"; color: ${high ? '#000' : '#b26a00'}; }
#${AgentWatch.containerId} .aw-stop::before   { content: "■"; color: ${high ? '#000' : '#c0362c'}; }
#${AgentWatch.containerId} .aw-ambient::before{ content: "·"; color: ${muted}; }

#${AgentWatch.containerId} .aw-text { margin: 0; }
#${AgentWatch.containerId} .aw-from {
  margin: 3px 0 0; font-size: ${Math.round(base * 0.82)}px; color: ${muted};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${AgentWatch.containerId} .aw-do {
  margin-top: 7px; font: inherit; font-size: ${Math.round(base * 0.9)}px;
  padding: 5px 12px; border: 1px solid ${high ? '#000' : '#d2d2d7'};
  border-radius: 999px; background: ${bg}; color: ${fg}; cursor: pointer;
}
#${AgentWatch.containerId} .aw-row .aw-do { margin-top: 0; }
#${AgentWatch.containerId} .aw-do:hover { background: ${high ? '#eee' : '#f5f5f7'}; }
#${AgentWatch.containerId} .aw-do:focus-visible { outline: 3px solid #06c; outline-offset: 2px; }
#${AgentWatch.containerId} .aw-primary {
  background: ${high ? '#000' : '#1d1d1f'}; border-color: ${high ? '#000' : '#1d1d1f'}; color: #fff;
}
#${AgentWatch.containerId} .aw-none {
  margin: 0; padding: 14px; color: ${muted};
}
#${AgentWatch.containerId} .aw-foot {
  margin: 0; padding: 9px 14px; border-top: 1px solid ${line};
  font-size: ${Math.round(base * 0.82)}px; color: ${muted};
}
@media (prefers-reduced-motion: reduce) {
  #${AgentWatch.containerId} { transition: none; }
}
${shapeCss(AgentWatch.containerId, base, muted, line, high, bg)}
${surfaceCss(AgentWatch.containerId, base, muted, line, high)}
`;
}
