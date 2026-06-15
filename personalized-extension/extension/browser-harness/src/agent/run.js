// The main agent loop. One iteration = enumerate + screenshot + LLM call
// + execute (possibly multi-action) + post-step health check.

import {
  BH_AGENT_ACTION_TIMEOUT_MS,
  BH_AGENT_KEY,
} from './constants.js';
import {
  _bhAgentOwnedTabs,
  setTabId,
  getTabId,
  setGroupId,
  getGroupId,
  setCreatingTab,
  setStop,
  shouldStop,
  setRunning,
  isRunning,
  setSystemPrompt,
  setLoadedSkills,
  setNavSurface,
  setCurrentMemory,
  setImage,
  setLastInteractiveHashes,
  getLastInteractiveHashes,
  resetRunState,
  getGeminiCaller,
  _bhAgentRead,
  _bhAgentWrite,
  _bhAgentPatch,
  _bhAgentLog,
} from './state.js';
import { _bhBuildSystemPrompt } from './prompt.js';
import { _bhAgentFormatInteractiveList } from './format.js';
import { _bhAgentGroupTab, _bhAgentEnsureUsableTab } from './tabs.js';
import { _bhAgentNotify } from './notify.js';
import {
  _bhAgentExtractBatch,
  _bhAgentCurrentUrlSafe,
  _BH_AGENT_TERMINATES_SEQUENCE,
} from './action-extract.js';
import { _bhWithActionTimeout, _bhClassifyAgentError } from './error.js';
import { _bhAgentAsk } from './ask.js';
import { _bhAgentExec } from './exec.js';
import { _bhAgentCompactHistoryIfNeeded } from './history.js';

// Decide whether a manual run should act on the user's currently open tab or
// open a fresh one. Single LLM round-trip, single-word reply, no streaming.
// Returns {choice: 'current'|'new', reason: string}. Falls back to 'new' on
// any error so the loop never gets stuck waiting for autonomy.
async function _bhDecideTabMode(task, activeTab) {
  const gemini = getGeminiCaller();
  if (!gemini || !activeTab) {
    return { choice: 'new', reason: 'no LLM caller or no active tab' };
  }
  const url = activeTab.url || '';
  const title = (activeTab.title || '').replace(/\s+/g, ' ').slice(0, 200);
  // Don't try to operate on browser-internal pages.
  if (!url || /^(chrome|chrome-extension|edge|about|view-source):/.test(url) || url === 'about:blank') {
    return { choice: 'new', reason: 'current tab is not a real web page' };
  }
  const prompt = `Decide whether a browser-agent task should act on the user's currently open page or open a fresh tab.

Task: """${task}"""

Currently open page URL: ${url}
Currently open page title: ${title}

Reply with exactly one word:
CURRENT — if the task is about this page (e.g. "dismiss the cookie banner", "turn on captions", "summarize this article", or any phrasing implying "the page I'm on").
NEW — if the task names a different site, asks to search or visit something else, or implies starting fresh.

One word only.`;
  let raw;
  try {
    raw = await gemini(prompt, null);
  } catch (e) {
    return { choice: 'new', reason: 'autonomy LLM call failed: ' + e.message };
  }
  const ans = (raw || '').trim().toUpperCase();
  if (ans.startsWith('CURRENT')) {
    return { choice: 'current', reason: 'agent picked current tab' };
  }
  return { choice: 'new', reason: 'agent picked new tab' };
}

/**
 * Run a task to completion. Persists progress to chrome.storage.local.bhAgent.
 * Returns when the loop exits (done / max steps / error / stopped).
 */
