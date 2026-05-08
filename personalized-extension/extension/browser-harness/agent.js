/* Browser-agent loop -- service-worker side.
 *
 * Adapted from webapp/browser-harness/my_agent.py for chrome.debugger inside
 * the extension's service worker. Persists progress to
 * chrome.storage.local.bhAgent so popup/page UIs can render the live log
 * without holding any state of their own (the popup dies on close; the
 * service worker keeps the loop running).
 *
 * Loaded by background.js via importScripts. Exposes:
 *   globalThis.BrowserAgent.run(task, opts)
 *   globalThis.BrowserAgent.stop()
 *   globalThis.BrowserAgent.clear()
 *   globalThis.BrowserAgent.setGeminiCaller(fn)
 *
 * Background.js wires setGeminiCaller(callGemini) once after import, so this
 * file doesn't need to re-implement the API call.
 */

const BH_AGENT_KEY = 'bhAgent';
const BH_AGENT_LOG_LIMIT = 200;

const BH_AGENT_SYSTEM_PROMPT_BASE = `You are a browser agent. You see a screenshot of a web page and decide what action to take next.

Every response is ONE JSON object with these required fields plus the action-specific fields:

{
  "evaluation_previous_goal": "what happened on the last step -- did the previous action work? empty on the first turn.",
  "memory": "everything you want to carry forward: task constraints, user-supplied data, what you've extracted, what's left to do, errors. Reuse and extend the prior memory; don't drop facts.",
  "next_goal": "the single concrete thing you're about to do",
  "action": "<action name>", "reason": "...",
  ...action-specific fields...
}

Action shapes:

{"action": "click", "x": 340, "y": 200, "reason": "clicking the search bar"}
{"action": "type", "text": "hello world", "reason": "typing search query"}
{"action": "fill_input", "selector": "input[name=email]", "text": "user@example.com", "reason": "framework-managed input -- type would bypass React's onChange"}
{"action": "press_key", "key": "Enter", "reason": "submitting the form"}
{"action": "scroll", "x": 600, "y": 400, "dy": -300, "reason": "scrolling down to see more"}
{"action": "navigate", "url": "https://example.com", "reason": "going to the target page"}
{"action": "navigate", "url": "https://amazon.com/cart", "read_skills": ["cart"], "reason": "going to the cart and pre-loading the cart playbook in one step"}
{"action": "wait", "seconds": 2, "reason": "waiting for page to load"}
{"action": "wait_for_element", "selector": "#submit-btn", "visible": true, "reason": "SPA route just changed -- waiting for the submit button to render"}
{"action": "wait_for_network_idle", "reason": "form just submitted, waiting for XHR to settle"}
{"action": "handle_dialog", "accept": true, "reason": "page popped a confirm() -- clicking OK"}
{"action": "js", "code": "document.title", "reason": "checking what page we're on"}
{"action": "js", "code": "Array.from(document.querySelectorAll('h2.product-title')).map(h => h.textContent.trim())", "reason": "extracting the product titles for memory"}
{"action": "open_tab", "url": "https://example.com", "read_skills": ["scraping"], "reason": "opening a second tab and pre-loading its scraping playbook"}
{"action": "switch_tab", "tab": 1, "reason": "going back to the first tab to copy the value"}
{"action": "close_tab", "tab": 2, "reason": "no longer need the comparison tab"}
{"action": "read_skill", "kind": "domain", "name": "cart", "host": "amazon", "reason": "loading the playbook for the current site"}
{"action": "read_skill", "kind": "interaction", "name": "dialogs", "reason": "loading the generic dialogs guide"}
{"action": "write_skill", "kind": "domain", "name": "checkout-trick", "host": "etsy", "content": "# Etsy checkout\\nThe Pay button is keyboard-only; ...", "reason": "saving what I learned for next time"}
{"action": "done", "summary": "task complete -- here's what I found: ..."}

Rules:
- Always respond with a single JSON object, nothing else. Include evaluation_previous_goal, memory, next_goal on every turn.
- "memory" is your long-running scratchpad. The previous turn's memory is shown above as "Current memory"; treat it as your starting point and rewrite a complete, updated version each turn. Don't drop facts unless they're truly stale.
- Use "reason" to explain your thinking for this single action.
- After clicking or typing, you'll get a new screenshot to verify.
- If you see a login wall, respond with {"action": "done", "summary": "Hit a login wall -- need to sign in first."}
- Coordinates and scroll deltas are pixel positions on the screenshot you see (top-left origin, x right, y down). Read them directly off the image; the harness handles the conversion to CSS pixels.
- "tab" indices match the "Tabs" list in each turn. You only see and control tabs you opened in this run; the user's other tabs are not accessible.
- Domain skills are surfaced once, in the turn AFTER you navigate/open_tab to a host. Either read them via read_skill or pre-load with navigate's read_skills field. Save what you learn with write_skill so future runs benefit.
- Prefer fill_input over type for any form field on a real site -- type uses Input.insertText which bypasses React/Vue change tracking and leaves submit buttons disabled.
- After submits or SPA route changes, wait_for_element or wait_for_network_idle before the next action; document.readyState is "complete" before the framework finishes rendering.
- If the screenshot or pageInfo shows {"dialog": ...}, the page's JS thread is frozen -- handle_dialog before doing anything else.
- Use "js" to extract structured data (titles, lists, attributes, JSON from the page). The return value is recorded in the history and visible to you on the next turn -- preferable to remembering it in "memory" by hand for anything large.`;

