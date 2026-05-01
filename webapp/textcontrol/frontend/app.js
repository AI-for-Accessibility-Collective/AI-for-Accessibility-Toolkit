/**
 * app.js — BrowserMind Text frontend (3-panel: chat | viewport | activity)
 *
 * WebSocket events from backend:
 *   thinking          → show spinner in viewport + thinking dots in chat
 *   text_chunk        → stream agent text into chat panel
 *   tool_called       → add row to activity log
 *   tool_done         → mark activity row done/error
 *   skill_loaded      → add skill badge in chat + skill row in log
 *   browser_screenshot→ update center viewport + add thumbnail to log
 *   task_done         → finalize message, clear spinner
 *   max_steps_reached → warn
 *   session_cleared   → reset UI
 *   error             → show error in chat
 *   pong              → keepalive ack
 */

// ── Session ID ──────────────────────────────────────────────────────────────
const SESSION_ID = (() => {
  let id = sessionStorage.getItem('bmt_sid');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('bmt_sid', id); }
  return id;
})();

const WS_URL = `ws://${location.host}/ws/${SESSION_ID}`;

// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let isRunning = false;
let currentAgentEl = null;   // message div being streamed into
let lastScreenshotB64 = null;
let currentStep = 0;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $messages      = document.getElementById('messages');
const $input         = document.getElementById('user-input');
const $sendBtn       = document.getElementById('btn-send');
const $statusPill    = document.getElementById('status-pill');
const $statusLabel   = document.getElementById('status-label');
const $actLog        = document.getElementById('activity-log');
const $newSession    = document.getElementById('btn-new-session');
const $clearLog      = document.getElementById('btn-clear-log');
const $vpImg         = document.getElementById('viewport-img');
const $vpWrap        = document.getElementById('viewport-img-wrap');
const $vpEmpty       = document.getElementById('viewport-empty');
const $vpThinking    = document.getElementById('viewport-thinking');
const $vpThinkLabel  = document.getElementById('viewport-thinking-label');
const $vpStatus      = document.getElementById('viewport-status');
const $vpStatusLabel = document.getElementById('viewport-status-label');
const $vpStatusDot   = document.querySelector('.vstatus-dot');
const $vpPageTitle   = document.getElementById('viewport-page-title');
const $vpSize        = document.getElementById('viewport-size');
const $urlDisplay    = document.getElementById('current-url-display');
const $urlInput      = document.getElementById('url-input');
const $btnGo         = document.getElementById('btn-go');
const $btnScreenshot = document.getElementById('btn-screenshot');
const $stepCounter   = document.getElementById('step-counter');
const $stepNum       = document.getElementById('step-num');
const $modelBadge    = document.getElementById('model-badge');

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus('connected', 'Connected');
    setInputEnabled(true);
    fetch('/health').then(r => r.json()).then(d => {
      if (d.model) $modelBadge.textContent = d.model;
    }).catch(() => {});
  };

  ws.onclose = () => {
    setStatus('connecting', 'Reconnecting…');
    setInputEnabled(false);
    setTimeout(connect, 2000);
  };

  ws.onerror = () => setStatus('error', 'Connection error');

  ws.onmessage = (ev) => {
    try { handleEvent(JSON.parse(ev.data)); }
    catch (e) { console.error('WS parse error', e); }
  };
}

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Event router ──────────────────────────────────────────────────────────────
function handleEvent(msg) {
  switch (msg.type) {
    case 'thinking':
      showThinking(msg.label || 'Thinking…');
      showViewportThinking('Agent working…');
      break;

    case 'text_chunk':
      appendTextChunk(msg.text);
      break;

    case 'tool_called':
      addActivityRow(msg);
      updateStep(msg.step || 0);
      break;

    case 'tool_done':
      markToolDone(msg);
      break;

    case 'skill_loaded':
      addSkillRow(msg.skill);
      addSkillBadge(msg.skill);
      break;

    case 'browser_screenshot':
      updateViewport(msg);
      addScreenshotRow(msg);
      break;

    case 'task_done':
      finalizeMessage();
      hideViewportThinking();
      addActivityDivider(`✓ Task complete`);
      setRunning(false);
      break;

    case 'turn_complete':
      // Pure-text reply or any run_turn exit without TASK_COMPLETE
      finalizeMessage();
      hideViewportThinking();
      setRunning(false);
      break;

    case 'max_steps_reached':
      finalizeMessage();
      hideViewportThinking();
      addActivityDivider(`⚠ Max steps (${msg.steps})`);
      setRunning(false);
      break;

    case 'session_cleared':
      clearAll();
      addSystemMsg('Session cleared. Ready for new tasks!');
      break;

    case 'error':
      finalizeMessage();
      hideViewportThinking();
      showErrorInChat(msg.message);
      setRunning(false);
      break;

    case 'pong':
      break;

    default:
      console.log('[BrowserMind Text] Unknown event:', msg.type, msg);
  }
}

