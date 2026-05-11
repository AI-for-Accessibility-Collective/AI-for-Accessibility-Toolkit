// Entry point for the agent bundle. Imports run.js (which transitively
// imports everything else, including tabs.js whose chrome.tabs listener
// registration is a side effect) and assembles the public surface on
// globalThis.BrowserAgent. background.js wires setGeminiCaller after
// importScripts so this file doesn't have to know about the Gemini API.

import { setGeminiCaller } from './state.js';
import { bhAgentRun, bhAgentStop, bhAgentIsRunning, bhAgentClear } from './run.js';
import './tabs.js'; // registers chrome.tabs.onCreated/onUpdated/onRemoved listeners

globalThis.BrowserAgent = {
  run: bhAgentRun,
  stop: bhAgentStop,
  clear: bhAgentClear,
  isRunning: bhAgentIsRunning,
  setGeminiCaller,
};
