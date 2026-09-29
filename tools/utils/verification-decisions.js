// Shared by both decision surfaces. Keep the answer bound to the finding
// the person actually saw, including its options and task identity.
// Chrome storage can reorder object properties. Identity must survive that
// round trip while retaining the order of the displayed choices.
export const decisionIdentity = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const findingKey = f => `${f.widget}|${f.phase}|${f.say}` + (f.runtime
  ? `|${decisionIdentity([f.runtime.decision, f.runtime.action])}` : '');

export function decisionContext(state) {
  const widget = state?.gate?.leading || state?.gate?.waitingOn?.[0];
  const finding = [...(state?.findings || [])].reverse().find((f) => f.widget === widget);
  const taskId = state?.taskId || null;
  return { widget, finding, taskId, decisionKey: decisionIdentity([
    taskId, widget, finding?.phase, finding?.say || state?.gate?.say,
    finding?.from, finding?.options, finding?.control,
    finding?.runtime,
    state?.observation?.url, state?.observation?.hash,
  ]) };
}

export function decisionChoices(state) {
  const { finding } = decisionContext(state);
  if (finding?.runtime?.decision?.choices?.length) {
    return [...finding.runtime.decision.choices.map(c => ({
      label: c.label, response: c.label, kind: 'runtime', choiceId: c.id,
    })), { label: 'Stop here', response: 'stop', kind: 'stop' }];
  }
  const options = [...new Set((finding?.options || [])
    .filter((o) => typeof o === 'string' && o.trim()))].slice(0, 4);
  const choices = options.map((option) => ({ label: option, response: option, kind: 'option' }));
  if (!choices.length) {
    choices.push(finding?.control?.label
      ? { label: finding.control.label, response: finding.control.label, kind: 'control' }
      : { label: 'Go on', response: 'go on', kind: 'continue' });
  }
  return [...choices, { label: 'Stop here', response: 'stop', kind: 'stop' }];
}

export function decisionPayload(state, choice) {
  const { widget, taskId, decisionKey } = decisionContext(state);
  return { widget, taskId, decisionKey, ...choice };
}

export function decisionMessage(state) {
  const decision = decisionContext(state).finding?.runtime?.decision;
  if (!decision) return state?.gate?.say || 'Something needs your decision.';
  const message = String(decision.message || '').trim();
  const question = String(decision.question || '').trim();
  if (!message) return question;
  if (!question) return message;
  // Older or hand-authored decisions sometimes put the question at the end
  // of the message as well as in `question`. The two fields are joined for
  // speech and the visual gate, so repeating an exact question here is pure
  // noise. Keep the first occurrence and leave the reviewed wording intact.
  const comparable = value => value.replace(/[.!?…]+$/u, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
  const messageComparable = comparable(message), questionComparable = comparable(question);
  return messageComparable === questionComparable || messageComparable.endsWith(` ${questionComparable}`)
    ? message : `${message} ${question}`;
}

export function wireDecisionKeys(root) {
  root.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName !== 'BUTTON') return;
    const buttons = [...root.querySelectorAll('button:not([disabled])')];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  });
}

// The handler owns execution; surfaces supply a choice and its identity only.
export function createDecisionResponder(handlers) {
  const pending = new Set();
  return async (message) => {
    const state = await handlers.getState();
    const context = decisionContext(state);
    const matches = (s) => s?.gate?.allowed === false
      && s.gate.waitingOn?.includes(message.widget)
      && (message.taskId === undefined || message.taskId === (s.taskId || null))
      && (message.decisionKey === undefined || message.decisionKey === decisionContext(s).decisionKey);
    if (!matches(state)) return { resolved: false, stale: true };
    const response = String(message.response || '').trim();
    if (!response) return { resolved: false, empty: true };
    if (message.kind === 'stop' || ['stop', 'stop here'].includes(response.toLowerCase())) {
      await handlers.stop();
      return { stopped: true, resolved: true };
    }
    if (pending.has(context.decisionKey)) return { resolved: false, pending: true };
    pending.add(context.decisionKey);
    try {
      const execution = { taskId: context.taskId,
        tabId: state.observation?.tabId ?? state.opts?.tabId ?? message.tabId,
        isCurrent: async () => matches(await handlers.getState()) };
      const finding = context.finding;
      const control = finding?.control;
      const kind = message.kind || 'custom';
      if (kind === 'runtime') return await handlers.runtime(message, execution);
      if (kind === 'custom' && finding?.runtime) return await handlers.revise(message, execution);
      if (kind === 'option' && !finding?.options?.includes(response)) return { resolved: false, stale: true };
      if (kind === 'control' && response !== control?.label) return { resolved: false, stale: true };
      if (kind === 'continue' && finding?.options?.length) return { resolved: false, stale: true };
      const operation = kind === 'control' ? control?.action : null;
      if (operation === 'hand-over') {
        const result = await handlers.handOver({ ...execution, nodeId: finding.node, reason: response });
        if (result?.stale || result?.handedOver === false) return { resolved: false, ...result };
      } else if (operation === 'watch-value') {
        const result = await handlers.watch({ ...execution, nodeId: finding.node, widget: finding.widget });
        if (!result?.watching) return { resolved: false, error: result?.why || 'Watch could not start.' };
      } else if (operation === 'refine-narrow') {
        // Keep the original hold until the measured choices exist.
        const result = await handlers.refine(execution);
        if (!result) return { resolved: false, error: 'No narrower choices were found.' };
      } else {
        const instruction = kind === 'option' || kind === 'control'
          ? await handlers.instructionFor({ ...control, node: finding?.node,
            widget: message.widget, ...(kind === 'option' ? { option: response } : {}) })
          : null;
        if (instruction?.stale) return { resolved: false, stale: true };
        if (!matches(await handlers.getState())) return { resolved: false, stale: true };
        const result = await handlers.steer(instruction || `About ${message.widget}: the person chose "${response}". Do that before anything else.`, execution);
        if (result?.stale) return { resolved: false, stale: true };
      }
      if (!matches(await handlers.getState())) return { resolved: false, stale: true };
      return await handlers.answer(message.widget, response);
    } finally {
      pending.delete(context.decisionKey);
    }
  };
}
