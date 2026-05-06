// Send message to background script and wait for response
export function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        console.error('[AI4A11y] sendMessage error:', chrome.runtime.lastError.message);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// Notify popup of progress updates
export function notifyProgress(phase, progress = 0) {
  try {
    const result = chrome.runtime.sendMessage({
      type: 'scanProgress',
      phase,
      progress
    });
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (e) {
    // Ignore - popup may not be open
  }
}

// Announce text to screen readers
export function announce(text, priority = 'polite') {
  let announcer = document.getElementById('ai4a11y-announcer');
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'ai4a11y-announcer';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(announcer);
  }
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 100);
}