// ── Viewport ──────────────────────────────────────────────────────────────────
function updateViewport(msg) {
  const { data, url, step } = msg;
  lastScreenshotB64 = data;

  $vpImg.src = `data:image/png;base64,${data}`;
  $vpEmpty.style.display = 'none';
  $vpWrap.style.display = 'block';

  if (url) {
    $urlDisplay.textContent = url;
    $urlInput.value = url;
    try {
      const u = new URL(url);
      $vpPageTitle.textContent = u.hostname;
    } catch { $vpPageTitle.textContent = url; }
  }

  $vpStatusDot.classList.add('active');
  $vpStatusLabel.textContent = step ? `Step ${step}` : 'Live';

  hideViewportThinking();
}

function showViewportThinking(label) {
  $vpThinkLabel.textContent = label || 'Working…';
  $vpThinking.style.display = 'flex';
  $vpStatusDot.classList.remove('active');
  $vpStatusLabel.textContent = 'Working…';
}

function hideViewportThinking() {
  $vpThinking.style.display = 'none';
}

function flashClickOverlay(x, y) {
  const overlay = document.getElementById('click-overlay');
  const wrap = $vpWrap;
  if (!overlay || !wrap) return;
  const rect = $vpImg.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const scaleX = rect.width / ($vpImg.naturalWidth || rect.width);
  const scaleY = rect.height / ($vpImg.naturalHeight || rect.height);
  const dispX = x * scaleX + (rect.left - wrapRect.left);
  const dispY = y * scaleY + (rect.top - wrapRect.top);
  overlay.style.left = dispX + 'px';
  overlay.style.top  = dispY + 'px';
  overlay.style.display = 'block';
  overlay.style.animation = 'none';
  overlay.offsetHeight; // reflow
  overlay.style.animation = '';
  setTimeout(() => { overlay.style.display = 'none'; }, 700);
}

function updateStep(n) {
  if (!n) return;
  currentStep = n;
  $stepNum.textContent = n;
  $stepCounter.style.display = 'flex';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function addUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'message user-message';
  el.innerHTML = `
    <div class="msg-avatar">you</div>
    <div class="msg-body">
      <div class="msg-role">You</div>
      <div class="msg-content">${esc(text)}</div>
    </div>
  `;
  $messages.appendChild(el);
  scrollChat();
}

function createAgentMsg() {
  const el = document.createElement('div');
  el.className = 'message agent-message';
  el.innerHTML = `
    <div class="msg-avatar agent-avatar">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" fill="rgba(99,102,241,0.3)"/>
        <circle cx="10" cy="10" r="4" fill="rgba(99,102,241,0.6)"/>
        <circle cx="10" cy="10" r="1.5" fill="#fff"/>
      </svg>
    </div>
    <div class="msg-body">
      <div class="msg-role">BrowserMind Text</div>
      <div class="msg-content streaming-cursor" id="cur-agent-content"></div>
    </div>
  `;
  $messages.appendChild(el);
  scrollChat();
  return el;
}

