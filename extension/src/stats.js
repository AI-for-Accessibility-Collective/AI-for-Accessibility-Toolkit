// Fix statistics tracking
const MAX_LOG_SIZE = 500;

const stats = {
  wcag: 0,
  images: 0,
  labels: 0,
  text: 0,
  captions: 0
};

const fixLog = [];

export function logFix(type, element, oldValue, newValue) {
  const selector = element?.tagName?.toLowerCase() || 'element';
  const id = element?.id ? `#${element.id}` : '';
  const cls = element?.className && typeof element.className === 'string'
    ? '.' + element.className.split(' ')[0]
    : '';
  fixLog.push({
    type,
    element: selector + id + cls,
    old: oldValue || '(empty)',
    new: newValue || '',
    timestamp: Date.now()
  });
  // Trim oldest entries if over limit
  if (fixLog.length > MAX_LOG_SIZE) {
    fixLog.splice(0, fixLog.length - MAX_LOG_SIZE);
  }
  // Notify popup of new fix
  try {
    chrome.runtime.sendMessage({ type: 'fixAdded', stats, fixes: fixLog });
  } catch (e) {}
}

export function incrementStat(type) {
  if (type in stats) {
    stats[type]++;
  }
}

export function getStats() {
  return { ...stats };
}

export function getFixLog() {
  return [...fixLog];
}

export function resetStats() {
  stats.wcag = 0;
  stats.images = 0;
  stats.labels = 0;
  stats.text = 0;
  stats.captions = 0;
  fixLog.length = 0;
}

export { stats };
