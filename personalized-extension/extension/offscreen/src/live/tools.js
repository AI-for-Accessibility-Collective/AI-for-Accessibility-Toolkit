// Tool surface exposed to the Live model — the voice agent's hands. Every
// tool that touches the browser routes through the SW via
// chrome.runtime.sendMessage (this page has no chrome.tabs/scripting); the
// voice* data routes live in extension/voice-routes.js, the librarian*/bh*
// routes in background.js.
//
// Consent model:
//   - adjust_settings / undo_last_change / remember are IMMEDIATE — a spoken
//     request is explicit local user intent, same as tapping the popup. The
//     contract (prompt-enforced) is narrate + undo.
//   - forget_memory / respond_to_proposal are CONFIRM class: the prompt makes
//     the model read the item aloud and get a verbal yes, and a mechanical
//     seen-id gate here refuses ids that this session never fetched via
//     get_memory — a hallucinated or stale id cannot delete anything.
//
// FunctionCall.id is echoed on FunctionResponse by client.js. Each dispatch
// returns one response object; responses are kept compact (the Live context
// is small).

import { settingsMeta } from '../../../../skills/registry.js';
import * as storage from '../storage.js';

const SEND_TIMEOUT_MS = 30000;
const PAGE_ZOOM = { range: [25, 500], description: 'Whole-page zoom percent (magnifies everything; remembered per site). 100 = normal.' };

// ---- generated schema ----------------------------------------------------

function changesSchema() {
  const props = {};
  for (const [key, m] of Object.entries(settingsMeta)) {
    if (m.type === 'boolean') {
      props[key] = { type: 'boolean', description: m.description };
    } else if (m.type === 'number') {
      props[key] = { type: 'number', description: `${m.description} (${m.range[0]}-${m.range[1]})` };
    } else if (m.type === 'enum') {
      props[key] = { type: 'string', enum: m.options, description: m.description };
    }
  }
  props.pageZoom = { type: 'number', description: `${PAGE_ZOOM.description} (${PAGE_ZOOM.range[0]}-${PAGE_ZOOM.range[1]})` };
  return { type: 'object', properties: props };
}

export const TOOL_NAMES = [
  'get_context',
  'adjust_settings',
  'undo_last_change',
  'get_page_content',
  'page_action',
  'start_browser_task',
  'get_browser_status',
  'stop_browser_task',
  'suggest_capabilities',
  'get_memory',
  'remember',
  'forget_memory',
  'respond_to_proposal',
];