export async function bhAgentRun(task, opts = {}) {
  if (isRunning()) throw new Error('agent already running');
  setRunning(true);
  setStop(false);
  setLoadedSkills([]);
  setNavSurface(null);
  setCurrentMemory('');
  setImage(1, 0, 0);
  setLastInteractiveHashes(new Set());
  // Bake the interaction-skills index into the system prompt once at the
  // start of the run -- the names don't change mid-run, so re-listing every
  // turn just spends prompt budget for no information gain.
  let systemPrompt = await _bhBuildSystemPrompt();
  setSystemPrompt(systemPrompt);

  const H = globalThis.BrowserHarness;
  const maxSteps = opts.maxSteps ?? 50;

  // Tab resolution. Three paths in priority order:
  //   1. opts.tabId pinned -> use it directly (no new tab, no autonomy call).
  //   2. opts.tabMode === 'current' -> resolve the active tab and use it.
  //   3. opts.tabMode === 'auto' (default) -> ask the LLM whether the task
  //      should act on the current page or start fresh; act accordingly.
  //   4. opts.tabMode === 'new' (or fallback) -> open a fresh about:blank tab
  //      in the background (active:false) so the user's tab keeps focus.
  // The about:blank path mirrors my_agent.py's original behaviour.
  let tabId = opts.tabId ?? null;
  let openedNewTab = false;
  let usedExistingTab = false;
  let autonomyDecision = null;

  if (tabId == null) {
    let tabMode = opts.tabMode || 'auto';
    let activeTab = null;
    if (tabMode === 'current' || tabMode === 'auto') {
      try {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (t && t.id != null) activeTab = t;
      } catch (_) { /* fall through */ }
      if (!activeTab) tabMode = 'new'; // no current tab to use
    }
    if (tabMode === 'auto') {
      autonomyDecision = await _bhDecideTabMode(task, activeTab);
      tabMode = autonomyDecision.choice;
    }
    if (tabMode === 'current' && activeTab) {
      tabId = activeTab.id;
      usedExistingTab = true;
    } else {
      setCreatingTab(true);
      try {
        const created = await H.newTab('about:blank', { active: false });
        if (!created || created.tabId == null) {
          setRunning(false);
          throw new Error('failed to open new tab');
        }
        tabId = created.tabId;
      } finally {
        setCreatingTab(false);
      }
      openedNewTab = true;
      setGroupId(await _bhAgentGroupTab(tabId, task));
    }
  } else {
    usedExistingTab = true;
  }
  setTabId(tabId);
  _bhAgentOwnedTabs.add(tabId);

  // Demo trace: the Assistant (browser automation agent) starts a one-off task.
  if (globalThis.aaDemoTrace) {
    globalThis.aaDemoTrace('skill', 'user', 'one-off task');
    globalThis.aaDemoTrace('skill', 'assistant', 'Assistant runs task');
    globalThis.aaDemoTrace('skill', 'assistant_perform', task);
  }

  // Personalization: ask the Librarian what it knows about this user and
  // (when acting on an existing page) this site, and fold it into the
  // system prompt. Deterministic fast-lane call — no LLM, milliseconds.
  let recallUrl = null;
  try {
    const t = await chrome.tabs.get(tabId);
    if (t && t.url && !/^(chrome|about):/.test(t.url)) recallUrl = t.url;
  } catch (_) {}
  if (globalThis.Librarian) {
    try {
      const recall = await globalThis.Librarian.recall(recallUrl, task);
      if (recall && recall.block) {
        systemPrompt += '\n\n## User context (from the Librarian\'s memory)\n'
          + recall.block
          + '\nRespect these preferences and known patterns while completing the task.';
        setSystemPrompt(systemPrompt);
      }
    } catch (e) {
      console.warn('[BrowserAgent] librarian recall failed:', e.message);
    }
  }

  const initialLog = [];
  if (autonomyDecision) {
    initialLog.push({ t: Date.now(), kind: 'info', text: `Autonomy: ${autonomyDecision.reason}` });
  }
  let initialText;
  if (openedNewTab) initialText = `Opened new tab (${tabId})`;
  else if (usedExistingTab) initialText = `Acting on existing tab ${tabId}`;
  else initialText = `Starting agent on tab ${tabId}`;
  initialLog.push({ t: Date.now(), kind: 'info', text: initialText });

  await _bhAgentWrite({
    task,
    tabId,
    maxSteps,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    summary: null,
    error: null,
    log: initialLog,
  });

  try {
    await H.attach(tabId);
    const history = [];
    // Carries between iterations: when the previous turn produced a parse
    // error or a failing action, the next prompt echoes the raw output and
    // the error so the model can correct itself instead of aborting the run.
    let pendingError = null;
    let pendingRaw = null;
    for (let step = 0; step < maxSteps; step++) {
      if (shouldStop()) {
        await _bhAgentPatch({ status: 'stopped', endedAt: Date.now() });
        await _bhAgentLog({ kind: 'info', text: 'Stopped by user' });
        _bhAgentNotify('stopped', task, 'Stopped by user');
        return { stopped: true };
      }
      // Always read the live current tab -- open_tab/switch_tab/close_tab
      // may have moved focus during the previous iteration. If every owned
      // tab has been closed since the last step, ensureUsableTab opens a
      // fresh about:blank rather than aborting the run.
      await _bhAgentEnsureUsableTab(task);
      const currentTab = getTabId();
      if (!currentTab) {
        const summary = 'no tabs left';
        await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
        await _bhAgentLog({ kind: 'info', text: summary });
        _bhAgentNotify('done', task, summary);
        return { summary };
      }
      // Tell the harness the agent is mid-step so liveness pings skip --
      // they'd contend for the per-tab CDP queue and false-positive on
      // unresponsive. Cleared at every loop-iteration exit below (catch
      // blocks before continue, and after the success-path health check).
      H.setAgentBusy && H.setAgentBusy(true);

      // Page-stability gate. Wait up to 3s for document.readyState to
      // reach 'complete' before enumerating. Catches the common case
      // where the previous step's action triggered a navigation or
      // heavy DOM mutation that's still settling. waitForLoad returns
      // false on timeout (no throw) so a slow page just yields the
      // best-effort partial state to the LLM, which can use the
      // explicit wait_for_load / wait_for_element / wait actions for
      // longer waits. Mirrors browser_use's spirit of brief auto-wait
      // followed by LLM-driven explicit waits.
      if (H.waitForLoad) {
        try { await H.waitForLoad(currentTab, { timeoutMs: 3000 }); } catch (_) {}
      }
      // Enumerate interactive elements + capture screenshot in parallel.
      // Enumerate caches the live element refs at window.__bhInteractive
      // so a follow-up click_index resolves index → exact DOM center.
      // Both calls are independent CDP work; running them concurrently
      // shaves ~50-200 ms off the per-step cycle.
      // cssNormalize: re-render at CSS-pixel dimensions so the model's
      // pixel coordinates map 1:1 to clickable CSS positions. maxDim caps
      // very-large viewports (>1800 css px) further; the returned `scale`
      // tells us how to convert model coords back to CSS for the click.
      // Screenshot failures (CDP timeout on a slow/heavy page, mid-navigation
      // detach) shouldn't crash the run -- the interactive list alone is
      // enough for the LLM to choose a next action, and the next step gets
      // another shot. Mirrors the enumerate fallback above.
      let shotErr = null;
      const [enumResult, shot] = await Promise.all([
        H.enumerateInteractive
          ? H.enumerateInteractive(currentTab).catch(() => null)
          : Promise.resolve(null),
        H.captureScreenshot(currentTab, { maxDim: 1800, cssNormalize: true }).catch((e) => {
          shotErr = e.message || String(e);
          return null;
        }),
      ]);
      if (shotErr) {
        await _bhAgentLog({
          kind: 'info',
          step: step + 1,
          text: `Screenshot skipped this step: ${shotErr}`,
        });
      }
      const items = (enumResult && Array.isArray(enumResult.items)) ? enumResult.items : [];
      const rawScreenshot = typeof shot === 'string' ? shot : shot.data;
      const imgScale = (shot && typeof shot === 'object' && shot.scale) || 1;
      const imgWidth = (shot && typeof shot === 'object' && shot.width) || 0;
      const imgHeight = (shot && typeof shot === 'object' && shot.height) || 0;
      setImage(imgScale, imgWidth, imgHeight);
      // Draw numbered highlight boxes onto the screenshot so the LLM can
      // pick elements by index. drawHighlights returns the original PNG
      // unchanged if items is empty or the canvas decode failed.
      let screenshot = rawScreenshot;
      if (items.length && H.drawHighlights) {
        try {
          screenshot = await H.drawHighlights(rawScreenshot, items, { scale: imgScale });
        } catch (e) {
          console.warn('[BrowserAgent] drawHighlights failed:', e.message);
          screenshot = rawScreenshot;
        }
      }
      // Format the interactive elements as a textual tree for the prompt.
      // Mirrors browser_use's <browser_state> Interactive Elements block.
      // The tree is the LLM's source of truth for which indexes exist;
      // the screenshot overlay is the visual confirmation. Structural
      // containers (<form>, <ul>, etc. with ≥2 indexed descendants) are
      // emitted as un-indexed grouping lines.
      const structurals = (enumResult && Array.isArray(enumResult.structurals)) ? enumResult.structurals : [];
      const fmt = _bhAgentFormatInteractiveList(items, structurals, getLastInteractiveHashes());
      const interactiveListText = fmt.text;
      setLastInteractiveHashes(fmt.hashes);

      let response;
      try {
        response = await _bhAgentAsk(task, screenshot, history, { pendingError, pendingRaw, interactiveListText });
      } catch (parseErr) {
        // Couldn't decode the LLM response. Echo it back next turn so the
        // model self-corrects (most often: stripped JSON fences, extra prose,
        // truncated output).
        const raw = parseErr.rawText || '';
        pendingError = parseErr.message || String(parseErr);
        pendingRaw = raw || null;
        await _bhAgentLog({
          kind: 'error',
          step: step + 1,
          text: `Couldn't parse response, retrying: ${pendingError}`,
        });
        H.setAgentBusy && H.setAgentBusy(false);
        continue;
      }

      // Carry the latest memory forward so the next prompt's "Current
      // memory" block reflects this turn even before the history rendering
      // includes it. Defensive: keep the prior memory if the model omitted
      // the field rather than blanking it out.
      if (typeof response.memory === 'string' && response.memory.trim()) {
        setCurrentMemory(response.memory.trim());
      }

      // Multi-action support. The LLM may emit a single action ({action,
      // ...}) or a batch ({actions: [{action, ...}, ...]}). Iterate with
      // page-change guards: a page-changing action or URL change between
      // sub-actions aborts the batch. Mirrors browser_use's multi_act.
      const { actions: batch, meta } = _bhAgentExtractBatch(response);
      if (!batch.length) {
        pendingError = 'response missing both `action` and `actions`';
        pendingRaw = JSON.stringify(response).slice(0, 1200);
        await _bhAgentLog({ kind: 'error', step: step + 1, text: pendingError });
        H.setAgentBusy && H.setAgentBusy(false);
        continue;
      }

      let preUrl = await _bhAgentCurrentUrlSafe(currentTab);
      let prevTabId = getTabId();
      let result = null;
      let aborted = false;
      let terminalError = null;

      for (let ai = 0; ai < batch.length; ai++) {
        const sub = batch[ai];
        // The first sub-action carries the meta fields so the history
        // renderer shows evaluation_previous_goal / next_goal next to the
        // first action of the turn.
        const turn = (ai === 0)
          ? { ...meta, ...sub, t: Date.now(), batchIdx: ai, batchSize: batch.length }
          : { ...sub, t: Date.now(), batchIdx: ai, batchSize: batch.length };
        history.push(turn);
        await _bhAgentLog({
          kind: 'action',
          step: step + 1,
          action: sub.action,
          text: (batch.length > 1 ? `[${ai + 1}/${batch.length}] ` : '') + (sub.reason || sub.summary || meta.next_goal || JSON.stringify(sub)),
        });

        try {
          result = await _bhWithActionTimeout(
            sub.action || 'unknown',
            BH_AGENT_ACTION_TIMEOUT_MS,
            () => _bhAgentExec(getTabId(), sub, task),
          );
          if (result && 'extracted' in result) turn.extracted = result.extracted;
        } catch (execErr) {
          const { kind, msg } = _bhClassifyAgentError(execErr);
          turn.error = msg;
          if (kind === 'terminal') {
            terminalError = msg;
          } else {
            pendingError = kind === 'timeout' ? `[timeout] ${msg}` : `[transient] ${msg}`;
            pendingRaw = JSON.stringify(sub);
            const skip = batch.length - ai - 1;
            await _bhAgentLog({
              kind: 'error',
              step: step + 1,
              text: `Action ${batch.length > 1 ? `[${ai + 1}/${batch.length}] ` : ''}failed${skip > 0 ? ` (skipping ${skip} remaining)` : ''}: ${pendingError}`,
            });
          }
          aborted = true;
          break;
        }

        // done() is the explicit terminate signal -- stop the batch.
        if (result && !result.keepGoing) break;

        // Static page-change guard: actions whose effect is always
        // page-changing terminate the rest of the batch.
        if (ai < batch.length - 1 && _BH_AGENT_TERMINATES_SEQUENCE.has(sub.action)) {
          const skip = batch.length - ai - 1;
          await _bhAgentLog({
            kind: 'info',
            step: step + 1,
            text: `Action ${sub.action} terminates sequence; skipping ${skip} remaining.`,
          });
          break;
        }

        // Runtime page-change guard: if URL or active tab changed mid-
        // batch, the indexes the LLM emitted are stale. Abort.
        if (ai < batch.length - 1) {
          const postUrl = await _bhAgentCurrentUrlSafe(getTabId());
          const tabChanged = getTabId() !== prevTabId;
          const urlChanged = postUrl && preUrl && postUrl !== preUrl;
          if (urlChanged || tabChanged) {
            const skip = batch.length - ai - 1;
            await _bhAgentLog({
              kind: 'info',
              step: step + 1,
              text: `${tabChanged ? 'Active tab' : 'URL'} changed mid-batch; skipping ${skip} remaining.`,
            });
            break;
          }
          preUrl = postUrl || preUrl;
          prevTabId = getTabId();
          // Inter-action gap so framework state settles between sub-actions.
          await H.wait(500);
        }
      }

      if (terminalError) {
        await _bhAgentPatch({ status: 'error', endedAt: Date.now(), error: terminalError });
        await _bhAgentLog({ kind: 'error', step: step + 1, text: `Terminal: ${terminalError}` });
        _bhAgentNotify('error', task, terminalError);
        H.setAgentBusy && H.setAgentBusy(false);
        return { error: terminalError };
      }
      if (aborted) {
        H.setAgentBusy && H.setAgentBusy(false);
        continue;
      }
      // Use the LAST sub-action that ran for the post-batch logic below
      // (it's the one whose result determines done/keepGoing). The meta
      // 'action' is unused at this point but kept for log fidelity.
      const action = batch[batch.length - 1];

      // Health watchdog read. Crash recovery resets the tabId so the
      // top-of-loop ensureUsableTab opens a fresh about:blank next iteration.
      // Unresponsive surfaces as a [transient] retry signal; networkStall
      // is informational only since wait_for_network_idle covers actionable
      // cases. Mirrors browser_use crash_watchdog/dom_watchdog observations.
      const health = (H.healthSnapshot && H.healthSnapshot(currentTab)) || {};
      if (health.crashed) {
        if (H.healthClear) H.healthClear(currentTab);
        _bhAgentOwnedTabs.delete(currentTab);
        if (getTabId() === currentTab) setTabId(null);
        pendingError = '[browser_crashed] Tab crashed; opened a fresh tab.';
        pendingRaw = null;
        await _bhAgentLog({
          kind: 'error',
          step: step + 1,
          text: pendingError,
        });
        H.setAgentBusy && H.setAgentBusy(false);
        continue;
      }
      if (health.unresponsive) {
        if (H.healthClear) H.healthClear(currentTab);
        pendingError = '[browser_unresponsive] Tab failed liveness pings.';
        pendingRaw = null;
        await _bhAgentLog({
          kind: 'error',
          step: step + 1,
          text: pendingError,
        });
        H.setAgentBusy && H.setAgentBusy(false);
        continue;
      }
      if (health.networkStall) {
        await _bhAgentLog({
          kind: 'info',
          step: step + 1,
          text: `Network stall: oldest in-flight request ${Math.round(health.networkStall / 1000)}s old.`,
        });
      }

      // After every successful step, see if rendered history is over the
      // soft budget; if so, summarise the bulk into a single compacted
      // entry. Mirrors browser-use's MessageManager.maybe_compact_messages.
      await _bhAgentCompactHistoryIfNeeded(history, task);

      H.setAgentBusy && H.setAgentBusy(false);
      pendingError = null;
      pendingRaw = null;
      if (!result.keepGoing) {
        const summary = result.summary || action.summary || 'task complete';
        await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
        await _bhAgentLog({ kind: 'done', text: summary });
        _bhAgentNotify('done', task, summary);
        _bhAgentObserveOutcome(task, summary, true);
        return { summary };
      }
    }
    const summary = `reached max steps (${maxSteps})`;
    await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
    await _bhAgentLog({ kind: 'info', text: summary });
    _bhAgentNotify('done', task, summary);
    _bhAgentObserveOutcome(task, summary, false);
    return { summary };
  } catch (e) {
    const msg = e.message || String(e);
    await _bhAgentPatch({ status: 'error', endedAt: Date.now(), error: msg });
    await _bhAgentLog({ kind: 'error', text: msg });
    _bhAgentNotify('error', task, msg);
    throw e;
  } finally {
    // Detach the chrome.debugger session from every tab the run
    // touched, so the "Chrome is being debugged by an extension"
    // banner clears as soon as the agent stops. Snapshot the set
    // before the resetRunState() call below so we still have the tabIds.
    const Hf = globalThis.BrowserHarness;
    const tabsToDetach = Array.from(_bhAgentOwnedTabs);
    if (Hf && Hf.detach) {
      for (const t of tabsToDetach) {
        try { await Hf.detach(t); } catch (_) {}
      }
    }
    resetRunState();
    if (Hf && Hf.setAgentBusy) Hf.setAgentBusy(false);
  }
}

// Feed the run outcome to the Librarian as an episodic observation. The
// Librarian decides (LLM-gated, suppression-aware) whether anything durable
// comes of it. Fire-and-forget: a memory failure must never fail a run.
function _bhAgentObserveOutcome(task, summary, success) {
  const L = globalThis.Librarian;
  if (!L) return;
  (async () => {
    let url = null;
    try {
      const tabId = getTabId();
      if (tabId) {
        const t = await chrome.tabs.get(tabId);
        if (t && t.url && !/^(chrome|about):/.test(t.url)) url = t.url;
      }
    } catch (_) {}
    await L.logObservation({
      type: 'agent-task',
      url,
      text: `Agent task "${task}" finished ${success ? 'successfully' : 'without completing'}: ${summary}`,
      data: { task, summary, success },
    });
  })().catch(() => {});
}

export function bhAgentStop() { setStop(true); }
export function bhAgentIsRunning() { return isRunning(); }

export async function bhAgentClear() {
  await chrome.storage.local.remove(BH_AGENT_KEY);
}