// Built once at run start by _bhBuildSystemPrompt -- prepends the static
// base with the live interaction-skills index so the names appear once in
// the system prompt rather than every turn.
let _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
let _bhAgentNavSurface = null; // {host, skills} consumed once in next prompt

let _bhGeminiCall = null;
let _bhAgentStop = false;
let _bhAgentRunning = false;
let _bhAgentTabId = null;        // currently-active tab the loop drives
const _bhAgentOwnedTabs = new Set(); // every tab this run has opened
let _bhAgentGroupId = null;      // shared group so new tabs join the run's group
let _bhAgentCreatingTab = false; // suppresses swallow during our own newTab()
const _bhAgentSwallow = new Set();
let _bhAgentLoadedSkills = []; // per-run skill content the LLM has explicitly loaded
const BH_AGENT_LOADED_SKILLS_MAX = 5;
const BH_AGENT_SKILL_INLINE_MAX = 8000; // cap per-skill payload included in prompt

// Latest "memory" string the LLM emitted. Carried into every subsequent
// prompt as "Current memory" so the model has a forwarding scratchpad
// that doesn't depend on history rendering.
let _bhAgentCurrentMemory = '';

// Image-pixels-per-CSS-pixel of the latest screenshot. The agent reads
// click/scroll coordinates off the screenshot (image-pixel space); CDP's
// Input.dispatchMouseEvent expects CSS pixels. Divide by this to convert.
// Set after every captureScreenshot in the run loop.
let _bhAgentImageScale = 1;
let _bhAgentImageWidth = 0;
let _bhAgentImageHeight = 0;

// Compaction: when the rendered history grows past this many characters,
// fire one extra Gemini call to summarise the bulk of it. Mirrors
// browser-use's MessageManager.maybe_compact_messages (default 40k); we
// pick a slightly tighter threshold to leave headroom for screenshot +
// loaded skills + tabs context in the prompt.
const BH_AGENT_HISTORY_CHAR_THRESHOLD = 30000;
// After compaction, keep the original step (task framing) plus this many
// most-recent steps verbatim. Everything in between is replaced with a
// single synthetic "compacted_history" entry whose memory holds the
// summary. Subsequent turns see: step 1 + summary + last N + this turn.
const BH_AGENT_HISTORY_KEEP_TAIL = 3;
// Per-history-entry cap on `extracted` payload included in the prompt.
// Prevents a single js() call returning a giant blob from blowing the
// next turn's budget.
const BH_AGENT_EXTRACTED_INLINE_MAX = 1500;

function bhAgentSetGeminiCaller(fn) { _bhGeminiCall = fn; }

async function _bhAgentRead() {
  const cur = await chrome.storage.local.get(BH_AGENT_KEY);
  return cur[BH_AGENT_KEY] || { task: '', status: 'idle', log: [] };
}

async function _bhAgentWrite(state) {
  await chrome.storage.local.set({ [BH_AGENT_KEY]: state });
}

async function _bhAgentPatch(patch) {
  const state = await _bhAgentRead();
  Object.assign(state, patch);
  await _bhAgentWrite(state);
}

async function _bhAgentLog(entry) {
  const state = await _bhAgentRead();
  state.log = (state.log || []).concat({ t: Date.now(), ...entry }).slice(-BH_AGENT_LOG_LIMIT);
  await _bhAgentWrite(state);
}

// Truncate without slicing through grapheme clusters mid-word -- notifications
// clip silently otherwise. Chrome shows ~140 chars in the body.
function _bhAgentTruncate(s, n = 220) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Google brand colors -- chrome.tabGroups.Color includes all four, so we get
// a faithful Google palette without any custom-color hack. Cycle through
// them per run so successive agent groups are visually distinct.
const BH_AGENT_GROUP_COLORS = ['blue', 'red', 'yellow', 'green'];
const BH_AGENT_COLOR_KEY = 'bhAgentNextColor';

async function _bhAgentGroupTab(tabId, task, existingGroupId = null) {
  if (!chrome.tabs?.group || !chrome.tabGroups?.update) return null;
  try {
    const groupId = existingGroupId != null
      ? await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroupId })
      : await chrome.tabs.group({ tabIds: [tabId] });
    if (existingGroupId == null) {
      const data = await chrome.storage.local.get(BH_AGENT_COLOR_KEY);
      const idx = (data[BH_AGENT_COLOR_KEY] || 0) % BH_AGENT_GROUP_COLORS.length;
      await chrome.storage.local.set({ [BH_AGENT_COLOR_KEY]: idx + 1 });
      await chrome.tabGroups.update(groupId, {
        title: _bhAgentTruncate(task, 40),
        color: BH_AGENT_GROUP_COLORS[idx],
      });
    }
    return groupId;
  } catch (e) {
    console.warn('[BrowserAgent] group tab failed:', e.message);
    return null;
  }
}

