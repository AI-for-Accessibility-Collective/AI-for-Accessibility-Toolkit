// Dispatcher for one agent action. Maps the LLM's `{action, ...}` shape
// onto BrowserHarness primitives. Returns {keepGoing, summary?, extracted?,
// newTabId?} so the loop can decide whether to stop, record extracted
// data, or update its tracked tabId.

import { BH_AGENT_LOADED_SKILLS_MAX } from './constants.js';
import {
  _bhAgentOwnedTabs,
  setTabId,
  getTabId,
  getGroupId,
  setCreatingTab,
  getImageScale,
  pushLoadedSkill,
  shiftLoadedSkill,
  getLoadedSkills,
  _bhAgentLog,
  _bhAgentResolveTabIdx,
} from './state.js';
import {
  _bhAgentHostOf,
  _bhAgentSurfaceForHost,
  _bhAgentPreloadDomainSkills,
} from './prompt.js';
import { _bhAgentGroupTab } from './tabs.js';
import { _bhAgentShowPageCursor } from './notify.js';

export async function _bhAgentExec(tabId, action, task) {
  const H = globalThis.BrowserHarness;
  switch (action.action) {
    case 'click': {
      // Model emits coords in image-pixel space; convert to CSS pixels for
      // Input.dispatchMouseEvent. _bhAgentImageScale = 1 when image is
      // already CSS-normalised (the common case).
      const s = getImageScale() || 1;
      const cssX = action.x / s;
      const cssY = action.y / s;
      // bhClickAt snaps the LLM's coordinate to the bounding-box center of
      // the nearest interactive ancestor and returns the actual click
      // point. Use that for the cursor breadcrumb so the human sees where
      // the click really landed -- and so we can log a snap delta when the
      // click was off by enough to matter.
      const snap = await H.clickAt(tabId, cssX, cssY);
      const visX = (snap && Number.isFinite(snap.x)) ? snap.x : cssX;
      const visY = (snap && Number.isFinite(snap.y)) ? snap.y : cssY;
      _bhAgentShowPageCursor(tabId, visX, visY);
      // Always log click outcome so we can see whether snap is helping --
      // misses are the easiest thing to diagnose with concrete deltas.
      // 'via' tells us which heuristic tier matched: strict (semantic),
      // pointer (cursor:pointer chain), or ax (Chrome accessibility tree
      // fallback when DOM/CSS heuristics missed).
      if (snap && snap.snapped) {
        const dx = Math.round(visX - cssX);
        const dy = Math.round(visY - cssY);
        const tagInfo = snap.tag + (snap.role ? ' role=' + snap.role : '');
        const occluded = snap.occluded ? ' OCCLUDED→jsClick' : '';
        const fallback = snap.fallback ? ' (jsClick fallback ✓)' : '';
        await _bhAgentLog({
          kind: 'info',
          text: `Click @(${Math.round(cssX)}, ${Math.round(cssY)}) → snap[${snap.via}] to <${tagInfo}> Δ(${dx}, ${dy})${occluded}${fallback}.`,
        });
      } else {
        await _bhAgentLog({
          kind: 'info',
          text: `Click @(${Math.round(cssX)}, ${Math.round(cssY)}) raw — no interactive target at point (page-side + AX both empty).`,
        });
      }
      await H.wait(500);
      return { keepGoing: true };
    }
    // Index-based click: looks up the element by its position in the most
    // recent enumerate() snapshot. The agent step loop enumerates before
    // every screenshot so indexes are always fresh. browser_use's dominant
    // click mode -- DOM-derived coords are pixel-exact, no vision
    // approximation involved.
    case 'click_index': {
      const idx = action.index;
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error('click_index: missing or invalid `index`');
      }
      let result;
      try {
        result = await H.clickIndex(tabId, idx);
      } catch (e) {
        // Stale index = page changed since last enumerate. The next turn's
        // enumerate will refresh; surface the error so the LLM sees it.
        throw new Error(e.message || String(e));
      }
      if (result && Number.isFinite(result.x) && Number.isFinite(result.y)) {
        _bhAgentShowPageCursor(tabId, result.x, result.y);
      }
      const tagInfo = (result.tag || '?') + (result.role ? ' role=' + result.role : '');
      const occluded = result.occluded ? ' OCCLUDED→jsClick' : '';
      const fallback = result.fallback ? ' (jsClick ✓)' : '';
      const recovered = (result.recoveredFromIdx !== undefined)
        ? ` (recovered ${result.recoveredFromIdx}→${result.recoveredToIdx})` : '';
      await _bhAgentLog({
        kind: 'info',
        text: `click_index[${idx}]${recovered} → <${tagInfo}>${occluded}${fallback}.`,
      });
      await H.wait(500);
      return { keepGoing: true };
    }
    case 'type':
      await H.typeText(tabId, action.text);
      await H.wait(300);
      return { keepGoing: true };
    case 'type_index': {
      const idx = action.index;
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error('type_index: missing or invalid `index`');
      }
      const text = (typeof action.text === 'string') ? action.text : '';
      const result = await H.typeIndex(tabId, idx, text, { clear: action.clear !== false });
      const recovered = (result.recoveredFromIdx !== undefined)
        ? ` (recovered ${result.recoveredFromIdx}→${result.recoveredToIdx})` : '';
      await _bhAgentLog({
        kind: 'info',
        text: `type_index[${idx}]${recovered} <${result.tag || '?'}${result.type ? ' type=' + result.type : ''}> ← ${JSON.stringify(text.slice(0, 40))}${text.length > 40 ? '…' : ''}.`,
      });
      await H.wait(300);
      return { keepGoing: true };
    }
    case 'upload_file': {
      const idx = action.index;
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error('upload_file: missing or invalid `index`');
      }
      const files = Array.isArray(action.files) ? action.files : (action.file ? [action.file] : []);
      if (!files.length) throw new Error('upload_file: missing `file` (string) or `files` (array)');
      const result = await H.uploadFileIndex(tabId, idx, files);
      await _bhAgentLog({ kind: 'info', text: `upload_file[${idx}] ← ${result.files.join(', ')}.` });
      return { keepGoing: true };
    }
    case 'dropdown_options': {
      const idx = action.index;
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error('dropdown_options: missing or invalid `index`');
      }
      const data = await H.dropdownOptions(tabId, idx);
      await _bhAgentLog({
        kind: 'info',
        text: `dropdown_options[${idx}] (${data.kind}): ${data.options.length} options.`,
      });
      // Surface the options to the LLM via the action's `extracted` field
      // -- the agent loop already records this into the next turn's
      // history so the model sees what's available.
      return {
        keepGoing: true,
        extracted: { kind: data.kind, multiple: !!data.multiple, options: data.options },
      };
    }
    case 'select_dropdown': {
      const idx = action.index;
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error('select_dropdown: missing or invalid `index`');
      }
      const text = (typeof action.text === 'string') ? action.text : '';
      if (!text) throw new Error('select_dropdown: missing `text`');
      const result = await H.selectDropdown(tabId, idx, text);
      await _bhAgentLog({
        kind: 'info',
        text: `select_dropdown[${idx}] (${result.kind}) ← ${JSON.stringify(text)} → ${JSON.stringify(result.selectedText || '')}.`,
      });
      await H.wait(300);
      return { keepGoing: true };
    }
    case 'go_back': {
      await H.goBack(tabId);
      await H.waitForLoad(tabId);
      return { keepGoing: true };
    }
    case 'go_forward': {
      await H.goForward(tabId);
      await H.waitForLoad(tabId);
      return { keepGoing: true };
    }
    case 'refresh': {
      await H.refresh(tabId, { ignoreCache: !!action.hard });
      await H.waitForLoad(tabId);
      return { keepGoing: true };
    }
    case 'press_key':
      await H.pressKey(tabId, action.key);
      await H.wait(500);
      return { keepGoing: true };
    case 'scroll': {
      // Both the cursor position (x,y) and the wheel delta (dx,dy) are
      // CSS-pixel quantities from CDP's perspective; convert from
      // image-pixel space the same way as click.
      const s = getImageScale() || 1;
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
      setCreatingTab(true);
      let created;
      try {
        created = await H.newTab(action.url || 'about:blank', { active: false });
      } finally {
        setCreatingTab(false);
      }
      if (created?.tabId == null) throw new Error('failed to open tab');
      _bhAgentOwnedTabs.add(created.tabId);
      await _bhAgentGroupTab(created.tabId, task, getGroupId());
      setTabId(created.tabId);
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
      setTabId(next);
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
      // the tabId state if we just closed the active tab.
      if (!getTabId()) {
        return { keepGoing: false, summary: 'closed last agent tab' };
      }
      return { keepGoing: true };
    }
    case 'read_skill': {
      const Skills = globalThis.BrowserSkills;
      if (!Skills) throw new Error('skills registry not loaded');
      const kind = action.kind === 'domain' ? 'domain' : 'interaction';
      const md = await Skills.read(kind, action.name, action.host);
      pushLoadedSkill({
        kind,
        name: action.name,
        host: kind === 'domain' ? Skills.normalizeHost(action.host) : null,
        content: md,
      });
      // Bound the loaded buffer so the prompt doesn't grow unbounded across
      // many read_skill calls in one run.
      while (getLoadedSkills().length > BH_AGENT_LOADED_SKILLS_MAX) {
        shiftLoadedSkill();
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
        // Soft signal -- surface as info but don't fail the loop. The model
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