export const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: 'get_context',
        description:
          'Snapshot of the current tab: page title/site, page zoom, which accessibility settings are currently on (and which are site-specific), and whether memory is paused. Call before changing settings or when the user asks about the current state.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'adjust_settings',
        description:
          'Change one or more accessibility settings and/or page zoom. Applies immediately to the current page and persists. Batch related changes into ONE call. Afterwards, tell the user what changed and that they can say "undo".',
        parameters: {
          type: 'object',
          properties: {
            changes: changesSchema(),
            scope: {
              type: 'string',
              description:
                "Optional. Only when the user limits the change to a kind of site: 'category:<id>' (e.g. category:news, category:video) or 'origin:<hostname>' (e.g. origin:youtube.com). Omit to change it where its current value lives.",
            },
          },
          required: ['changes'],
        },
      },
      {
        name: 'undo_last_change',
        description:
          'Revert the most recent settings/zoom change made in this voice session. Call again to step further back.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_page_content',
        description:
          "Read the current page so you can answer questions about it. mode 'outline' (default) = title, headings, selected text, and the opening text; mode 'text' = the main text in chunks (pass chunk to continue). Answer only from what it returns.",
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['outline', 'text'], description: "Default 'outline'." },
            chunk: { type: 'number', description: "Chunk index for mode 'text' (0-based)." },
          },
        },
      },
      {
        name: 'page_action',
        description:
          'Perform a quick page action: scroll, click a button or link by its text, type text into the focused field, or move focus. Use this for single-step page interactions. For multi-step tasks (fill a form, navigate across several pages) use start_browser_task instead.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['scroll_down', 'scroll_up', 'page_down', 'page_up', 'top', 'bottom', 'back', 'forward', 'click', 'focus_next_link', 'focus_prev_link', 'focus_next_button', 'type'],
              description: 'The action to perform.',
            },
            target: {
              type: 'string',
              description: "For action 'click': the visible text, value, or aria-label of the element to click.",
            },
            text: {
              type: 'string',
              description: "For action 'type': the text to type into the currently focused field.",
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'start_browser_task',
        description:
          'Start the browser agent on a single concise task. Returns once launched (the agent runs asynchronously; you will receive [Browser update] messages). Call once per user-initiated task.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description:
                'A one-sentence description of what the user wants done, in their words. Example: "find the top trending Python repo on GitHub".',
            },
            use_current_tab: {
              type: 'boolean',
              description:
                'Set true when the task is about the page the user is on ("this page", "here"). Default false = the agent picks or opens a tab.',
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
      {
        name: 'stop_browser_task',
        description: 'Stop the running browser-agent task. Use when the user says stop or cancel.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'suggest_capabilities',
        description:
          "Map what the user says about their abilities or difficulties (e.g. \"I can't read small text\", \"pages overwhelm me\") to concrete settings this extension offers. Read the returned summary aloud and get a yes before applying anything via adjust_settings. Takes a few seconds — tell the user you're checking.",
        parameters: {
          type: 'object',
          properties: {
            need: { type: 'string', description: "The user's own words describing the difficulty or need." },
          },
          required: ['need'],
        },
      },
      {
        name: 'get_memory',
        description:
          "What the extension remembers about this user: profile summary, stored memories (each with an id), and pending suggestions awaiting the user's consent. Optional topic filters by subject.",
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Optional subject filter, e.g. "text size" or "news sites".' },
          },
        },
      },
      {
        name: 'remember',
        description:
          'Record something the user explicitly asked you to remember, in their words. Say back what you will save and get a yes first (unless they dictated it verbatim).',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'The fact to remember, one plain sentence.' },
          },
          required: ['note'],
        },
      },
      {
        name: 'forget_memory',
        description:
          'Permanently delete one memory by id. ONLY after get_memory returned that id in this session AND you read the memory text aloud AND the user explicitly confirmed deletion.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The memory id from get_memory.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'respond_to_proposal',
        description:
          "Resolve a pending suggestion the user has just heard read aloud. 'accept' applies it, 'declineOnce' means not now (asks again after a while), 'suppress' means never suggest this again (confirm that explicitly first).",
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The proposal id from get_memory.' },
            response: { type: 'string', enum: ['accept', 'declineOnce', 'suppress'] },
          },
          required: ['id', 'response'],
        },
      },
    ],
  },
];

// ---- session state ---------------------------------------------------------

// The undo stack lives in the SW (voice-routes.js, chrome.storage.local) so a
// write that lands but whose response is lost stays undoable and survives an
// offscreen teardown. Only the model-facing gates live here. Reset on a fresh
// conversation so it can't undo or delete things approved in a previous one.
const seenMemoryIds = new Set();
const seenProposalIds = new Set();
// id -> memory text, so forget_memory's confirmation chip can name what died.
const seenMemoryText = new Map();

export function resetSessionState() {
  seenMemoryIds.clear();
  seenProposalIds.clear();
  seenMemoryText.clear();
  // Clear the SW-owned undo journal too. Returns the promise so the caller can
  // AWAIT it before opening the new session — otherwise a straggler write from
  // the previous conversation could land after the reset and leak an
  // undoable entry across sessions.
  return sendRuntime({ type: 'voiceResetUndo' }).catch(() => {});
}

// ---- dispatcher --------------------------------------------------------------

