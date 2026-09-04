// Router — the Controller's brain. Two responsibilities, deliberately split:
//
//   resolve(utterance) → Intent   : grammar first (deterministic), then the
//                                    optional LLM lane, else `unrecognized`.
//   dispatch(Intent)  → Result    : carry the Intent out through the ControlPort,
//                                    resolving relative `deltas` against the
//                                    receiver's live context, clamping to the
//                                    registry range, and honestly dropping keys
//                                    the receiver can't do.
//
// A Result is `{ ok, intent, say, data? }` — `say` is the human feedback the UI
// speaks/shows; `data` carries structured detail (applied keys, content, …).

import { settingsMeta } from '../toolkit/registry/tools.js';
import { parse, consumesWholeUtterance, noMatch, SUGGESTIONS } from './grammar.js';
import { command } from './intent.js';

// Baseline for a numeric key when the receiver reports no current value, so a
// relative "bigger text" has something to move from.
const BASELINE = { fontScale: 100, lineHeight: 1.5, letterSpacing: 0, speechRate: 1.0 };

// Coerce/validate one value against the registry meta; null ⇒ reject.
function validate(key, value) {
  const meta = settingsMeta[key];
  if (!meta) return null;
  if (meta.type === 'boolean') {
    // A model answers in text, so "false" and "off" arrive as strings and
    // Boolean("false") is true. Read the words; reject anything else.
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase();
      if (['true', 'on', 'yes', '1'].includes(s)) return true;
      if (['false', 'off', 'no', '0'].includes(s)) return false;
      return null;
    }
    return Boolean(value);
  }
  if (meta.type === 'string') return value == null ? null : String(value);
  if (meta.type === 'enum') return meta.options.includes(value) ? value : null;
  if (meta.type === 'number') {
    let n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (meta.range) n = Math.min(meta.range[1], Math.max(meta.range[0], n));
    return n;
  }
  return null;
}

/**
 * @param {Object} opts
 * @param {import('./control-port.js').ControlPort} opts.control   The receiving app.
 * @param {{resolve:(utterance:string, capabilities:object)=>Promise<import('./intent.js').Intent|null>}} [opts.llm]
 *   Optional NL lane; runs only when the grammar returns null.
 */
