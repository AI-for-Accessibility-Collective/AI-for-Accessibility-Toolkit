// Entry point. esbuild bundles this and every transitive import into a
// single classic-script IIFE that background.js loads via importScripts.
// Each module above hangs its public surface on this object; nothing else
// in the SW reads the internal symbols.
//
// Side-effecting modules (lifecycle, watchdog, liveness) register their
// chrome.debugger / chrome.alarms listeners at module-eval time, so they
// must be imported here even when the index doesn't need any of their
// exports directly. The other imports follow the dependency graph; cycles
// have been broken by hoisting BH_WATCHDOGS into state.js.

import {
  bhSetAutoDialog,
  bhSetAgentBusy,
  bhHealthSnapshot,
  bhHealthClear,
  bhDrainEvents,
  bhPendingDialog,
} from './state.js';
import { bhAttach, bhDetach, bhCdp } from './lifecycle.js';
import './watchdog.js';   // registers _bhPopupsWatchdog + _bhCrashWatchdog into BH_WATCHDOGS
import './liveness.js';   // registers chrome.alarms.bhLiveness sweep
import { bhHandleDialog } from './dialog.js';
import { bhGotoUrl, bhGoBack, bhGoForward, bhRefresh, bhPageInfo } from './navigation.js';
import { bhClickAt, bhTypeText, bhPressKey, bhScroll, bhFillInput } from './input.js';
import { bhEnumerateInteractive } from './interactive.js';
import { bhClickIndex } from './actions/click.js';
import { bhTypeIndex } from './actions/type.js';
import { bhDropdownOptions, bhSelectDropdown } from './actions/dropdown.js';
import { bhUploadFileIndex } from './actions/upload.js';
import { bhDrawHighlights } from './highlights.js';
import { bhCaptureScreenshot } from './screenshot.js';
import { bhListTabs, bhCurrentTab, bhSwitchTab, bhNewTab, bhEnsureRealTab } from './tabs.js';
import { bhJs, bhIframeTarget, bhDispatchKey, bhUploadFile, bhHttpGet } from './runtime.js';
import { bhWait, bhWaitForLoad, bhWaitForElement, bhWaitForNetworkIdle } from './wait.js';

// Public surface. Names match the legacy harness 1:1 so callers
// (background.js's bh:* dispatcher, client.js's proxy, agent.js) need
// no changes.
globalThis.BrowserHarness = {
  attach: bhAttach,
  detach: bhDetach,
  cdp: bhCdp,
  drainEvents: bhDrainEvents,
  pendingDialog: bhPendingDialog,
  handleDialog: bhHandleDialog,
  setAutoDialog: bhSetAutoDialog,
  healthSnapshot: bhHealthSnapshot,
  healthClear: bhHealthClear,
  setAgentBusy: bhSetAgentBusy,
  gotoUrl: bhGotoUrl,
  goBack: bhGoBack,
  goForward: bhGoForward,
  refresh: bhRefresh,
  pageInfo: bhPageInfo,
  clickAt: bhClickAt,
  typeText: bhTypeText,
  fillInput: bhFillInput,
  pressKey: bhPressKey,
  scroll: bhScroll,
  captureScreenshot: bhCaptureScreenshot,
  listTabs: bhListTabs,
  currentTab: bhCurrentTab,
  switchTab: bhSwitchTab,
  newTab: bhNewTab,
  ensureRealTab: bhEnsureRealTab,
  iframeTarget: bhIframeTarget,
  enumerateInteractive: bhEnumerateInteractive,
  drawHighlights: bhDrawHighlights,
  clickIndex: bhClickIndex,
  typeIndex: bhTypeIndex,
  uploadFileIndex: bhUploadFileIndex,
  dropdownOptions: bhDropdownOptions,
  selectDropdown: bhSelectDropdown,
  js: bhJs,
  dispatchKey: bhDispatchKey,
  uploadFile: bhUploadFile,
  wait: bhWait,
  waitForLoad: bhWaitForLoad,
  waitForElement: bhWaitForElement,
  waitForNetworkIdle: bhWaitForNetworkIdle,
  httpGet: bhHttpGet,
};
