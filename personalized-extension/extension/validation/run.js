// The validation run: what holds a task together across pages.
//
// A check fires on one page. A RUN is what makes the layer coherent — it
// remembers the contract, what has already been said, what the agent is
// waiting on, and what it never looked at. Without it every page is a fresh
// start, findings repeat, and a gate is just a printed sentence.
//
// This is the piece the harness agent talks to. It exposes three things:
//
//   observe(snapshot, phase)  read a page, check it, decide how hard to press
//   gate()                    is the agent allowed to continue?
//   answer(text)              resolve whatever it is waiting on
//
// The agent must call gate() before any step that commits something. That is
// what makes a stop a stop rather than narration — the corpus is explicit that
// noticing a problem and continuing anyway is worse than not noticing.

import { read } from '../../../tools/validators/reader.js';
import { checkPage } from './checks.js';
import { decide, highest } from './policy.js';
import { render } from './render.js';

// What each phase needs read. Signals with no extractor are controls — actions
// delegation removed — and are handed back rather than described.
const READS = {
  Search: ['resultSet', 'resultCount', 'sponsoredCount', 'priceNow', 'priceTypical',
           'firstOrganicIndex', 'activeFilters', 'sortOrder', 'badges'],
  'Check item': ['title', 'buyBoxPrice', 'rating', 'ratingCount', 'sizeOptions',
                 'selectedSize', 'stockLine', 'galleryCount', 'photoAltText',
                 'deliveryDate', 'countdown', 'returnsBadge', 'specRows'],
  'Add to cart': ['addConfirmation', 'cartCount', 'cartLines', 'cartLineSize'],
  Checkout: ['shipAddress', 'deliveryOptions', 'selectedDelivery', 'formErrors'],
  'Review order': ['itemCount', 'itemsSubtotal', 'orderTotal', 'tax', 'arrivalDate',
                   'cardLabel', 'cardLastFour', 'orderLines'],
  Confirm: ['outcomeHeading', 'orderNumber', 'confirmationEmail', 'cancelControl',
            'orderStatus'],
};

// Plain names for the extractors, supplied with the rest of the analysis.
// Empty means fall back to the internal name — ugly, but never wrong.
let NAMES = {};

/** @param {Object<string,string>} map extractor → the question it answers */
export function setExtractorNames(map) {
  NAMES = map || {};
}

export function createRun(contract, opts = {}) {
  const style = opts.style || 'balanced';
  const channels = { speech: opts.speech !== false, visual: opts.visual !== false };

  const seen = new Set();      // findings already raised, so they do not repeat
  const said = [];             // everything spoken, in order
  const gaps = [];             // extractors that could not read something
  const waiting = [];          // unresolved stops — the agent may not pass these
  const steps = [];            // the plan, with outcomes

  return {
    contract,

    /** Read a page, check it, and decide how loudly to say each thing. */
    observe(snapshot, phase) {
      const want = READS[phase] || [];
      const facts = read(snapshot, want);

      for (const [k, v] of Object.entries(facts)) {
        // Recorded once per extractor per phase. Re-reading a page does not
        // make the same unreadable thing unreadable twice.
        if (v.absent && !gaps.some((g) => g.phase === phase && g.extractor === k)) {
          gaps.push({ phase, extractor: k, why: v.from });
        }
      }

      const findings = checkPage(facts, phase, contract);
      const rendered = [];
      for (const f of findings) {
        const { level, why } = decide(f, { seen, style });
        seen.add(`${f.widget}|${f.phase}`);
        const r = render(f, level, channels);
        rendered.push({ ...r, why });
        if (level !== 'ambient') said.push({ phase, say: f.say, level, widget: f.widget });
        if (r.spoken?.holds) waiting.push({ widget: f.widget, ask: f.say, phase });
      }

      // One entry per page, updated — not one per read.
      //
      // A page is read more than once: the navigation trigger fires and an
      // explicit observe follows. Pushing each time turned the plan into
      // "Search / Search / Check item / Check item", which reads as though the
      // agent went round in circles. The last read is the current truth.
      const prior = steps.find((x) => x.phase === phase);
      const entry = {
        phase,
        read: Object.values(facts).filter((f) => !f.absent).length,
        of: Object.keys(facts).length,
        spoke: (prior?.spoke || 0) + rendered.filter((r) => r.level !== 'ambient').length,
      };
      if (prior) Object.assign(prior, entry);
      else steps.push(entry);
      return { facts, findings: rendered };
    },

    /**
     * May the agent continue?
     *
     * Called before anything that commits — adding to a cart, entering
     * checkout, placing an order. A finding that holds is not advice the agent
     * can weigh; it is a stop, and passing it silently is the failure this
     * layer exists to prevent.
     */
    gate() {
      if (!waiting.length) return { allowed: true };
      return {
        allowed: false,
        waitingOn: waiting.map((w) => w.widget),
        say: waiting.length === 1
          ? `I'm waiting on one thing: ${waiting[0].ask}`
          : `I'm waiting on ${waiting.length} things before I go further.`,
      };
    },

    /** Resolve what the agent is waiting on. */
    answer(widget, response) {
      const i = waiting.findIndex((w) => w.widget === widget);
      if (i < 0) return { resolved: false, why: 'nothing was waiting on that' };
      const [w] = waiting.splice(i, 1);
      said.push({ phase: w.phase, say: `— ${response}`, level: 'answer', widget });
      return { resolved: true, remaining: waiting.length };
    },

    /** Anything reachable but not announced, for when the person asks. */
    onRequest() {
      return said.filter((s) => s.level === 'ambient');
    },

    /** What the layer could not read. A developer's list, never spoken. */
    gaps: () => gaps.slice(),

    /**
     * The Living Plan — what happened, in the person's terms.
     *
     * Three marks, and the third is why this exists:
     *   done     the page was read and checked
     *   failed   something the reader could not get at
     *   skipped  a check that never ran
     *
     * A skipped check is the failure the corpus records most often: an
     * unflagged absence reads exactly like a passed check. Listing only what
     * happened would reproduce it here, in the surface built to prevent it —
     * so the things that did NOT happen are carried in the same list, with
     * their own mark, not in a footnote.
     */
    plan() {
      const out = [];
      for (const st of steps) {
        // "read 9 of 9 things · said 6" is our bookkeeping, not their answer.
        // What they want to know is whether the page was fully readable and
        // whether anything came of it.
        const missed = st.of - st.read;
        out.push({
          state: 'done',
          what: st.phase,
          detail: missed
            ? `${missed} thing${missed === 1 ? '' : 's'} here I couldn't read`
            : (st.spoke ? `${st.spoke} worth mentioning` : 'nothing to flag'),
        });
        // Grouped per phase: five separate "could not read X" lines for one
        // page is noise, one line naming five is a fact.
        const unread = gaps.filter((g) => g.phase === st.phase);
        if (unread.length) {
          // Named the way the analysis names them, not by our variable names.
          const named = [...new Set(unread.map((g) => NAMES[g.extractor] || g.extractor))];
          out.push({
            state: 'failed',
            what: `couldn't read ${named.length} thing${named.length === 1 ? '' : 's'}`,
            detail: named.join(', '),
          });
        }
      }
      return out;
    },

    summary() {
      const words = said.filter((s) => s.level !== 'ambient')
        .reduce((n, s) => n + s.say.split(/\s+/).length, 0);
      return {
        steps: this.plan(), said: said.slice(),
        spokenWords: words, waiting: waiting.length, unreadable: gaps.length,
      };
    },
  };
}
