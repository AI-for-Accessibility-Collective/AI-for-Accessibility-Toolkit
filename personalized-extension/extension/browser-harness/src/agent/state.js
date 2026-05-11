// Per-run mutable state + persistence helpers. The agent loop is the only
// writer; modules reading state import the getters or read the exported
// `let`s directly via the live binding.
//
// Persistence: the state object lives in chrome.storage.local under
// BH_AGENT_KEY so popup / page UIs can render the live log without holding
// any state of their own (the popup dies on close; the SW keeps running).

import { BH_AGENT_KEY, BH_AGENT_LOG_LIMIT, BH_AGENT_SYSTEM_PROMPT_BASE } from './constants.js';

// Built once at run start by _bhBuildSystemPrompt -- prepends the static
// base with the live interaction-skills index so the names appear once in
// the system prompt rather than every turn.
export let _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
export function setSystemPrompt(s) { _bhAgentSystemPrompt = s; }
export function getSystemPrompt() { return _bhAgentSystemPrompt; }

// One-shot domain-skill discovery line. After successful navigate/open_tab
// _bhAgentSurfaceForHost stages this, the next prompt assembly consumes it.
export let _bhAgentNavSurface = null;
export function setNavSurface(s) { _bhAgentNavSurface = s; }
export function getNavSurface() { return _bhAgentNavSurface; }

// Per-run skill content the LLM has explicitly loaded via read_skill or
// navigate's read_skills field. Bounded buffer; oldest entries evict.
export let _bhAgentLoadedSkills = [];
export function setLoadedSkills(arr) { _bhAgentLoadedSkills = arr; }
export function getLoadedSkills() { return _bhAgentLoadedSkills; }
export function pushLoadedSkill(s) { _bhAgentLoadedSkills.push(s); }
export function shiftLoadedSkill() { _bhAgentLoadedSkills.shift(); }

// LLM caller. Wired by background.js after importScripts via setGeminiCaller.
// Kept as a let so a fresh wiring on SW restart replaces the old reference.
export let _bhGeminiCall = null;
export function setGeminiCaller(fn) { _bhGeminiCall = fn; }
export function getGeminiCaller() { return _bhGeminiCall; }

// Run-lifecycle flags + tab tracking.
export let _bhAgentStop = false;
export function setStop(v) { _bhAgentStop = !!v; }
export function shouldStop() { return _bhAgentStop; }

export let _bhAgentRunning = false;
export function setRunning(v) { _bhAgentRunning = !!v; }
export function isRunning() { return _bhAgentRunning; }

export let _bhAgentTabId = null;
export function setTabId(id) { _bhAgentTabId = id; }
export function getTabId() { return _bhAgentTabId; }

export const _bhAgentOwnedTabs = new Set();
export let _bhAgentGroupId = null;
export function setGroupId(id) { _bhAgentGroupId = id; }
export function getGroupId() { return _bhAgentGroupId; }

export let _bhAgentCreatingTab = false;
export function setCreatingTab(v) { _bhAgentCreatingTab = !!v; }
export function isCreatingTab() { return _bhAgentCreatingTab; }

export const _bhAgentSwallow = new Set();

// Latest "memory" string the LLM emitted. Carried into every subsequent
// prompt as "Current memory" so the model has a forwarding scratchpad
// that doesn't depend on history rendering.
export let _bhAgentCurrentMemory = '';
export function setCurrentMemory(s) { _bhAgentCurrentMemory = s; }
export function getCurrentMemory() { return _bhAgentCurrentMemory; }

// Image-pixels-per-CSS-pixel of the latest screenshot. The agent reads
// click/scroll coordinates off the screenshot (image-pixel space); CDP's
// Input.dispatchMouseEvent expects CSS pixels. Divide by this to convert.
// Set after every captureScreenshot in the run loop.
export let _bhAgentImageScale = 1;
export let _bhAgentImageWidth = 0;
export let _bhAgentImageHeight = 0;
export function setImage(scale, w, h) {
  _bhAgentImageScale = scale;
  _bhAgentImageWidth = w;
  _bhAgentImageHeight = h;
}
export function getImageScale() { return _bhAgentImageScale; }

// Identity hashes from the previous turn's interactive snapshot. Used to
// mark newly-appeared elements with `*[idx]` in the formatted list,
// mirroring browser_use's "elements that appeared since last step" cue.
export let _bhAgentLastInteractiveHashes = new Set();
export function setLastInteractiveHashes(s) { _bhAgentLastInteractiveHashes = s; }
export function getLastInteractiveHashes() { return _bhAgentLastInteractiveHashes; }

// --- persistence ------------------------------------------------------
export async function _bhAgentRead() {
  const cur = await chrome.storage.local.get(BH_AGENT_KEY);
  return cur[BH_AGENT_KEY] || { task: '', status: 'idle', log: [] };
}

export async function _bhAgentWrite(state) {
  await chrome.storage.local.set({ [BH_AGENT_KEY]: state });
}

export async function _bhAgentPatch(patch) {
  const state = await _bhAgentRead();
  Object.assign(state, patch);
  await _bhAgentWrite(state);
}

export async function _bhAgentLog(entry) {
  const state = await _bhAgentRead();
  state.log = (state.log || []).concat({ t: Date.now(), ...entry }).slice(-BH_AGENT_LOG_LIMIT);
  await _bhAgentWrite(state);
}

// Truncate without slicing through grapheme clusters mid-word --
// notifications clip silently otherwise. Chrome shows ~140 chars in the
// body; default n=220 covers slightly longer task strings.
export function _bhAgentTruncate(s, n = 220) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Map LLM-facing index -> chrome tabId via the same ordering used in
// _bhAgentTabsContext (Set insertion order). Keep the resolution local so
// we don't have to thread the snapshot through the loop.
export function _bhAgentResolveTabIdx(idx) {
  const ordered = [..._bhAgentOwnedTabs];
  if (typeof idx !== 'number' || idx < 0 || idx >= ordered.length) return null;
  return ordered[idx];
}

// Re-read fresh title/url for every owned tab. Also normalises indices so
// the LLM gets stable `[N]` references that line up with what we'll match
// back when it issues switch_tab/close_tab.
export async function _bhAgentTabsContext() {
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

// Reset all per-run state. Called from run.js's finally block.
export function resetRunState() {
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
  _bhAgentLastInteractiveHashes = new Set();
  _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
}
