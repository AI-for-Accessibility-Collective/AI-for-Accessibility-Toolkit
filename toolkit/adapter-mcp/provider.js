// The adapter provider: an application's MCP interface to the adapters it
// chooses to export (adapter-mcp.md §5–§8).
//
// This is a thin projection, not a runtime. The application keeps executing
// its adapters with its own code; each registration hands over a descriptor
// and the functions that already do the work (apply, and optionally query,
// check, revert, targets). The provider:
//
//   - validates the application and every descriptor once, up front, and
//     throws with every problem listed, so a broken registration never ships;
//   - computes each descriptor's digest, so clients can pin what they checked;
//   - answers MCP JSON-RPC (initialize, ping, tools/list, tools/call) with the
//     gateway tools, plus one typed `apply_<id>` tool per adapter whose input
//     schema is the adapter's own (both bindings share the same checks);
//   - enforces the contract before an application function runs: exact
//     profile version, pinned descriptor, target shape and rules, the
//     adapter's targetRefSchema and inputSchema, stateful vs action desired
//     state, and unsupported preconditions;
//   - stamps every outcome with an execution id, the pinned reference, the
//     target and timestamps, and keeps undo receipts opaque.
//
// It is transport-free: `handle(message)` takes one JSON-RPC message and
// returns the response (or null for a notification). connect.js carries it to
// a toolkit service; an MCP stdio or HTTP server can carry it just as well.
// `call(name, args)` is the in-process binding: the same checks, no MCP.

import {
  PROFILE_VERSION, MCP_PROTOCOL_VERSION, MUTATION_STATUSES, VERIFICATION,
  checkApplication, checkDescriptor, summarizeDescriptor, adapterRefOf,
  validate, formatErrors, canonicalize, descriptorDigest,
  targetShapeError, matchTarget, platformCompatibility,
  TOOL_SCHEMAS, TOOL_DESCRIPTIONS, TARGET_SCHEMA,
} from '../protocol/adapter/index.js';

const READ_ONLY = new Set(['adapter_list', 'adapter_describe', 'adapter_targets', 'adapter_query', 'adapter_check']);
// MCP revisions whose tools surface matches what this provider speaks.
const COMPATIBLE_MCP = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_RECEIPTS = 200;

/** Thrown at creation when an application or descriptor is invalid. */
export class AdapterMcpError extends Error {
  constructor(message, errors = []) {
    super(errors.length ? `${message}: ${formatErrors(errors, 8)}` : message);
    this.name = 'AdapterMcpError';
    this.errors = errors;
  }
}

const reason = (code, message, key) => (key ? { code, message, key } : { code, message });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function randomId(prefix) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return `${prefix}-${s}`;
}

