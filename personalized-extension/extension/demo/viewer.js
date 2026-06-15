// Live diagram highlighter. Renders <img src=<diagram>.svg> with an absolute
// overlay of highlight boxes positioned in the SVG's viewBox coordinate
// system, and tails chrome.storage.local.aaDemoTrace to pulse the region the
// toolkit just invoked. Each page sets window.AA_DEMO = { diagram, viewBox:
// [w,h], regions: { id: [x,y,w,h] } } before loading this script.

(() => {
  const CFG = window.AA_DEMO;
  const [VBW, VBH] = CFG.viewBox;
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const boxes = {}; // region id -> element
  const timers = {}; // region id -> fade timeout

  // Size the inner container to fit the available space on BOTH axes,
  // preserving the SVG's aspect ratio (letterbox on whichever axis isn't the
  // bottleneck). Measure against the viewport minus the top bar directly, so
  // we don't depend on the flex container's height having resolved.
  const inner = overlay.parentElement;
  const bar = document.querySelector('.bar');
  function sizeInner() {
    const availW = window.innerWidth - 8;                 // stage padding
    const availH = window.innerHeight - bar.offsetHeight - 8;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / VBW, availH / VBH);
    inner.style.width  = Math.round(VBW * scale) + 'px';
    inner.style.height = Math.round(VBH * scale) + 'px';
    console.log('[aaDemo] sizeInner', { availW, availH, scale,
      w: inner.style.width, h: inner.style.height });
  }
  sizeInner();
  window.addEventListener('resize', sizeInner);
  // Recompute once more after first paint in case bar height shifts.
  requestAnimationFrame(sizeInner);

  // One absolutely-positioned box per region, sized as a percentage of the
  // overlay (which is locked to the image's aspect ratio, so % maps 1:1 to
  // viewBox coords).
  for (const [id, [x, y, w, h]] of Object.entries(CFG.regions)) {
    const el = document.createElement('div');
    el.className = 'hl';
    el.dataset.region = id;
    el.style.left = (x / VBW * 100) + '%';
    el.style.top = (y / VBH * 100) + '%';
    el.style.width = (w / VBW * 100) + '%';
    el.style.height = (h / VBH * 100) + '%';
    const tag = document.createElement('span');
    tag.className = 'hl-tag';
    el.appendChild(tag);
    overlay.appendChild(el);
    boxes[id] = el;
  }

  function activate(region, label) {
    const el = boxes[region];
    if (!el) return;
    el.classList.add('active');
    el.querySelector('.hl-tag').textContent = label || region;
    if (statusEl) statusEl.textContent = '▶ ' + (label || region);
    clearTimeout(timers[region]);
    timers[region] = setTimeout(() => el.classList.remove('active'), 6000);
  }

  // Tail the trace. seen = number of events already processed.
  let seen = 0;
  function processAll(arr) {
    if (!arr) return;
    if (arr.length < seen) seen = 0; // log was cleared/reset
    for (let i = seen; i < arr.length; i++) {
      const ev = arr[i];
      if (ev && ev.diagram === CFG.diagram) activate(ev.region, ev.label);
    }
    seen = arr.length;
  }

  chrome.storage.local.get('aaDemoTrace', (d) => {
    // On load, mark existing events as seen WITHOUT pulsing (don't replay
    // history) — only react to what happens from now on.
    seen = ((d && d.aaDemoTrace) || []).length;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.aaDemoTrace) {
      processAll(changes.aaDemoTrace.newValue || []);
    }
  });

  // Opening a diagram page turns demo mode on (loosens the Librarian's
  // proposal gating so the scripted beats fire reliably).
  chrome.runtime.sendMessage({ type: 'aaSetDemoMode', on: true });

  function clearHighlights() {
    for (const id in boxes) { boxes[id].classList.remove('active'); clearTimeout(timers[id]); }
    seen = 0;
  }

  // Toolbar. "Reset" just clears the visual trace; "Reset demo" wipes the
  // accumulated proposal/profile/suppression state so the suggestion +
  // adaptive beats start clean on the next rehearsal.
  const resetBtn = document.getElementById('reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      clearHighlights();
      chrome.storage.local.set({ aaDemoTrace: [] });
      if (statusEl) statusEl.textContent = 'reset — waiting for activity…';
    });
  }
  const resetDemoBtn = document.getElementById('resetDemo');
  if (resetDemoBtn) {
    resetDemoBtn.addEventListener('click', () => {
      clearHighlights();
      chrome.runtime.sendMessage({ type: 'aaResetDemo' }, (r) => {
        if (statusEl) statusEl.textContent = r && r.ok
          ? `demo state cleared (${r.removedProfiles || 0} auto-profile removed)`
          : 'demo reset failed — see console';
      });
    });
  }
})();