function _bhAgentNotify(outcome, task, message) {
  if (!chrome.notifications || !chrome.notifications.create) return;
  const titles = {
    done: 'Browser agent finished',
    error: 'Browser agent failed',
    stopped: 'Browser agent stopped',
  };
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: titles[outcome] || 'Browser agent',
      message: _bhAgentTruncate(`${task}\n\n${message || ''}`),
      priority: outcome === 'error' ? 2 : 1,
    });
  } catch (e) {
    console.warn('[BrowserAgent] notify failed:', e.message);
  }
}

// target=_blank / window.open spawns a new tab whose openerTabId points
// back to ours. Rather than chasing the new target with a fresh CDP
// attach, redirect the URL into the existing agent tab and close the
// popup -- keeps one debugger session, one screenshot stream, and stops
// the loop from re-clicking the same link forever.
async function _bhAgentRedirectInto(newTabId, url) {
  if (!_bhAgentTabId) return;
  try {
    await globalThis.BrowserHarness.gotoUrl(_bhAgentTabId, url);
    try { await chrome.tabs.remove(newTabId); } catch {}
    await _bhAgentLog({ kind: 'info', text: `Caught popup → ${url}` });
  } catch (e) {
    console.warn('[BrowserAgent] redirect failed:', e.message);
  }
}

function _bhAgentOnTabCreated(tab) {
  if (!_bhAgentRunning || _bhAgentCreatingTab) return;
  if (_bhAgentOwnedTabs.has(tab.id)) return;
  // Only swallow popups whose opener is one of the agent's tabs --
  // user-initiated tabs in other windows are left alone.
  if (!_bhAgentOwnedTabs.has(tab.openerTabId)) return;
  _bhAgentSwallow.add(tab.id);
  const url = tab.pendingUrl || tab.url;
  if (url && url !== 'about:blank' && url !== 'chrome://newtab/') {
    _bhAgentSwallow.delete(tab.id);
    _bhAgentRedirectInto(tab.id, url);
  }
}

function _bhAgentOnTabUpdated(tabId, changeInfo) {
  if (!_bhAgentSwallow.has(tabId)) return;
  const url = changeInfo.url || changeInfo.pendingUrl;
  if (!url || url === 'about:blank' || url === 'chrome://newtab/') return;
  _bhAgentSwallow.delete(tabId);
  _bhAgentRedirectInto(tabId, url);
}

function _bhAgentOnTabRemoved(tabId) {
  _bhAgentOwnedTabs.delete(tabId);
  _bhAgentSwallow.delete(tabId);
  if (_bhAgentTabId === tabId) {
    // If the user closed the agent's current tab, fall back to any other
    // owned tab so the loop has somewhere to keep working.
    const fallback = _bhAgentOwnedTabs.values().next().value;
    _bhAgentTabId = fallback || null;
  }
}

if (chrome.tabs?.onCreated && !chrome.tabs.onCreated._bhAgentInstalled) {
  chrome.tabs.onCreated.addListener(_bhAgentOnTabCreated);
  chrome.tabs.onUpdated.addListener(_bhAgentOnTabUpdated);
  chrome.tabs.onRemoved.addListener(_bhAgentOnTabRemoved);
  chrome.tabs.onCreated._bhAgentInstalled = true;
}

