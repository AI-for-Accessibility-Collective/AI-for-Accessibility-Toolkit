// Wrap adapters the toolkit already has into provider registrations.
//
// Every adapter in tools/adapters/ (and every workshop adapter written to the
// same shape) is an object with `enabled`, `enable(options)`, `disable()` and
// `toggle()`. `fromToggleAdapter` turns one into a stateful registration
// without changing the adapter:
//
//   - apply {enabled: true, parameters}  turns it on, or — when it is already
//     on with different parameters — disables and re-enables it, because
//     calling enable() again on most adapters does not change their options
//     (adapter-mcp.md §10.3);
//   - apply {enabled: false}             turns it off;
//   - query                               reports `enabled` as the adapter
//     itself reports it, and the parameters last requested through here
//     (labelled as requested, not observed);
//   - revert                              puts back the previous configuration,
//     but only when nothing changed it since. A generation counter plus the
//     adapter's own `enabled` flag catch both later applies through the
//     provider and changes made elsewhere (a person flipping the switch), so
//     undo never overwrites a later choice — including the A→B→C→B case,
//     where the values match but the history does not.
//
// `fromAction` covers one-shot adapters: apply runs it, nothing to revert.

import { jsonEqual } from '../protocol/adapter/index.js';

const reason = (code, message) => ({ code, message });

/**
 * @param {Object} options
 * @param {object} options.descriptor  mode must be 'stateful'
 * @param {{enabled?: boolean, enable: Function, disable: Function}} options.adapter
 * @param {(parameters: object) => any} [options.toOptions]  parameters → enable() argument
 * @param {() => any} [options.observe]  data for the result (must match outputSchema)
 * @param {(target: object) => (null|{code: string, message: string})} [options.resolveTarget]
 * @param {Function} [options.targets]  enumerate concrete targets
 * @param {Function} [options.check]
 * @param {() => object} [options.availability]
 * @param {string|null} [options.executionArtifactDigest]
 */
export function fromToggleAdapter({ descriptor, adapter, toOptions = (p) => p, observe, resolveTarget, targets, check, availability, executionArtifactDigest = null }) {
  if (descriptor?.mode !== 'stateful') throw new Error('fromToggleAdapter: the descriptor must be mode "stateful"');
  if (!adapter || typeof adapter.enable !== 'function' || typeof adapter.disable !== 'function') {
    throw new Error('fromToggleAdapter: the adapter needs enable() and disable()');
  }
  const isOn = () => !!adapter.enabled;
  // What this wrapper last asked for. `parameters` is null when the adapter
  // was already on before the wrapper knew about it.
  let config = { enabled: isOn(), parameters: null };
  let generation = 0;

  async function data() {
    if (observe) return observe();
    return { enabled: isOn() };
  }

  async function setTo(enabled, parameters) {
    if (enabled) {
      if (isOn()) await adapter.disable();
      await adapter.enable(toOptions(parameters ?? {}));
    } else {
      await adapter.disable();
    }
  }

  return {
    descriptor,
    resolveTarget,
    targets,
    check,
    availability,
    executionArtifactDigest,

    async apply({ desired }) {
      const want = desired.enabled;
      if (want === isOn() && (!want || (config.enabled && jsonEqual(config.parameters, desired.parameters)))) {
        return { status: 'noop', applied: want ? desired.parameters : {}, data: await data(), verification: 'adapter-reported' };
      }
      const before = { enabled: isOn(), parameters: config.parameters };
      try {
        await setTo(want, desired.parameters);
      } catch (e) {
        config = { enabled: isOn(), parameters: isOn() ? config.parameters : null };
        generation++;
        return { status: 'failed', effectsKnown: false, reasons: [reason('internal-error', e?.message || String(e))] };
      }
      // An adapter whose enabled flag disagrees with what was asked for did
      // not do it, whatever enable() returned.
      if (typeof adapter.enabled === 'boolean' && adapter.enabled !== want) {
        generation++;
        config = { enabled: isOn(), parameters: null };
        return { status: 'failed', effectsKnown: false, reasons: [reason('internal-error', `${descriptor.id} did not turn ${want ? 'on' : 'off'}.`)] };
      }
      generation++;
      config = { enabled: want, parameters: want ? desired.parameters : null };
      return {
        status: 'applied',
        applied: want ? desired.parameters : {},
        data: await data(),
        verification: 'adapter-reported',
        undo: { token: { generation, before, after: { enabled: want } }, scope: 'original-target' },
      };
    },

    async query() {
      const state = { enabled: isOn() };
      if (isOn() && config.enabled && config.parameters) state.requestedParameters = config.parameters;
      const unavailableFields = isOn() && !config.parameters ? [{ field: 'requestedParameters', code: 'target-unavailable', message: 'It was turned on outside this provider, so its parameters are not known.' }] : [];
      return { state, unavailableFields, verification: 'adapter-reported' };
    },

    async revert({ token }) {
      if (!token || token.generation !== generation || isOn() !== token.after.enabled) {
        return { status: 'unavailable', effectsKnown: true, reasons: [reason('write-conflict', 'It changed after this receipt was issued, so undoing it would overwrite a later choice. Nothing was changed.')] };
      }
      const { before } = token;
      if (before.enabled && before.parameters === null) {
        return { status: 'unavailable', effectsKnown: true, reasons: [reason('undo-expired', 'The earlier parameters are not known, so they cannot be put back exactly. Nothing was changed.')] };
      }
      try {
        await setTo(before.enabled, before.parameters);
      } catch (e) {
        generation++;
        return { status: 'failed', effectsKnown: false, reasons: [reason('internal-error', e?.message || String(e))] };
      }
      generation++;
      config = { ...before };
      return { status: 'applied', applied: before.enabled ? before.parameters : {}, data: await data(), verification: 'adapter-reported' };
    },
  };
}

/**
 * A one-shot (action) adapter: apply runs `run(parameters, request)` once.
 * `run` returns `{status?, data?, unmet?, reasons?}`; a plain value becomes
 * `data` with status applied.
 */
export function fromAction({ descriptor, run, resolveTarget, targets, check, availability, executionArtifactDigest = null }) {
  if (descriptor?.mode !== 'action') throw new Error('fromAction: the descriptor must be mode "action"');
  return {
    descriptor, resolveTarget, targets, check, availability, executionArtifactDigest,
    async apply(request) {
      const out = await run(request.desired.parameters, request);
      if (out && typeof out === 'object' && typeof out.status === 'string') return out;
      return { status: 'applied', data: out, verification: 'adapter-reported' };
    },
  };
}