export function createRouter({ control, llm = null, rawToTask = false }) {
  // The grammar is deliberately NARROW, and the app is the default.
  //
  //   1. A grammar rule only claims an utterance it consumes WHOLE
  //      (consumesWholeUtterance). A rule that matches a substring of a longer
  //      sentence is a coincidence, not an intent — "tell me about dark matter"
  //      must not turn on dark mode.
  //   2. When the receiver takes tasks, only the SETTINGS vocabulary stays
  //      deterministic (adapt with keys it declared / undo / query): those are
  //      ~150 ms through applySettings, persist in the profile, and are
  //      undoable. Everything else — commands (scroll/navigate/search/activate)
  //      and anything unparsed — goes to the app, which does them at least as
  //      well and keeps compound phrasing ("open google and search for apples")
  //      whole.
  //   3. Only when there is NO task-capable app do we fall back to acting on a
  //      whole-utterance command locally, then the LLM lane, then an honest
  //      "didn't catch that" — so nothing is silently faked.
  //
  // Capabilities are fetched lazily so the common rawToTask path (straight to a
  // task) still costs no extra round trip.
  async function resolve(utterance) {
    let _caps = null;
    const caps = async () => (_caps || (_caps = await control.describeCapabilities()));

    const det = parse(utterance);
    if (det && consumesWholeUtterance(utterance)) {
      // undo/query are core ControlPort methods — always deterministic.
      if (det.type === 'undo' || det.type === 'query') return det;
      const c = await caps();
      const canTask = rawToTask || (c.actions || []).includes('task');
      // No app to hand it to → act on it (or let dispatch refuse honestly).
      if (!canTask) return det;
      if (det.type === 'adapt') {
        const supported = new Set(c.settingKeys || []);
        const keys = [...Object.keys(det.changes || {}), ...Object.keys(det.deltas || {})];
        if (keys.length && keys.every((k) => supported.has(k))) return det;
      }
      // A command, or a setting this receiver can't do → the app handles it.
    }

    if (rawToTask) return taskCommand(utterance);
    const c = await caps();
    if ((c.actions || []).includes('task')) return taskCommand(utterance);
    if (llm) {
      try {
        const it = await llm.resolve(utterance, c);
        if (it && it.type) return it;
      } catch { /* fall through — the LLM lane is best-effort */ }
    }
    return noMatch(utterance);
  }

  async function dispatch(intent, opts = {}) {
    switch (intent.type) {
      case 'adapt':   return dispatchAdapt(intent);
      case 'undo':    return dispatchUndo(intent);
      case 'query':   return dispatchQuery(intent);
      case 'command': return dispatchCommand(intent, opts);
      default:        return result(false, intent, "I didn't catch that. Try: " + (intent.suggestions || []).join(', ') + '.');
    }
  }

  async function dispatchAdapt(intent) {
    const caps = await control.describeCapabilities();
    const supported = new Set(caps.settingKeys || []);

    // Start from absolute changes; resolve relative deltas against live context.
    const changes = {};
    for (const [k, v] of Object.entries(intent.changes || {})) changes[k] = v;

    if (intent.deltas && Object.keys(intent.deltas).length) {
      const ctx = await control.getContext();
      const active = (ctx && ctx.activeSettings) || {};
      for (const [k, by] of Object.entries(intent.deltas)) {
        const current = k in active ? Number(active[k]) : (k in BASELINE ? BASELINE[k] : 0);
        changes[k] = current + by;
      }
    }

    // Validate/clamp, and split out keys this receiver can't do (honesty).
    const final = {};
    const rejected = [];
    const unsupported = [];
    for (const [k, v] of Object.entries(changes)) {
      if (!supported.has(k)) { unsupported.push(k); continue; }
      const clamped = validate(k, v);
      if (clamped === null) { rejected.push(k); continue; }
      final[k] = clamped;
    }

    if (!Object.keys(final).length) {
      const why = unsupported.length ? "this app can't change that" : 'that setting is not valid here';
      return result(false, intent, `Sorry, ${why}.`, { unsupported, rejected });
    }

    const applyRes = await control.applySettings(final);
    if (applyRes && applyRes.error) return result(false, intent, `That didn't work: ${applyRes.error}.`, applyRes);
    const say = intent.say || 'Done';
    const tail = unsupported.length ? ` (this app can't do: ${unsupported.join(', ')})` : '';
    return result(true, intent, say + '.' + tail, { applied: (applyRes && applyRes.applied) || final, unsupported, rejected });
  }

  async function dispatchUndo(intent) {
    const res = await control.undoLast();
    if (res && res.error) return result(false, intent, `Nothing to undo.`, res);
    return result(true, intent, 'Undone.', res);
  }

  async function dispatchQuery(intent) {
    if (intent.ask === 'help') {
      return result(true, intent, 'You can say: ' + SUGGESTIONS.join(', ') + '.', { suggestions: SUGGESTIONS });
    }
    if (intent.ask === 'content') {
      const res = await control.getContent(intent.mode || 'outline');
      if (res && res.error) return result(false, intent, `There's nothing to read here.`, res);
      const text = res.mode === 'outline' || res.outline
        ? (res.outline || []).join('. ')
        : (res.text || '');
      return result(true, intent, text || res.title || 'Nothing to read.', res);
    }
    // ask === 'context' — summarize the active settings.
    const ctx = await control.getContext();
    const active = (ctx && ctx.activeSettings) || {};
    const keys = Object.keys(active);
    const say = keys.length
      ? 'Currently set: ' + keys.map((k) => `${k} ${active[k]}`).join(', ') + '.'
      : 'No settings are currently changed.';
    return result(true, intent, say, ctx);
  }

  async function dispatchCommand(intent, opts = {}) {
    const caps = await control.describeCapabilities();
    // Under rawToTask the host asserted the receiver takes tasks, so send a
    // 'task' even if it isn't advertised — let the receiver decide, rather than
    // refuse here. Other actions are still gated on the receiver declaring them.
    const exempt = rawToTask && intent.action === 'task';
    if (!exempt && !(caps.actions || []).includes(intent.action)) {
      return result(false, intent, `This app can't ${intent.action}.`, { unsupported: [intent.action] });
    }
    // `meta` (4th arg) carries per-run flags the app should honor — e.g.
    // returnToController: activate the Controller's tab again when done.
    const meta = { returnToController: opts.returnToController !== false };
    const res = await control.performAction(intent.action, intent.target, intent.text, meta);
    if (!res || !res.ok) {
      // Surface WHY. Receivers put an action-specific reason in `detail`
      // ("no agent configured") and a transport/method failure in `error`
      // ("lost the connection to Chrome — check for an 'Allow remote debugging'
      // prompt", "control channel timeout"). Either is far more actionable than
      // a bare "That didn't work" — don't swallow it.
      const why = (res && (res.detail || res.error)) || '';
      return result(false, intent, `That didn't work${why ? ': ' + why : ''}.`, res);
    }
    return result(true, intent, (intent.say || 'Done') + '.', res);
  }

  return { resolve, dispatch };
}

function result(ok, intent, say, data = null) {
  return { ok, intent, say, data };
}

// Send the raw utterance to the app as a task, reading it back so spoken input
// can be caught if mis-recognized before the app spends a minute on it.
function taskCommand(utterance) {
  const heard = String(utterance).trim();
  const shown = heard.length > 80 ? heard.slice(0, 79) + '…' : heard;
  return command(utterance, { action: 'task', text: utterance, say: `Ok, running: ${shown}` });
}