function _bhAgentParseAction(text) {
  let s = (text || '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }
  try {
    return JSON.parse(s);
  } catch (e) {
    // Carry the raw LLM output on the error so the loop can echo it back to
    // the model on the retry prompt -- "you said X, here's what's wrong".
    const err = new Error(`response was not valid JSON: ${e.message}`);
    err.rawText = text;
    throw err;
  }
}

async function _bhAgentTabsContext() {
  // Re-read fresh title/url for every owned tab. Also normalises indices so
  // the LLM gets stable `[N]` references that line up with what we'll match
  // back when it issues switch_tab/close_tab.
  const tabs = [];
  let activeIdx = -1;
  for (const id of _bhAgentOwnedTabs) {
    try {
      const t = await chrome.tabs.get(id);
      const idx = tabs.length;
      if (id === _bhAgentTabId) activeIdx = idx;
      tabs.push({ idx, tabId: id, title: t.title || '', url: t.url || '' });
    } catch {
      // Tab vanished between our last bookkeeping and now -- drop it silently.
      _bhAgentOwnedTabs.delete(id);
    }
  }
  return { tabs, activeIdx };
}

async function _bhBuildSystemPrompt() {
  const Skills = globalThis.BrowserSkills;
  if (!Skills) return BH_AGENT_SYSTEM_PROMPT_BASE;
  const interaction = await Skills.listInteraction().catch(() => []);
  if (!interaction.length) return BH_AGENT_SYSTEM_PROMPT_BASE;
  return BH_AGENT_SYSTEM_PROMPT_BASE
    + '\n\nInteraction skills available (load any with read_skill kind="interaction"): '
    + interaction.join(', ') + '.';
}

function _bhAgentHostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Inject an animated SVG arrow cursor + red ripple at the given CSS-pixel
// position into the *live page* (not the screenshot) so a human watching
// the browser can see exactly where the agent clicked. pointer-events
// is set to none so the marker can't intercept any subsequent input the
// agent dispatches. Fire-and-forget: any injection failure (CSP, frozen
// dialog thread) is swallowed.
async function _bhAgentShowPageCursor(tabId, cssX, cssY) {
  const H = globalThis.BrowserHarness;
  if (!H || !H.js) return;
  const x = Number(cssX) | 0;
  const y = Number(cssY) | 0;
  const arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 19" width="22" height="32">'
    + '<path d="M 0 0 L 0 17 L 5 13 L 8 19 L 10 18 L 7 12 L 13 12 Z" fill="white" stroke="black" stroke-width="1"/>'
    + '</svg>';
  // Self-contained injection: builds + animates + cleans up. Uses
  // dataset.bhAgent so an external observer can recognise our overlays.
  const expr = `(()=>{
    const x=${x}, y=${y};
    const cur=document.createElement('div');
    cur.dataset.bhAgent='cursor';
    cur.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:22px;height:32px;pointer-events:none;z-index:2147483647;transform:scale(1.4);transform-origin:0 0;transition:opacity .55s ease-out, transform .55s ease-out;opacity:0;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45));';
    cur.innerHTML=${JSON.stringify(arrowSvg)};
    const rip=document.createElement('div');
    rip.dataset.bhAgent='ripple';
    rip.style.cssText='position:fixed;left:'+(x-14)+'px;top:'+(y-14)+'px;width:28px;height:28px;border-radius:50%;background:rgba(234,67,53,.55);box-shadow:0 0 0 2px rgba(234,67,53,.85);pointer-events:none;z-index:2147483646;transform:scale(.4);opacity:0;transition:transform .5s ease-out, opacity .5s ease-out;';
    document.documentElement.appendChild(rip);
    document.documentElement.appendChild(cur);
    requestAnimationFrame(()=>{
      cur.style.opacity='1'; cur.style.transform='scale(1)';
      rip.style.opacity='1'; rip.style.transform='scale(2)';
      setTimeout(()=>{
        cur.style.opacity='0'; rip.style.opacity='0';
        setTimeout(()=>{ cur.remove(); rip.remove(); }, 650);
      }, 1100);
    });
  })()`;
  try { await H.js(tabId, expr); } catch {}
}

// Consumes _bhAgentNavSurface exactly once. Mirrors browser-harness-orig's
// goto_url() return value: domain skills appear in the turn after navigation
// and aren't repeated. The model can re-navigate or use read_skill if it
// wants the names back later.
async function _bhAgentConsumeNavSurface() {
  const surface = _bhAgentNavSurface;
  _bhAgentNavSurface = null;
  if (!surface) return '';
  if (!surface.skills || !surface.skills.length) {
    return `Just navigated to ${surface.host}. No domain skills indexed for this host.`;
  }
  return `Just navigated to ${surface.host}. Domain skills available (load with read_skill kind="domain", host="${surface.host}"): ${surface.skills.join(', ')}.`;
}

function _bhAgentLoadedSkillsBlock() {
  if (!_bhAgentLoadedSkills.length) return '';
  const lines = ['### Loaded skill content'];
  for (const s of _bhAgentLoadedSkills) {
    const tag = s.kind === 'domain' ? `domain/${s.host}/${s.name}` : `interaction/${s.name}`;
    const body = s.content.length > BH_AGENT_SKILL_INLINE_MAX
      ? s.content.slice(0, BH_AGENT_SKILL_INLINE_MAX) + '\n...[truncated]'
      : s.content;
    lines.push(`#### ${tag}`);
    lines.push(body);
  }
  return lines.join('\n');
}

// Stage the next prompt's domain-skill discovery line. Called after
// successful navigate/open_tab so the surface fires once on the turn AFTER
// navigation (matching the python harness's goto_url() return behaviour).
async function _bhAgentSurfaceForHost(host) {
  const Skills = globalThis.BrowserSkills;
  if (!Skills || !host) { _bhAgentNavSurface = null; return; }
  const h = Skills.normalizeHost(host);
  const skills = await Skills.listDomain(h).catch(() => []);
  _bhAgentNavSurface = { host: h, skills };
}

// Pre-load a list of domain skills for `host` into the per-run buffer.
// Used by navigate/open_tab when the model passes `read_skills: [...]`,
// so it doesn't have to spend extra turns calling read_skill afterwards.
async function _bhAgentPreloadDomainSkills(host, names) {
  const Skills = globalThis.BrowserSkills;
  if (!Skills || !host || !Array.isArray(names) || !names.length) return;
  const h = Skills.normalizeHost(host);
  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    try {
      const md = await Skills.read('domain', name, host);
      _bhAgentLoadedSkills.push({ kind: 'domain', name, host: h, content: md });
      await _bhAgentLog({ kind: 'info', text: `Pre-loaded domain skill ${name} (${h})` });
    } catch (e) {
      await _bhAgentLog({
        kind: 'error',
        text: `Pre-load skipped ${name} (${h}): ${e.message}`,
      });
    }
  }
  while (_bhAgentLoadedSkills.length > BH_AGENT_LOADED_SKILLS_MAX) {
    _bhAgentLoadedSkills.shift();
  }
}