export async function dispatchToolCall(name, args, signal) {
  if (signal?.aborted) return { error: 'cancelled' };
  switch (name) {
    case 'get_context':
      return await sendRuntime({ type: 'voiceGetContext' });

    case 'adjust_settings': {
      const changes = (args && typeof args.changes === 'object' && args.changes) || null;
      if (!changes || !Object.keys(changes).length) return { error: 'changes is required (an object of setting: value)' };
      const scope = (args && typeof args.scope === 'string' && args.scope) || null;
      // The SW route journals the undo entry itself (survives a lost response),
      // detects created-vs-updated records so undo can delete what it created,
      // and reports whether the current page received the change live.
      const resp = await sendRuntime({ type: 'voiceApplySettings', changes, scope: scope || undefined });
      if (resp && resp.error) return resp;
      const notes = [];
      if (resp.rejected) notes.push('some keys were invalid or out of range');
      // Honest about the live page: false only when the current tab had no
      // content script to receive it (the change is saved and applies on reload).
      if (resp.liveApplied === false) notes.push('saved, but this page will show it after you reload');
      return {
        applied: resp.applied,
        scopesUsed: resp.scopesUsed,
        appliedToPage: resp.liveApplied !== false,
        ...(resp.rejected ? { rejected: resp.rejected } : {}),
        ...(notes.length ? { note: notes.join('; ') } : {}),
      };
    }

    case 'undo_last_change': {
      // The SW owns the journal: it peeks, reverts to the exact scope/tab, and
      // pops only on success (a failed undo keeps the step).
      const resp = await sendRuntime({ type: 'voiceUndoLast' });
      if (resp && resp.error) return resp;
      return {
        reverted: { ...(resp.reverted || {}) },
        remainingUndos: resp.remainingUndos,
        ...(resp.rejected ? { rejected: resp.rejected } : {}),
      };
    }

    case 'get_page_content':
      return await sendRuntime({
        type: 'voiceReadPage',
        mode: args && args.mode === 'text' ? 'text' : 'outline',
        chunk: (args && Number(args.chunk)) || 0,
      });

    case 'page_action': {
      const action = (args && typeof args.action === 'string') ? args.action : '';
      if (!action) return { error: 'action is required' };
      const target = (args && typeof args.target === 'string') ? args.target : undefined;
      const text = (args && typeof args.text === 'string') ? args.text : undefined;
      return await sendRuntime({ type: 'voicePageAction', action, ...(target !== undefined ? { target } : {}), ...(text !== undefined ? { text } : {}) });
    }

    case 'start_browser_task': {
      const task = (args && typeof args.task === 'string') ? args.task.trim() : '';
      if (!task) return { error: 'no task supplied' };
      const tabMode = args && args.use_current_tab ? 'current' : 'auto';
      const resp = await sendRuntime({ type: 'bhAgentStart', task, tabMode });
      if (resp && resp.error) return { error: resp.error };
      return { status: 'started', task };
    }

    case 'get_browser_status': {
      // Via the storage shim: some Chrome builds don't expose chrome.storage
      // to offscreen docs (the shim falls back to the SW proxy).
      const data = await storage.get('local', 'bhAgent');
      const s = data.bhAgent || {};
      const lastLog = (s.log && s.log.length) ? s.log[s.log.length - 1] : null;
      return {
        task: s.task || null,
        status: s.status || 'idle',
        startedAt: s.startedAt || null,
        endedAt: s.endedAt || null,
        summary: s.summary ? String(s.summary).slice(0, 500) : null,
        error: s.error || null,
        lastLog: lastLog ? { kind: lastLog.kind, text: String(lastLog.text || '').slice(0, 300) } : null,
      };
    }

    case 'stop_browser_task': {
      const resp = await sendRuntime({ type: 'bhAgentStop' });
      if (resp && resp.error) return { error: resp.error };
      return { status: 'stopping' };
    }

    case 'suggest_capabilities': {
      const need = (args && typeof args.need === 'string') ? args.need.trim() : '';
      if (!need) return { error: 'need is required' };
      return await sendRuntime({ type: 'voiceSuggestCapabilities', need });
    }

    case 'get_memory': {
      const resp = await sendRuntime({ type: 'voiceGetMemory', topic: (args && args.topic) || undefined });
      if (resp && !resp.error) {
        for (const m of resp.memories || []) if (m.id) { seenMemoryIds.add(m.id); seenMemoryText.set(m.id, m.text || ''); }
        for (const p of resp.pendingProposals || []) if (p.id) seenProposalIds.add(p.id);
      }
      return resp;
    }

    case 'remember': {
      const note = (args && typeof args.note === 'string') ? args.note.trim() : '';
      if (!note) return { error: 'note is required' };
      const resp = await sendRuntime({
        type: 'librarianLogObservation',
        observation: { type: 'voice', weight: 3, text: `User asked to remember (voice): ${note}`.slice(0, 400) },
      });
      if (resp && resp.error) return { error: resp.error };
      if (resp && resp.logged === false) {
        return { saved: false, reason: resp.reason, note: 'memory is paused, so nothing was saved' };
      }
      return { saved: true, note: 'saved — it will be distilled into long-term memory' };
    }

    case 'forget_memory': {
      const id = (args && typeof args.id === 'string') ? args.id : '';
      if (!seenMemoryIds.has(id)) {
        return { error: 'unknown memory id — call get_memory first, read the memory to the user, and confirm before deleting' };
      }
      const resp = await sendRuntime({ type: 'librarianDeleteMemory', id });
      if (resp && resp.error) return { error: resp.error };
      if (!resp || resp.success !== true) return { error: 'that memory no longer exists' };
      const text = seenMemoryText.get(id) || '';
      seenMemoryIds.delete(id);
      seenMemoryText.delete(id);
      return { deleted: true, id, text };
    }

    case 'respond_to_proposal': {
      const id = (args && typeof args.id === 'string') ? args.id : '';
      const response = args && args.response;
      if (!['accept', 'declineOnce', 'suppress'].includes(response)) {
        return { error: 'response must be accept, declineOnce, or suppress' };
      }
      if (!seenProposalIds.has(id)) {
        return { error: 'unknown proposal id — call get_memory first and read the suggestion to the user before resolving it' };
      }
      const resp = await sendRuntime({ type: 'librarianRespondToProposal', id, response });
      if (resp && resp.error) return { error: resp.error };
      seenProposalIds.delete(id);
      return { resolved: true, response, ...(resp && resp.status ? { status: resp.status } : {}) };
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}

// ---- action chips ----------------------------------------------------------

// Pure phrasing helper for the side panel's action chips. Returns null for
// read-only tools (no chip); {summary, ok, undoable} for state-changing ones.
const KEY_LABELS = {
  fontScale: 'Text size', pageZoom: 'Page zoom', lineHeight: 'Line spacing',
  letterSpacing: 'Letter spacing', speechRate: 'Speech rate',
};

function labelFor(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const m = settingsMeta[key];
  return (m && m.description) || key;
}

function renderValue(key, value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (key === 'fontScale' || key === 'pageZoom') return `${Math.round(Number(value))}%`;
  return String(value);
}

function describeChanges(changes) {
  return Object.entries(changes || {})
    .map(([k, v]) => `${labelFor(k)}: ${renderValue(k, v)}`)
    .join(', ');
}

export function describeAction(name, args, result) {
  if (result && result.error) {
    const failures = {
      adjust_settings: 'Could not change settings',
      undo_last_change: 'Could not undo',
      page_action: 'Could not perform page action',
      start_browser_task: 'Could not start the task',
      stop_browser_task: 'Could not stop the task',
      remember: 'Could not save the memory',
      forget_memory: 'Could not delete the memory',
      respond_to_proposal: 'Could not resolve the suggestion',
    };
    if (!(name in failures)) return null;
    return { summary: `${failures[name]}: ${String(result.error).slice(0, 120)}`, ok: false, undoable: false };
  }
  switch (name) {
    case 'page_action': {
      const result_detail = result && result.detail ? String(result.detail).slice(0, 120) : args && args.action;
      return { summary: `✓ ${result_detail}`, ok: true, undoable: false };
    }
    case 'adjust_settings':
      return { summary: describeChanges(result && result.applied), ok: true, undoable: true };
    case 'undo_last_change':
      return { summary: `Undid: ${describeChanges(result && result.reverted)}`, ok: true, undoable: false };
    case 'start_browser_task':
      return { summary: `Task started: ${String((result && result.task) || '').slice(0, 80)}`, ok: true, undoable: false };
    case 'stop_browser_task':
      return { summary: 'Task stopped', ok: true, undoable: false };
    case 'remember':
      return result && result.saved === false
        ? { summary: 'Not saved — memory is paused', ok: false, undoable: false }
        : { summary: `Remembered: ${String((args && args.note) || '').slice(0, 80)}`, ok: true, undoable: false };
    case 'forget_memory': {
      const t = result && result.text ? String(result.text).slice(0, 80) : '';
      return { summary: t ? `Memory deleted: ${t}` : 'Memory deleted', ok: true, undoable: false };
    }
    case 'respond_to_proposal': {
      const verb = { accept: 'accepted', declineOnce: 'declined for now', suppress: 'turned off' };
      return { summary: `Suggestion ${verb[(args && args.response)] || 'resolved'}`, ok: true, undoable: false };
    }
    default:
      return null; // read-only tools: no chip
  }
}

// The panel's Undo button drives the same SW journal the undo_last_change tool
// uses.
export async function undoLastFromUi() {
  return await dispatchToolCall('undo_last_change', {});
}

// ---- SW messaging ------------------------------------------------------------

function sendRuntime(msg) {
  const call = new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ error: err.message });
      resolve(resp || {});
    });
  });
  // A hung SW call would otherwise hold the Live turn open forever.
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ error: 'tool timed out' }), SEND_TIMEOUT_MS);
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}
