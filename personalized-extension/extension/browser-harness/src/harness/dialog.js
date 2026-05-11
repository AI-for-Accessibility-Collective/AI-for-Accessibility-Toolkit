// Native-dialog handling. Decoupled from watchdog.js because the watchdog
// auto-dismiss path calls bhHandleDialog and the agent's manual
// handle_dialog action also routes here.

import { bhAttach, bhCdp } from './lifecycle.js';

// Accept (true) or cancel (false) the currently-open native dialog. For a
// prompt(), pass `promptText` to supply the value before accepting. The
// daemon-equivalent removes BH_PENDING_DIALOGS on the matching dialogClosed
// event automatically (see watchdog.js's popups handlers).
export async function bhHandleDialog(tabId, accept = true, promptText = null) {
  await bhAttach(tabId);
  const params = { accept };
  if (promptText != null) params.promptText = promptText;
  await bhCdp(tabId, 'Page.handleJavaScriptDialog', params);
}