// Browser-use-style compaction. When the rendered history grows past the
// threshold, fire one extra Gemini call that compresses the bulk of it
// into a single "memory" string, then replace history[1..-keepTail] with
// a synthetic compacted_history entry. Step 1 stays (original task
// framing) and the last few steps stay verbatim so the model still has
// concrete recent context.
async function _bhAgentCompactHistoryIfNeeded(history, task) {
  if (!_bhGeminiCall) return false;
  if (history.length <= BH_AGENT_HISTORY_KEEP_TAIL + 2) return false;

  const rendered = _bhAgentRenderHistory(history);
  if (rendered.length < BH_AGENT_HISTORY_CHAR_THRESHOLD) return false;

  const prompt = [
    'You are compacting a browser-agent history into a memory note so a future turn can continue the task without rereading every step.',
    '',
    'Preserve: the task requirements, constraints/inputs given by the user, key facts learned about the site (URLs, selectors, IDs), decisions made, partial progress, errors encountered, and any data already extracted.',
    'Drop: redundant click/scroll narration, duplicated screenshot observations, anything trivially recoverable from the next screenshot.',
    '',
    `Task: ${task}`,
    '',
    'Full history so far:',
    rendered,
    '',
    'Write a plain-text summary of ~250 words. No markdown headings, no JSON. Address the future agent in the first person ("I have…", "Next I should…").',
  ].join('\n');

  let summary;
  try {
    summary = await _bhGeminiCall(prompt, null, {});
  } catch (e) {
    console.warn('[BrowserAgent] compaction failed:', e.message);
    return false;
  }
  if (!summary || typeof summary !== 'string') return false;

  // Replace history[1 .. length - keepTail] with one synthetic entry.
  const compacted = {
    is_compacted: true,
    memory: summary.trim(),
    t: Date.now(),
  };
  const removeStart = 1;
  const removeCount = history.length - BH_AGENT_HISTORY_KEEP_TAIL - 1;
  if (removeCount > 0) {
    history.splice(removeStart, removeCount, compacted);
    await _bhAgentLog({
      kind: 'info',
      text: `Compacted ${removeCount} history steps into a summary (${rendered.length} -> ~${summary.length} chars)`,
    });
    return true;
  }
  return false;
}

function _bhAgentRenderHistoryEntry(h, idx) {
  if (h.is_compacted) {
    return [
      `Step ${idx + 1} (compacted summary of earlier steps):`,
      h.memory || '(no summary)',
    ].join('\n');
  }
  // Strip the meta-fields out of the action shape so it renders cleanly.
  const actionView = {};
  for (const k of Object.keys(h)) {
    if (['evaluation_previous_goal', 'memory', 'next_goal', 'reason',
         'is_compacted', 'extracted', 'error', 't'].includes(k)) continue;
    actionView[k] = h[k];
  }
  const lines = [`Step ${idx + 1}:`];
  if (h.evaluation_previous_goal) lines.push(`  evaluation_previous_goal: ${h.evaluation_previous_goal}`);
  if (h.next_goal) lines.push(`  next_goal: ${h.next_goal}`);
  lines.push(`  action: ${JSON.stringify(actionView)}`);
  if (h.reason) lines.push(`  reason: ${h.reason}`);
  if (h.extracted !== undefined && h.extracted !== null) {
    let blob;
    try { blob = JSON.stringify(h.extracted); }
    catch { blob = String(h.extracted); }
    lines.push(`  result: ${_bhAgentTruncate(blob, BH_AGENT_EXTRACTED_INLINE_MAX)}`);
  }
  if (h.error) lines.push(`  error: ${_bhAgentTruncate(h.error, 400)}`);
  return lines.join('\n');
}

function _bhAgentRenderHistory(history) {
  if (!history.length) return 'No previous actions yet.';
  return 'History (full):\n\n' + history.map(_bhAgentRenderHistoryEntry).join('\n\n');
}

async function _bhAgentAsk(task, screenshotB64, history, opts = {}) {
  if (!_bhGeminiCall) throw new Error('agent: gemini caller not configured');
  const { pendingError = null, pendingRaw = null } = opts;

  const histText = _bhAgentRenderHistory(history);

  const memoryText = _bhAgentCurrentMemory
    ? `### Current memory\n${_bhAgentCurrentMemory}`
    : '';

  const { tabs, activeIdx } = await _bhAgentTabsContext();
  const tabsText = tabs.length
    ? 'Tabs you have open (only these are accessible):\n' + tabs.map(t =>
        `  [${t.idx}]${t.idx === activeIdx ? ' (current)' : ''} ${_bhAgentTruncate(t.title || '(untitled)', 60)} — ${_bhAgentTruncate(t.url, 80)}`
      ).join('\n')
    : 'No tabs currently tracked.';

  const navText = await _bhAgentConsumeNavSurface();
  const loadedText = _bhAgentLoadedSkillsBlock();

  // When the previous turn failed (parse error or exec error), echo what the
  // model said and the error so it can correct itself rather than aborting
  // the whole run on a single bad action. Cap the echoed text so a runaway
  // verbose response doesn't blow the next prompt's budget.
  const retryBlock = pendingError ? [
    '',
    '### Previous attempt failed',
    pendingRaw ? 'Your previous output was:' : '',
    pendingRaw ? '```\n' + _bhAgentTruncate(pendingRaw, 1200) + '\n```' : '',
    'Error:',
    _bhAgentTruncate(pendingError, 600),
    'Pick a valid action from the list above and try again.',
  ].filter(Boolean).join('\n') : '';

  const prompt = [
    _bhAgentSystemPrompt,
    '',
    `Task: ${task}`,
    '',
    'Here is the current browser screenshot (attached as image).',
    '',
    tabsText,
    navText ? '\n' + navText : '',
    loadedText ? '\n' + loadedText : '',
    memoryText ? '\n' + memoryText : '',
    retryBlock,
    '',
    histText,
    '',
    'What single action should I take next? Respond with JSON only, including evaluation_previous_goal, memory, next_goal.',
  ].filter(Boolean).join('\n');
  const text = await _bhGeminiCall(prompt, null, {
    images: screenshotB64 ? [`data:image/png;base64,${screenshotB64}`] : [],
    mimeType: 'application/json',
  });
  try {
    return _bhAgentParseAction(text);
  } catch (e) {
    // _bhAgentParseAction already attaches rawText. Add it again here only if
    // upstream lost it (defensive — JSON parse failures are the common path).
    if (!e.rawText) e.rawText = text;
    throw e;
  }
}