function showThinking(label) {
  removeThinking();
  const el = document.createElement('div');
  el.className = 'message agent-message';
  el.id = 'thinking-msg';
  el.innerHTML = `
    <div class="msg-avatar agent-avatar">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" fill="rgba(99,102,241,0.3)"/>
        <circle cx="10" cy="10" r="4" fill="rgba(99,102,241,0.6)"/>
        <circle cx="10" cy="10" r="1.5" fill="#fff"/>
      </svg>
    </div>
    <div class="msg-body">
      <div class="msg-role">BrowserMind Text</div>
      <div class="msg-content">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
  $messages.appendChild(el);
  scrollChat();
}

function removeThinking() {
  const el = document.getElementById('thinking-msg');
  if (el) el.remove();
}

function appendTextChunk(text) {
  removeThinking();
  if (!currentAgentEl) currentAgentEl = createAgentMsg();
  const content = document.getElementById('cur-agent-content');
  if (content) {
    content.dataset.raw = (content.dataset.raw || '') + text;
    content.innerHTML = renderMd(content.dataset.raw);
  }
  scrollChat();
}

function finalizeMessage() {
  removeThinking();
  if (currentAgentEl) {
    const content = document.getElementById('cur-agent-content');
    if (content) {
      content.classList.remove('streaming-cursor');
      if (content.dataset.raw) {
        const cleaned = content.dataset.raw.replace(/TASK_COMPLETE:.*$/s, '').trim();
        content.innerHTML = renderMd(cleaned) || content.innerHTML;
      }
      content.removeAttribute('id');
    }
    currentAgentEl = null;
  }
}

function addSkillBadge(skill) {
  const content = document.getElementById('cur-agent-content');
  if (content) {
    const badge = document.createElement('span');
    badge.className = 'skill-badge';
    badge.textContent = `📖 ${skill}`;
    content.appendChild(badge);
  }
}

function showErrorInChat(message) {
  removeThinking();
  if (!currentAgentEl) currentAgentEl = createAgentMsg();
  const content = document.getElementById('cur-agent-content');
  if (content) {
    content.classList.remove('streaming-cursor');
    content.innerHTML += `<p style="color:var(--error);margin-top:8px">⚠ ${esc(message)}</p>`;
    content.removeAttribute('id');
    currentAgentEl = null;
  }
}

function addSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'message';
  el.innerHTML = `
    <div class="msg-avatar" style="font-size:11px">ℹ</div>
    <div class="msg-body">
      <div class="msg-content" style="color:var(--text-secondary);border-color:var(--border)">${esc(text)}</div>
    </div>
  `;
  $messages.appendChild(el);
  scrollChat();
}

function clearAll() {
  $messages.innerHTML = '';
  clearLog();
  currentAgentEl = null;
  lastScreenshotB64 = null;
  currentStep = 0;
  $stepCounter.style.display = 'none';
  $stepNum.textContent = '0';
  $vpEmpty.style.display = 'flex';
  $vpWrap.style.display = 'none';
  hideViewportThinking();
  $urlDisplay.textContent = 'about:blank';
  $urlInput.value = '';
  $vpStatusLabel.textContent = 'Waiting…';
  $vpStatusDot.classList.remove('active');
}

// ── Activity Log ──────────────────────────────────────────────────────────────
const ICONS = {
  browser_navigate:  '🌐',
  browser_click:     '👆',
  browser_type:      '⌨️',
  browser_press_key: '⌨️',
  browser_scroll:    '↕️',
  browser_read_page: '📄',
  browser_new_tab:   '➕',
  browser_list_tabs: '📑',
  browser_js:        '⚡',
  read_skill:        '📖',
};

function addActivityRow(msg) {
  clearEmpty();
  const { tool, args = {}, step = '' } = msg;
  const icon = ICONS[tool] || '🔧';
  let summary = '';
  if (args.url)              summary = args.url;
  else if (args.text)        summary = `"${String(args.text).slice(0, 35)}"`;
  else if (args.x !== undefined) summary = `(${args.x}, ${args.y})${args.reason ? ' — ' + args.reason : ''}`;
  else if (args.key)         summary = args.key;
  else if (args.skill_path)  summary = args.skill_path;
  else if (args.expression)  summary = String(args.expression).slice(0, 40);

  if (tool === 'browser_click' && args.x !== undefined) {
    flashClickOverlay(args.x, args.y);
  }

  const row = document.createElement('div');
  row.className = 'activity-row';
  row.dataset.tool = tool;
  row.dataset.step = step;
  row.innerHTML = `
    <div class="activity-icon">${icon}</div>
    <div class="activity-body">
      <div class="activity-tool">${esc(tool)}</div>
      ${summary ? `<div class="activity-args">${esc(summary)}</div>` : ''}
      <div class="activity-meta">
        <span class="activity-status status-run">running</span>
        ${step ? `<span class="activity-duration">step ${step}</span>` : ''}
      </div>
    </div>
  `;
  $actLog.appendChild(row);
  $actLog.scrollTop = $actLog.scrollHeight;
}

function markToolDone(msg) {
  const { tool, duration_ms, success } = msg;
  const rows = [...$actLog.querySelectorAll(`[data-tool="${tool}"]`)];
  const row = rows[rows.length - 1];
  if (!row) return;
  const statusEl = row.querySelector('.activity-status');
  const durEl    = row.querySelector('.activity-duration');
  if (statusEl) {
    statusEl.className = `activity-status ${success ? 'status-ok' : 'status-err'}`;
    statusEl.textContent = success ? 'done' : 'error';
  }
  if (durEl && duration_ms !== undefined) {
    durEl.textContent = duration_ms < 1000 ? `${duration_ms}ms` : `${(duration_ms/1000).toFixed(1)}s`;
  }
}

function addSkillRow(skill) {
  clearEmpty();
  const row = document.createElement('div');
  row.className = 'activity-row skill-row';
  row.innerHTML = `
    <div class="activity-icon">📖</div>
    <div class="activity-body">
      <div class="activity-tool">${esc(skill)}</div>
      <div class="activity-args">skill loaded into context</div>
    </div>
  `;
  $actLog.appendChild(row);
  $actLog.scrollTop = $actLog.scrollHeight;
}

function addScreenshotRow(msg) {
  clearEmpty();
  const { data, url, step } = msg;
  const row = document.createElement('div');
  row.className = 'activity-row screenshot-row';
  row.innerHTML = `
    <div class="screenshot-meta">
      <span>📸</span>
      <span class="screenshot-url">${esc(url || 'screenshot')}</span>
      ${step ? `<span style="flex-shrink:0">step ${step}</span>` : ''}
    </div>
    <img class="activity-screenshot" src="data:image/png;base64,${data}" alt="Screenshot" loading="lazy" />
  `;
  row.querySelector('img').addEventListener('click', () => {
    const w = window.open('', '_blank');
    w.document.write(`<body style="margin:0;background:#000"><img src="data:image/png;base64,${data}" style="max-width:100%;display:block"></body>`);
  });
  $actLog.appendChild(row);
  $actLog.scrollTop = $actLog.scrollHeight;
}

function addActivityDivider(text) {
  const el = document.createElement('div');
  el.className = 'activity-divider';
  el.textContent = text;
  $actLog.appendChild(el);
  $actLog.scrollTop = $actLog.scrollHeight;
}

function clearEmpty() {
  const el = $actLog.querySelector('.activity-empty');
  if (el) el.remove();
}

function clearLog() {
  $actLog.innerHTML = `
    <div class="activity-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.3)" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <p>Activity will stream here as the agent executes tasks.</p>
    </div>
  `;
}

// ── Input ─────────────────────────────────────────────────────────────────────
function sendMessage() {
  const text = $input.value.trim();
  if (!text || isRunning) return;
  addUserMsg(text);
  $input.value = '';
  autoResize();
  setRunning(true);
  sendJson({ type: 'user_message', text });
}

function setRunning(v) {
  isRunning = v;
  $sendBtn.disabled = v;
  $input.disabled   = v;
  if (!v) $input.focus();
}

function setInputEnabled(v) {
  if (!v) { $sendBtn.disabled = true; $input.disabled = true; }
  else if (!isRunning) { $sendBtn.disabled = false; $input.disabled = false; }
}

function autoResize() {
  $input.style.height = 'auto';
  $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
}

$sendBtn.addEventListener('click', sendMessage);
$input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
$input.addEventListener('input', autoResize);

// ── URL bar navigation ────────────────────────────────────────────────────────
function navigateToUrl() {
  let url = $urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  if (!isRunning) {
    addUserMsg(`Go to ${url}`);
    setRunning(true);
    sendJson({ type: 'user_message', text: `Navigate to ${url}` });
  }
}

$btnGo.addEventListener('click', navigateToUrl);
$urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigateToUrl(); });

// ── Buttons ───────────────────────────────────────────────────────────────────
$newSession.addEventListener('click', () => {
  if (isRunning) return;
  sendJson({ type: 'new_session' });
});

$clearLog.addEventListener('click', clearLog);

$btnScreenshot.addEventListener('click', () => {
  if (!isRunning) {
    addUserMsg('Take a screenshot of the current page');
    setRunning(true);
    sendJson({ type: 'user_message', text: 'Take a screenshot of the current browser page and describe what you see.' });
  }
});

// ── Suggestion chips ──────────────────────────────────────────────────────────
function insertSuggestion(btn) {
  $input.value = btn.textContent;
  autoResize();
  $input.focus();
}

// ── Click on viewport to send coordinates ─────────────────────────────────────
$vpImg.addEventListener('click', (e) => {
  if (isRunning) return;
  const rect = $vpImg.getBoundingClientRect();
  const scaleX = ($vpImg.naturalWidth  || rect.width)  / rect.width;
  const scaleY = ($vpImg.naturalHeight || rect.height) / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top)  * scaleY);
  const msg = `Click at (${x}, ${y}) on the current page`;
  addUserMsg(msg);
  setRunning(true);
  sendJson({ type: 'user_message', text: msg });
});

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(state, label) {
  $statusPill.className = `status-pill status-${state}`;
  $statusLabel.textContent = label;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function scrollChat() {
  requestAnimationFrame(() => { $messages.scrollTop = $messages.scrollHeight; });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMd(text) {
  if (!text) return '';
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:11px;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:3px">$1</code>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul style="padding-left:16px;margin:5px 0">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin-top:7px">')
    .replace(/\n/g, '<br>');
}

// ── Keepalive ─────────────────────────────────────────────────────────────────
setInterval(() => sendJson({ type: 'ping' }), 25000);

// ── Start ─────────────────────────────────────────────────────────────────────
connect();
