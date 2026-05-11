// One round-trip with the LLM: assembles the prompt (system + tabs + nav
// surface + loaded skills + memory + retry block + history), sends it
// alongside the screenshot, and returns the parsed action JSON.

import {
  getGeminiCaller,
  getSystemPrompt,
  getCurrentMemory,
  _bhAgentTabsContext,
  _bhAgentTruncate,
} from './state.js';
import {
  _bhAgentConsumeNavSurface,
  _bhAgentLoadedSkillsBlock,
} from './prompt.js';
import { _bhAgentRenderHistory } from './history.js';
import { _bhAgentParseAction } from './action-extract.js';

export async function _bhAgentAsk(task, screenshotB64, history, opts = {}) {
  const callGemini = getGeminiCaller();
  if (!callGemini) throw new Error('agent: gemini caller not configured');
  const { pendingError = null, pendingRaw = null, interactiveListText = '' } = opts;

  const histText = _bhAgentRenderHistory(history);

  const memoryText = getCurrentMemory()
    ? `### Current memory\n${getCurrentMemory()}`
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
    getSystemPrompt(),
    '',
    `Task: ${task}`,
    '',
    'Here is the current browser screenshot (attached as image).',
    '',
    interactiveListText ? '\n' + interactiveListText : '',
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
  const text = await callGemini(prompt, null, {
    images: screenshotB64 ? [`data:image/png;base64,${screenshotB64}`] : [],
    mimeType: 'application/json',
  });
  try {
    return _bhAgentParseAction(text);
  } catch (e) {
    // _bhAgentParseAction already attaches rawText. Add it again here only if
    // upstream lost it (defensive -- JSON parse failures are the common path).
    if (!e.rawText) e.rawText = text;
    throw e;
  }
}