function _bhAgentResolveTabIdx(idx) {
  // Map LLM-facing index -> chrome tabId via the same ordering used in
  // _bhAgentTabsContext (Set insertion order). Keep the resolution local so
  // we don't have to thread the snapshot through the loop.
  const ordered = [..._bhAgentOwnedTabs];
  if (typeof idx !== 'number' || idx < 0 || idx >= ordered.length) return null;
  return ordered[idx];
}

async function _bhAgentExec(tabId, action, task) {
  const H = globalThis.BrowserHarness;
  switch (action.action) {
    case 'click': {
      // Model emits coords in image-pixel space; convert to CSS pixels for
      // Input.dispatchMouseEvent. _bhAgentImageScale = 1 when image is
      // already CSS-normalised (the common case).
      const s = _bhAgentImageScale || 1;
      const cssX = action.x / s;
      const cssY = action.y / s;
      await H.clickAt(tabId, cssX, cssY);
      // Visual breadcrumb on the live page so a human can follow along.
      // Fire-and-forget; failure (CSP, frozen JS thread, page navigated
      // mid-click) doesn't affect the click itself.
      _bhAgentShowPageCursor(tabId, cssX, cssY);
      await H.wait(500);
      return { keepGoing: true };
    }
    case 'type':
      await H.typeText(tabId, action.text);
      await H.wait(300);
      return { keepGoing: true };
    case 'press_key':
      await H.pressKey(tabId, action.key);
      await H.wait(500);
      return { keepGoing: true };
    case 'scroll': {
      // Both the cursor position (x,y) and the wheel delta (dx,dy) are
      // CSS-pixel quantities from CDP's perspective; convert from
      // image-pixel space the same way as click.
      const s = _bhAgentImageScale || 1;
      await H.scroll(
        tabId,
        (action.x ?? 600) / s,
        (action.y ?? 400) / s,
        (action.dy ?? -300) / s,
        (action.dx ?? 0) / s,
      );
      await H.wait(500);
      return { keepGoing: true };
    }
    case 'navigate': {
      await H.gotoUrl(tabId, action.url);
      await H.waitForLoad(tabId);
      await _bhAgentSurfaceForHost(_bhAgentHostOf(action.url));
      if (Array.isArray(action.read_skills) && action.read_skills.length) {
        await _bhAgentPreloadDomainSkills(_bhAgentHostOf(action.url), action.read_skills);
      }
      return { keepGoing: true };
    }
    case 'wait':
      await H.wait((action.seconds ?? 1) * 1000);
      return { keepGoing: true };
    case 'open_tab': {
      _bhAgentCreatingTab = true;
      let created;
      try {
        created = await H.newTab(action.url || 'about:blank', { active: false });
      } finally {
        _bhAgentCreatingTab = false;
      }
      if (created?.tabId == null) throw new Error('failed to open tab');
      _bhAgentOwnedTabs.add(created.tabId);
      await _bhAgentGroupTab(created.tabId, task, _bhAgentGroupId);
      _bhAgentTabId = created.tabId;
      if (action.url && action.url !== 'about:blank') {
        await H.waitForLoad(created.tabId);
        await _bhAgentSurfaceForHost(_bhAgentHostOf(action.url));
        if (Array.isArray(action.read_skills) && action.read_skills.length) {
          await _bhAgentPreloadDomainSkills(_bhAgentHostOf(action.url), action.read_skills);
        }
      }
      return { keepGoing: true, newTabId: created.tabId };
    }
    case 'switch_tab': {
      const next = _bhAgentResolveTabIdx(action.tab);
      if (next == null) throw new Error(`switch_tab: no tab at index ${action.tab}`);
      _bhAgentTabId = next;
      // Make sure the debugger session is live on the new tab before the
      // next screenshot fires.
      await H.attach(next);
      return { keepGoing: true, newTabId: next };
    }
    case 'close_tab': {
      const target = _bhAgentResolveTabIdx(action.tab);
      if (target == null) throw new Error(`close_tab: no tab at index ${action.tab}`);
      try { await chrome.tabs.remove(target); } catch {}
      // onRemoved listener cleans up _bhAgentOwnedTabs and shifts
      // _bhAgentTabId if we just closed the active tab.
      if (!_bhAgentTabId) {
        return { keepGoing: false, summary: 'closed last agent tab' };
      }
      return { keepGoing: true };
    }
    case 'read_skill': {
      const Skills = globalThis.BrowserSkills;
      if (!Skills) throw new Error('skills registry not loaded');
      const kind = action.kind === 'domain' ? 'domain' : 'interaction';
      const md = await Skills.read(kind, action.name, action.host);
      _bhAgentLoadedSkills.push({
        kind,
        name: action.name,
        host: kind === 'domain' ? Skills.normalizeHost(action.host) : null,
        content: md,
      });
      // Bound the loaded buffer so the prompt doesn't grow unbounded across
      // many read_skill calls in one run.
      while (_bhAgentLoadedSkills.length > BH_AGENT_LOADED_SKILLS_MAX) {
        _bhAgentLoadedSkills.shift();
      }
      await _bhAgentLog({
        kind: 'info',
        text: `Loaded ${kind} skill ${action.name}${action.host ? ` (${action.host})` : ''}`,
      });
      return { keepGoing: true };
    }
    case 'write_skill': {
      const Skills = globalThis.BrowserSkills;
      if (!Skills) throw new Error('skills registry not loaded');
      const kind = action.kind === 'domain' ? 'domain' : 'interaction';
      await Skills.write(kind, action.name, action.content, action.host);
      await _bhAgentLog({
        kind: 'info',
        text: `Saved ${kind} skill ${action.name}${action.host ? ` (${action.host})` : ''}`,
      });
      return { keepGoing: true };
    }
    case 'fill_input': {
      if (!action.selector || typeof action.text !== 'string') {
        throw new Error('fill_input: selector and text are required');
      }
      await H.fillInput(tabId, action.selector, action.text, {
        clearFirst: action.clear_first !== false,
        timeoutMs: action.timeout_ms || 0,
      });
      await H.wait(300);
      return { keepGoing: true };
    }
    case 'wait_for_element': {
      if (!action.selector) throw new Error('wait_for_element: selector is required');
      const found = await H.waitForElement(tabId, action.selector, {
        timeoutMs: action.timeout_ms ?? 10000,
        visible: !!action.visible,
      });
      if (!found) {
        throw new Error(`wait_for_element: ${action.selector} not found within ${action.timeout_ms ?? 10000}ms`);
      }
      return { keepGoing: true };
    }
    case 'wait_for_network_idle': {
      const idle = await H.waitForNetworkIdle(tabId, {
        timeoutMs: action.timeout_ms ?? 10000,
        idleMs: action.idle_ms ?? 500,
      });
      if (!idle) {
        // Soft signal — surface as info but don't fail the loop. The model
        // can decide whether to wait longer or proceed anyway.
        await _bhAgentLog({ kind: 'info', text: 'wait_for_network_idle: timed out, network still active' });
      }
      return { keepGoing: true };
    }
    case 'handle_dialog': {
      await H.handleDialog(tabId, action.accept !== false, action.prompt_text ?? null);
      await H.wait(200);
      return { keepGoing: true };
    }
    case 'js': {
      if (!action.code || typeof action.code !== 'string') {
        throw new Error('js: code is required');
      }
      const value = await H.js(tabId, action.code);
      // The loop folds `extracted` into the history entry so subsequent
      // turns see "result: ..." next to the action that produced it.
      return { keepGoing: true, extracted: value };
    }
    case 'done':
      return { keepGoing: false };
    default:
      throw new Error(`unknown action: ${action.action}`);
  }
}

