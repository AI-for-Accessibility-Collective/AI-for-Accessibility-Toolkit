// Tool surface exposed to the Live model. Two tools only -- this is the
// "explain mode" scope; control beyond starting a task is deliberately
// out of scope.
//
//   start_browser_task(task)   - kicks off BrowserAgent.run(task) in the SW
//   get_browser_status()       - returns the latest persisted bhAgent snapshot
//
// FunctionCall.id MUST be echoed back on FunctionResponse for the Gemini
// Developer API. Each dispatch returns a single response (no streaming);
// for long-running calls we'd use will_continue=true, but neither tool
// here qualifies.

export const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: 'start_browser_task',
        description:
          'Start the browser agent on a single concise task. Returns once the task has been launched (the agent runs asynchronously after this call). Call this once per user-initiated task; do NOT call it again to "stop" or "redirect" -- you have no such capability.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description:
                'A one-sentence description of what the user wants done, in their words. Example: "find the top trending Python repo on GitHub".',
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'get_browser_status',
        description:
          'Read the current browser-agent state. Use when the user asks what is happening or you need to confirm a state before responding. Returns task, status, and the last log entry.',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
];

// Dispatcher. tools.js only knows the tool names + the SW message API; it
// does not import bridge/state directly so it stays testable.
export async function dispatchToolCall(name, args) {
  switch (name) {
    case 'start_browser_task': {
      const task = (args && typeof args.task === 'string') ? args.task.trim() : '';
      if (!task) return { error: 'no task supplied' };
      const resp = await sendRuntime({ type: 'bhAgentStart', task });
      if (resp && resp.error) return { error: resp.error };
      return { status: 'started', task };
    }
    case 'get_browser_status': {
      const data = await chrome.storage.local.get('bhAgent');
      const s = data.bhAgent || {};
      const lastLog = (s.log && s.log.length) ? s.log[s.log.length - 1] : null;
      return {
        task: s.task || null,
        status: s.status || 'idle',
        startedAt: s.startedAt || null,
        endedAt: s.endedAt || null,
        summary: s.summary || null,
        error: s.error || null,
        lastLog: lastLog ? { kind: lastLog.kind, text: lastLog.text } : null,
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

function sendRuntime(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ error: err.message });
      resolve(resp || {});
    });
  });
}