/** Tool names a model API accepts: letters, digits, _ and -, at most 64. */
function typedToolName(id) {
  return `apply_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
}

/**
 * @typedef {Object} Registration
 * @property {object} descriptor  see protocol/adapter/descriptor.js
 * @property {(req: object, ctx: object) => Promise<object>|object} apply
 * @property {(req: object, ctx: object) => Promise<object>|object} [query]
 * @property {(req: object, ctx: object) => Promise<object>|object} [check]
 * @property {(req: object, ctx: object) => Promise<object>|object} [revert]
 * @property {(req: object, ctx: object) => Promise<object>|object} [targets]
 * @property {(target: object) => (null|{code: string, message: string})} [resolveTarget]
 *           app-owned target check (e.g. "is this my document?"); null = OK
 * @property {() => ({available: boolean, reasons?: object[]})} [availability]
 * @property {string|null} [executionArtifactDigest]
 */

/**
 * @param {Object} options
 * @param {object} options.application  the application advertisement
 * @param {Registration[]} options.adapters
 * @param {boolean} [options.typedTools]  also expose apply_<id> tools (default true)
 * @param {string} [options.instructions]  shown to MCP clients on initialize
 * @param {number} [options.dedupWindowMs]  requestKey retention (default 10 min)
 * @param {() => Date} [options.now]
 */
export function createAdapterProvider({ application, adapters, typedTools = true, instructions, dedupWindowMs = 600_000, now = () => new Date() }) {
  const appErrors = checkApplication(application);
  if (appErrors.length) throw new AdapterMcpError('invalid application advertisement', appErrors);
  if (!Array.isArray(adapters)) throw new AdapterMcpError('adapters must be a list of registrations');

  const regs = new Map();
  const problems = [];
  for (const [i, reg] of adapters.entries()) {
    const d = reg?.descriptor;
    const errs = checkDescriptor(d, { application }).map(e => ({ path: `/adapters/${i}${e.path}`, message: e.message }));
    if (!errs.length) {
      if (typeof reg.apply !== 'function') errs.push({ path: `/adapters/${i}/apply`, message: 'an apply function is required' });
      for (const op of ['query', 'revert', 'targets']) {
        if (d.operations.includes(op) && typeof reg[op] !== 'function') errs.push({ path: `/adapters/${i}/${op}`, message: `"${op}" is listed in operations but no ${op} function was given` });
      }
      // A handler the descriptor does not advertise would never be called;
      // say so instead of silently ignoring it.
      if (typeof reg.targets === 'function' && !d.operations.includes('targets')) errs.push({ path: `/adapters/${i}/operations`, message: 'a targets function was given, so list "targets" in operations' });
      if (regs.has(d.id)) errs.push({ path: `/adapters/${i}/id`, message: `duplicate adapter id "${d.id}"` });
    }
    problems.push(...errs);
    // Only explicitly exported adapters are reachable over MCP; an internal
    // one cannot be invoked by guessing its id.
    if (!errs.length && d.exposure === 'mcp') {
      regs.set(d.id, { ...reg, descriptor: structuredClone(d) });
    }
  }
  if (problems.length) throw new AdapterMcpError('invalid adapter registration', problems);

  // Effective execution compatibility on the platform this instance reports.
  // An adapter that cannot run here is not exported at all.
  for (const [id, reg] of regs) {
    const c = platformCompatibility(application.supportedPlatforms, reg.descriptor.platformConstraints, application.platform);
    if (c === 'incompatible') regs.delete(id);
    else reg.compatibility = c;
  }

  const ready = Promise.all([...regs.values()].map(async (reg) => {
    // The artifact digest travels with the descriptor so a service can
    // recompute the descriptor digest; it is not itself a digest field.
    reg.descriptor.executionArtifactDigest = reg.executionArtifactDigest ?? null;
    reg.descriptor.descriptorDigest = await descriptorDigest(reg.descriptor, reg.descriptor.executionArtifactDigest);
  })).then(() => undefined);

  let providerId = application.providerId;
  const receipts = new Map(); // receiptId -> { reg, token, scope, done }
  const executions = new Map(); // requestKey -> { canon, result, at }
  const typed = new Map(); // tool name -> reg

  if (typedTools) for (const reg of regs.values()) typed.set(typedToolName(reg.descriptor.id), reg);

  const advertisement = () => ({ ...(providerId ? { providerId } : {}), application: { ...application } });
  const descriptors = () => [...regs.values()].map(r => structuredClone(r.descriptor));

  function guarantees() {
    return {
      executionTracking: false,
      cancellation: false,
      revisionCheck: false,
      deduplication: { retentionSeconds: Math.round(dedupWindowMs / 1000) },
      undo: 'per-adapter: see each descriptor\'s operations and effects.reversibility',
      targetOmission: 'typed apply tools only, when the adapter enumerates exactly one complete candidate',
    };
  }

  // ── reference and target resolution ──────────────────────────────────────

  function resolveRef(ref, { pinned }) {
    if (!isObject(ref)) return { error: reason('invalid-parameters', 'adapterRef must be an object.') };
    if (ref.appId !== application.appId) {
      return { error: reason('unknown-adapter', `This provider is ${application.appId}; adapterRef.appId must name it, not the affected application.`) };
    }
    const reg = regs.get(ref.id);
    if (!reg) return { error: reason('unknown-adapter', `${application.appId} exports no adapter "${ref.id}".`) };
    const d = reg.descriptor;
    if ((pinned || ref.version !== undefined) && ref.version !== d.version) {
      return { error: reason('descriptor-changed', `${d.id} is now version ${d.version}; describe it again before calling.`) };
    }
    if ((pinned || ref.descriptorDigest !== undefined) && ref.descriptorDigest !== d.descriptorDigest) {
      return { error: reason('descriptor-changed', `${d.id}'s descriptor changed since it was checked; describe it again before calling.`) };
    }
    return { reg };
  }

  function checkTarget(reg, target) {
    const d = reg.descriptor;
    const shape = targetShapeError(target);
    if (shape) return reason('invalid-parameters', shape, 'target');
    if (target.ref !== undefined) {
      if (!d.targetRefSchema) return reason('invalid-target-ref', `${d.id} declares no targetRefSchema, so a target.ref cannot be used.`, 'target.ref');
      const errs = validate(d.targetRefSchema, target.ref, '/target/ref');
      if (errs.length) return reason('invalid-target-ref', formatErrors(errs), 'target.ref');
    }
    if (!matchTarget(d.targets, target)) {
      return reason('target-out-of-scope', `${target.url || target.application} is outside the targets ${d.id} supports.`, 'target');
    }
    return reg.resolveTarget ? reg.resolveTarget(target) || null : null;
  }

  function checkDesired(reg, desired) {
    const d = reg.descriptor;
    if (!isObject(desired)) return [reason('invalid-parameters', 'desired must be an object.', 'desired')];
    const out = [];
    if (d.mode === 'stateful') {
      if (typeof desired.enabled !== 'boolean') out.push(reason('invalid-parameters', 'A stateful adapter needs desired.enabled (true or false): the complete desired configuration, not a patch.', 'desired.enabled'));
      else if (desired.enabled) {
        if (!isObject(desired.parameters)) out.push(reason('invalid-parameters', 'desired.parameters is required when enabled (use {} for none).', 'desired.parameters'));
      } else if (desired.parameters !== undefined) {
        out.push(reason('invalid-parameters', 'Omit desired.parameters when enabled is false.', 'desired.parameters'));
      }
    } else {
      if (desired.enabled !== undefined) out.push(reason('invalid-parameters', 'An action adapter takes desired.parameters only, not enabled.', 'desired.enabled'));
      if (!isObject(desired.parameters)) out.push(reason('invalid-parameters', 'desired.parameters is required (use {} for none).', 'desired.parameters'));
    }
    if (!out.length && isObject(desired.parameters)) {
      const errs = validate(d.inputSchema, desired.parameters, '/desired/parameters');
      if (errs.length) out.push(reason(errs.some(e => /at (least|most)|more than|less than/.test(e.message)) ? 'out-of-range' : 'invalid-parameters', formatErrors(errs), 'desired.parameters'));
    }
    return out;
  }

  const ctx = () => ({ now: now(), application, providerId });

  // ── tools ────────────────────────────────────────────────────────────────

  async function adapterList(args) {
    let list = [...regs.values()];
    if (args.surface) list = list.filter(r => r.descriptor.surfaces.includes(args.surface));
    if (args.capability) list = list.filter(r => r.descriptor.capabilities.some(c => c.id === args.capability));
    if (args.target) {
      const shape = targetShapeError(args.target);
      if (shape) return { isError: true, result: { status: 'failed', reasons: [reason('invalid-parameters', shape, 'target')] } };
      list = list.filter(r => matchTarget(r.descriptor.targets, args.target));
    }
    return {
      result: {
        profileVersion: PROFILE_VERSION,
        ...advertisement(),
        adapters: list.map(r => ({ ...summarizeDescriptor(r.descriptor), compatibility: r.compatibility })),
        nextCursor: null,
        guarantees: guarantees(),
      },
    };
  }

  async function adapterDescribe(args) {
    const { reg, error } = resolveRef(args.adapterRef, { pinned: false });
    if (error) return { isError: true, result: { status: 'unavailable', reasons: [error] } };
    let availability = { available: true, reasons: [] };
    if (reg.availability) {
      try { availability = { reasons: [], ...(await reg.availability()) }; } catch (e) { availability = { available: false, reasons: [reason('internal-error', e.message)] }; }
    }
    return { result: { status: 'ok', descriptor: structuredClone(reg.descriptor), compatibility: reg.compatibility, availability } };
  }

  async function candidatesFor(reg) {
    const out = await reg.targets({}, ctx());
    const valid = (out?.candidates || []).filter(c => isObject(c) && !checkTarget(reg, c.target));
    return { candidates: valid, coverage: ['complete', 'partial', 'unknown'].includes(out?.coverage) ? out.coverage : 'unknown', nextCursor: out?.nextCursor ?? null };
  }

  async function adapterTargets(args) {
    const { reg, error } = resolveRef(args.adapterRef, { pinned: true });
    if (error) return { isError: true, result: { status: 'unavailable', reasons: [error] } };
    if (!reg.descriptor.operations.includes('targets')) {
      return { isError: true, result: { status: 'unsupported', reasons: [reason('operation-unsupported', `${reg.descriptor.id} does not enumerate targets.`)] } };
    }
    return { result: { status: 'ok', ...(await candidatesFor(reg)) } };
  }

  async function adapterQuery(args) {
    const { reg, error } = resolveRef(args.adapterRef, { pinned: true });
    if (error) return { isError: true, result: { status: 'unavailable', reasons: [error] } };
    const d = reg.descriptor;
    if (!d.operations.includes('query')) {
      return { isError: true, result: { status: 'unsupported', reasons: [reason('operation-unsupported', `${d.id} does not support reading its state.`)] } };
    }
    const bad = checkTarget(reg, args.target);
    if (bad) return { isError: true, result: { status: 'unavailable', target: args.target, reasons: [bad] } };
    const declared = Object.keys(d.stateSchema.properties || {});
    const fields = args.fields ?? declared;
    const unknown = fields.filter(f => !declared.includes(f));
    if (unknown.length) return { isError: true, result: { status: 'unavailable', reasons: [reason('invalid-parameters', `Unknown state field(s): ${unknown.join(', ')}.`, 'fields')] } };

    let out;
    try { out = (await reg.query({ target: args.target, fields }, ctx())) || {}; } catch (e) {
      return { isError: true, result: { status: 'unavailable', target: args.target, reasons: [reason('internal-error', e.message)] } };
    }
    const reported = isObject(out.state) ? out.state : {};
    const unavailableFields = Array.isArray(out.unavailableFields) ? out.unavailableFields.filter(u => fields.includes(u?.field)) : [];
    const state = {};
    for (const f of fields) {
      if (unavailableFields.some(u => u.field === f)) continue;
      if (!Object.hasOwn(reported, f)) {
        // Never turn "not reported" into false, zero or a default.
        unavailableFields.push({ field: f, code: 'target-unavailable', message: `${f} was not reported.` });
        continue;
      }
      const errs = validate(d.stateSchema.properties[f], reported[f], `/state/${f}`);
      if (errs.length) unavailableFields.push({ field: f, code: 'internal-error', message: `The adapter reported an invalid ${f}: ${formatErrors(errs)}` });
      else state[f] = reported[f];
    }
    const observed = Object.keys(state).length;
    const status = observed === fields.length ? 'ok' : observed ? 'partial' : 'unavailable';
    return {
      isError: status === 'unavailable',
      result: {
        status, target: args.target, state,
        observedAt: out.observedAt || now().toISOString(),
        cached: out.cached === true,
        consistency: out.consistency === 'atomic' ? 'atomic' : 'best-effort',
        verification: VERIFICATION.includes(out.verification) ? out.verification : 'adapter-reported',
        unavailableFields,
      },
    };
  }

  async function adapterCheck(args) {
    const { reg, error } = resolveRef(args.adapterRef, { pinned: true });
    if (error) return { isError: true, result: { status: 'unavailable', compatible: false, reasons: [error] } };
    const reasons = [];
    const bad = checkTarget(reg, args.target);
    if (bad) reasons.push(bad);
    reasons.push(...checkDesired(reg, args.desired));
    let extra = {};
    if (!reasons.length && reg.check) {
      try { extra = (await reg.check({ target: args.target, desired: args.desired }, ctx())) || {}; } catch (e) { reasons.push(reason('internal-error', e.message)); }
      if (Array.isArray(extra.reasons)) reasons.push(...extra.reasons);
    }
    const compatible = !reasons.length && extra.compatible !== false;
    // The check itself succeeded even when it finds the adapter cannot run.
    return {
      result: {
        status: 'ok', compatible, reasons,
        degradation: Array.isArray(extra.degradation) ? extra.degradation : [],
        ...(extra.permission ? { permission: extra.permission } : {}),
      },
    };
  }

  function stamp(reg, operation, base, startedAt) {
    return {
      executionId: randomId('execution'),
      operation,
      adapterRef: adapterRefOf(reg.descriptor),
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      ...base,
    };
  }

  function normalizeOutcome(reg, out, { operation, target, requested, startedAt }) {
    const d = reg.descriptor;
    const reasons = Array.isArray(out?.reasons) ? out.reasons.filter(r => isObject(r) && typeof r.code === 'string') : [];
    let status = out?.status;
    if (!MUTATION_STATUSES.includes(status)) {
      reasons.push(reason('internal-error', `${d.id} returned an unknown status ${JSON.stringify(status)}.`));
      status = 'failed';
    }
    const result = stamp(reg, operation, {
      status,
      target: out?.target ?? target,
      effectsKnown: typeof out?.effectsKnown === 'boolean' ? out.effectsKnown : status !== 'failed',
      requested,
      applied: out?.applied ?? (status === 'applied' || status === 'noop' ? requested : {}),
      unmet: Array.isArray(out?.unmet) ? out.unmet : [],
      degradedTo: isObject(out?.degradedTo) ? out.degradedTo : {},
      verification: VERIFICATION.includes(out?.verification) ? out.verification : 'adapter-reported',
      reasons,
    }, startedAt);
    if (out?.instanceId) result.instanceId = String(out.instanceId);
    if (out?.targetRevision) result.targetRevision = String(out.targetRevision);
    if (out?.data !== undefined) {
      const errs = d.outputSchema && (status === 'applied' || status === 'noop') ? validate(d.outputSchema, out.data, '/data') : [];
      if (errs.length) result.reasons.push(reason('internal-error', `The adapter's result did not match its outputSchema: ${formatErrors(errs)}`));
      else result.data = out.data;
    }
    // Undo: an app-internal token behind an opaque receipt, offered only when
    // the adapter supports revert and actually returned something to undo.
    if (operation === 'apply' && out?.undo && d.operations.includes('revert') && (status === 'applied' || status === 'partial' || (status === 'failed' && out.effectsKnown))) {
      const receiptId = randomId('receipt');
      receipts.set(receiptId, { reg, token: out.undo.token, scope: out.undo.scope || 'original-target', done: null });
      while (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value);
      result.undo = { available: true, receiptId, scope: out.undo.scope || 'original-target' };
    } else if (operation === 'apply') {
      result.undo = { available: false };
    }
    return result;
  }

  async function adapterApply(args) {
    const startedAt = now();
    const unavailable = (reasons, extra = {}) => ({ isError: true, result: { status: 'unavailable', effectsKnown: true, ...extra, reasons } });
    if (args.profileVersion !== PROFILE_VERSION) {
      return unavailable([reason('profile-version-unsupported', `This provider speaks Adapter MCP ${PROFILE_VERSION}; the request asked for ${args.profileVersion}.`)]);
    }
    const { reg, error } = resolveRef(args.adapterRef, { pinned: true });
    if (error) return unavailable([error]);
    if (args.expectedRevision !== undefined) {
      return unavailable([reason('precondition-unsupported', 'This provider does not check target revisions; send the request without expectedRevision.')]);
    }
    const reasons = [];
    const bad = checkTarget(reg, args.target);
    if (bad) reasons.push(bad);
    reasons.push(...checkDesired(reg, args.desired));
    if (reasons.length) return unavailable(reasons, { target: args.target });

    // Retry deduplication: same key + same arguments returns the same
    // execution; same key + different arguments is refused.
    const canon = canonicalize(args);
    if (typeof args.requestKey === 'string') {
      const at = Date.now();
      for (const [k, v] of executions) if (at - v.at > dedupWindowMs) executions.delete(k);
      const seen = executions.get(args.requestKey);
      if (seen) {
        if (seen.canon !== canon) return unavailable([reason('invalid-parameters', 'This requestKey was already used with different arguments.', 'requestKey')]);
        return seen.response;
      }
    }

    let out;
    try {
      out = await reg.apply({ target: args.target, desired: args.desired, requestKey: args.requestKey }, ctx());
    } catch (e) {
      out = { status: 'failed', effectsKnown: false, reasons: [reason('internal-error', e?.message || String(e))] };
    }
    const result = normalizeOutcome(reg, out, { operation: 'apply', target: args.target, requested: args.desired.parameters ?? {}, startedAt });
    const response = { isError: !(result.status === 'applied' || result.status === 'noop'), result };
    if (typeof args.requestKey === 'string') executions.set(args.requestKey, { canon, response, at: Date.now() });
    return response;
  }

  async function adapterRevert(args) {
    const startedAt = now();
    const receipt = receipts.get(args.receiptId);
    if (!receipt) {
      return { isError: true, result: { operation: 'revert', status: 'unavailable', effectsKnown: true, reasons: [reason('undo-expired', 'This undo receipt is unknown or has expired.')] } };
    }
    if (receipt.done) {
      // Repeating a completed reversal is a no-op, not another inverse.
      return { result: { ...receipt.done, executionId: randomId('execution'), status: 'noop', startedAt: startedAt.toISOString(), finishedAt: now().toISOString() } };
    }
    let out;
    try { out = await receipt.reg.revert({ token: receipt.token, receiptId: args.receiptId }, ctx()); } catch (e) {
      out = { status: 'failed', effectsKnown: false, reasons: [reason('internal-error', e?.message || String(e))] };
    }
    const result = normalizeOutcome(receipt.reg, out, { operation: 'revert', target: out?.target, requested: {}, startedAt });
    if (result.status === 'applied' || result.status === 'noop') receipt.done = result;
    return { isError: !(result.status === 'applied' || result.status === 'noop'), result };
  }

  async function typedApply(reg, args) {
    const d = reg.descriptor;
    let target = args.target;
    if (target === undefined) {
      // A convenience for typed tools only: an omitted target resolves when
      // the adapter enumerates exactly one complete candidate. Anything else
      // is ambiguous, and nothing is chosen silently.
      const found = d.operations.includes('targets') ? await candidatesFor(reg) : { candidates: [], coverage: 'unknown' };
      if (found.candidates.length !== 1 || found.coverage !== 'complete') {
        return { isError: true, result: { status: 'unavailable', effectsKnown: true, reasons: [reason('target-ambiguous', `Name a target for ${d.id}: ${found.candidates.length} candidate(s) are known${found.coverage === 'complete' ? '' : ' and the list may be incomplete'}.`, 'target')] } };
      }
      target = found.candidates[0].target;
    }
    const desired = d.mode === 'stateful'
      ? (args.enabled ? { enabled: true, parameters: args.parameters ?? {} } : { enabled: false })
      : { parameters: args.parameters ?? {} };
    return adapterApply({ profileVersion: PROFILE_VERSION, adapterRef: adapterRefOf(d), target, desired, ...(args.requestKey ? { requestKey: args.requestKey } : {}) });
  }

  const GATEWAY = {
    adapter_list: adapterList,
    adapter_describe: adapterDescribe,
    adapter_targets: adapterTargets,
    adapter_query: adapterQuery,
    adapter_check: adapterCheck,
    adapter_apply: adapterApply,
    adapter_revert: adapterRevert,
  };

  function typedSchema(reg) {
    const d = reg.descriptor;
    const { $schema, $defs, ...params } = d.inputSchema;
    const properties = { parameters: { ...params, description: `Parameters for ${d.name}.` }, target: { ...TARGET_SCHEMA, description: 'Optional when the adapter has exactly one current target.' }, requestKey: { type: 'string', maxLength: 200 } };
    const schema = { type: 'object', properties, additionalProperties: false };
    if (d.mode === 'stateful') {
      properties.enabled = { type: 'boolean', description: 'true turns it on (or updates its parameters); false turns it off.' };
      schema.required = ['enabled'];
    }
    if ($defs) schema.$defs = $defs;
    return schema;
  }

  function toolList() {
    const tools = Object.keys(GATEWAY).map((name) => ({
      name,
      title: name.replace('adapter_', 'Adapter ').replace(/^./, c => c.toUpperCase()),
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: TOOL_SCHEMAS[name].input,
      outputSchema: TOOL_SCHEMAS[name].output,
      // Mutations leave MCP's conservative defaults (destructive, not
      // idempotent): undo support is per adapter and per execution.
      annotations: READ_ONLY.has(name) ? { readOnlyHint: true, openWorldHint: false } : { readOnlyHint: false, openWorldHint: false },
    }));
    for (const [name, reg] of typed) {
      const d = reg.descriptor;
      tools.push({
        name,
        title: d.name,
        description: `${d.name}: ${d.description || 'no description'} (${d.mode === 'stateful' ? 'set enabled to turn it on or off' : 'runs once'}; adapter ${d.appId}/${d.id} v${d.version})`,
        inputSchema: typedSchema(reg),
        outputSchema: TOOL_SCHEMAS.adapter_apply.output,
        annotations: { readOnlyHint: false, openWorldHint: false },
      });
    }
    return tools;
  }

  function toolResult({ result, isError = false }) {
    return { content: [{ type: 'text', text: describeOutcome(result) }], structuredContent: result, isError };
  }

  /**
   * The in-process binding: run one tool with the same checks as MCP.
   * @param {string} name
   * @param {object} [args]
   * @returns {Promise<{content: object[], structuredContent: object, isError: boolean}>}
   */
  async function call(name, args = {}) {
    await ready;
    const typedReg = typed.get(name);
    const schema = typedReg ? typedSchema(typedReg) : TOOL_SCHEMAS[name]?.input;
    if (!schema) {
      const e = new Error(`Unknown tool: ${name}`);
      e.code = -32602;
      throw e;
    }
    const errs = validate(schema, args ?? {}, '');
    if (errs.length) {
      return toolResult({ isError: true, result: { status: 'unavailable', effectsKnown: true, reasons: [reason('invalid-parameters', formatErrors(errs))] } });
    }
    return toolResult(typedReg ? await typedApply(typedReg, args ?? {}) : await GATEWAY[name](args ?? {}));
  }

  /**
   * Answer one MCP JSON-RPC message. Returns the response object, or null for
   * a notification.
   * @param {object} message
   */
  async function handle(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: isObject(message) && 'id' in message ? message.id : null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const notification = !('id' in message);
    const ok = (result) => (notification ? null : { jsonrpc: '2.0', id: message.id, result });
    const fail = (code, msg) => (notification ? null : { jsonrpc: '2.0', id: message.id, error: { code, message: msg } });
    const params = isObject(message.params) ? message.params : {};
    try {
      switch (message.method) {
        case 'initialize': {
          await ready;
          const asked = params.protocolVersion;
          return ok({
            protocolVersion: COMPATIBLE_MCP.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: `${application.appId}-adapters`, title: `${application.name} adapters`, version: application.version },
            instructions: instructions || `Accessibility adapters exported by ${application.name} (Adapter MCP ${PROFILE_VERSION}). Call adapter_list, then adapter_describe for exact parameters, then adapter_apply with the pinned adapterRef. Each apply_<id> tool is a typed shortcut for one adapter.`,
          });
        }
        case 'ping': return ok({});
        case 'tools/list': await ready; return ok({ tools: toolList() });
        case 'tools/call': {
          if (typeof params.name !== 'string') return fail(-32602, 'tools/call needs a tool name');
          try {
            return ok(await call(params.name, isObject(params.arguments) ? params.arguments : {}));
          } catch (e) {
            if (e?.code === -32602) return fail(-32602, e.message);
            throw e;
          }
        }
        default:
          if (message.method.startsWith('notifications/')) return null;
          return fail(-32601, `Method not found: ${message.method}`);
      }
    } catch (e) {
      return fail(-32603, e?.message || 'Internal error');
    }
  }

  return {
    ready,
    handle,
    call,
    advertisement,
    descriptors,
    get application() { return { ...application }; },
    get providerId() { return providerId; },
    set providerId(id) { providerId = id; },
  };
}

/** One plain-language line for an outcome (the text half of a tool result). */
export function describeOutcome(r) {
  if (!r || typeof r !== 'object') return 'No result.';
  if (Array.isArray(r.adapters)) return `${r.adapters.length} adapter(s) from ${r.application?.name || 'this application'}.`;
  if (r.descriptor) return `${r.descriptor.name} (${r.descriptor.appId}/${r.descriptor.id} v${r.descriptor.version}): ${r.descriptor.description || ''}`.trim();
  if (Array.isArray(r.candidates)) return `${r.candidates.length} target(s), coverage ${r.coverage}.`;
  const why = (r.reasons || []).map(x => x.message).join(' ');
  if (r.state) return `State ${r.status}: ${JSON.stringify(r.state)}${why ? ` ${why}` : ''}`;
  if (typeof r.compatible === 'boolean') return r.compatible ? 'This configuration can run now.' : `This configuration cannot run now. ${why}`.trim();
  const what = r.adapterRef ? `${r.adapterRef.id}` : 'Adapter';
  const verb = r.operation === 'revert' ? 'undo' : 'apply';
  return `${what} ${verb}: ${r.status}${r.verification ? ` (${r.verification})` : ''}.${why ? ` ${why}` : ''}`;
}