/**
 * Run a task to completion. Persists progress to chrome.storage.local.bhAgent.
 * Returns when the loop exits (done / max steps / error / stopped).
 */
async function bhAgentRun(task, opts = {}) {
  if (_bhAgentRunning) throw new Error('agent already running');
  _bhAgentRunning = true;
  _bhAgentStop = false;
  _bhAgentLoadedSkills = [];
  _bhAgentNavSurface = null;
  _bhAgentCurrentMemory = '';
  _bhAgentImageScale = 1;
  _bhAgentImageWidth = 0;
  _bhAgentImageHeight = 0;
  // Bake the interaction-skills index into the system prompt once at the
  // start of the run -- the names don't change mid-run, so re-listing every
  // turn just spends prompt budget for no information gain.
  _bhAgentSystemPrompt = await _bhBuildSystemPrompt();

  const H = globalThis.BrowserHarness;
  const maxSteps = opts.maxSteps ?? 50;

  // Mirror my_agent.py: always run in a fresh about:blank tab unless the
  // caller pinned a tabId. Open it in the background (active:false) so the
  // user's current tab keeps focus -- the loop drives the new tab via CDP
  // without needing it to be foregrounded.
  let tabId = opts.tabId ?? null;
  let openedNewTab = false;
  if (tabId == null) {
    _bhAgentCreatingTab = true;
    try {
      const created = await H.newTab('about:blank', { active: false });
      if (!created || created.tabId == null) {
        _bhAgentRunning = false;
        throw new Error('failed to open new tab');
      }
      tabId = created.tabId;
    } finally {
      _bhAgentCreatingTab = false;
    }
    openedNewTab = true;
    _bhAgentGroupId = await _bhAgentGroupTab(tabId, task);
  }
  _bhAgentTabId = tabId;
  _bhAgentOwnedTabs.add(tabId);

  await _bhAgentWrite({
    task,
    tabId,
    maxSteps,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    summary: null,
    error: null,
    log: [{
      t: Date.now(),
      kind: 'info',
      text: openedNewTab ? `Opened new tab (${tabId})` : `Starting agent on tab ${tabId}`,
    }],
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
      if (_bhAgentStop) {
        await _bhAgentPatch({ status: 'stopped', endedAt: Date.now() });
        await _bhAgentLog({ kind: 'info', text: 'Stopped by user' });
        _bhAgentNotify('stopped', task, 'Stopped by user');
        return { stopped: true };
      }
      // Always read the live current tab — open_tab/switch_tab/close_tab
      // may have moved focus during the previous iteration.
      const currentTab = _bhAgentTabId;
      if (!currentTab) {
        const summary = 'no tabs left';
        await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
        await _bhAgentLog({ kind: 'info', text: summary });
        _bhAgentNotify('done', task, summary);
        return { summary };
      }
      // cssNormalize: re-render at CSS-pixel dimensions so the model's
      // pixel coordinates map 1:1 to clickable CSS positions. maxDim caps
      // very-large viewports (>1800 css px) further; the returned `scale`
      // tells us how to convert model coords back to CSS for the click.
      const shot = await H.captureScreenshot(currentTab, { maxDim: 1800, cssNormalize: true });
      const screenshot = typeof shot === 'string' ? shot : shot.data;
      _bhAgentImageScale = (shot && typeof shot === 'object' && shot.scale) || 1;
      _bhAgentImageWidth = (shot && typeof shot === 'object' && shot.width) || 0;
      _bhAgentImageHeight = (shot && typeof shot === 'object' && shot.height) || 0;

      let action;
      try {
        action = await _bhAgentAsk(task, screenshot, history, { pendingError, pendingRaw });
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
        continue;
      }

      // Carry the latest memory forward so the next prompt's "Current
      // memory" block reflects this turn even before the history rendering
      // includes it. Defensive: keep the prior memory if the model omitted
      // the field rather than blanking it out.
      if (typeof action.memory === 'string' && action.memory.trim()) {
        _bhAgentCurrentMemory = action.memory.trim();
      }

      // Push a mutable turn record so we can annotate with the action's
      // extracted result / error after exec.
      const turn = { ...action, t: Date.now() };
      history.push(turn);
      await _bhAgentLog({
        kind: 'action',
        step: step + 1,
        action: action.action,
        text: action.reason || action.summary || action.next_goal || JSON.stringify(action),
      });

      let result;
      try {
        result = await _bhAgentExec(currentTab, action, task);
        if (result && 'extracted' in result) turn.extracted = result.extracted;
      } catch (execErr) {
        // Action ran but failed (unknown action name, missing skill, bad tab
        // index, etc). Feed the original action JSON + error back so the LLM
        // gets to try again -- one bad action shouldn't kill the whole run.
        const msg = execErr.message || String(execErr);
        turn.error = msg;
        pendingError = msg;
        pendingRaw = JSON.stringify(action);
        await _bhAgentLog({
          kind: 'error',
          step: step + 1,
          text: `Action failed, retrying: ${pendingError}`,
        });
        continue;
      }

      // After every successful step, see if rendered history is over the
      // soft budget; if so, summarise the bulk into a single compacted
      // entry. Mirrors browser-use's MessageManager.maybe_compact_messages.
      await _bhAgentCompactHistoryIfNeeded(history, task);

      pendingError = null;
      pendingRaw = null;
      if (!result.keepGoing) {
        const summary = result.summary || action.summary || 'task complete';
        await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
        await _bhAgentLog({ kind: 'done', text: summary });
        _bhAgentNotify('done', task, summary);
        return { summary };
      }
    }
    const summary = `reached max steps (${maxSteps})`;
    await _bhAgentPatch({ status: 'done', endedAt: Date.now(), summary });
    await _bhAgentLog({ kind: 'info', text: summary });
    _bhAgentNotify('done', task, summary);
    return { summary };
  } catch (e) {
    const msg = e.message || String(e);
    await _bhAgentPatch({ status: 'error', endedAt: Date.now(), error: msg });
    await _bhAgentLog({ kind: 'error', text: msg });
    _bhAgentNotify('error', task, msg);
    throw e;
  } finally {
    _bhAgentRunning = false;
    _bhAgentTabId = null;
    _bhAgentOwnedTabs.clear();
    _bhAgentGroupId = null;
    _bhAgentSwallow.clear();
    _bhAgentLoadedSkills = [];
    _bhAgentNavSurface = null;
    _bhAgentCurrentMemory = '';
    _bhAgentImageScale = 1;
    _bhAgentImageWidth = 0;
    _bhAgentImageHeight = 0;
    _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
  }
}

function bhAgentStop() { _bhAgentStop = true; }
function bhAgentIsRunning() { return _bhAgentRunning; }

async function bhAgentClear() {
  await chrome.storage.local.remove(BH_AGENT_KEY);
}

globalThis.BrowserAgent = {
  run: bhAgentRun,
  stop: bhAgentStop,
  clear: bhAgentClear,
  isRunning: bhAgentIsRunning,
  setGeminiCaller: bhAgentSetGeminiCaller,
};
