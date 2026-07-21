// Live-Region Announcer — mirrors meaningful dynamic page changes into a
// polite ARIA live region so screen-reader users hear them. Many SPAs swap in
// toasts, fresh results, or status text without any aria-live region, so
// nothing is announced and blind users never learn the page changed. This
// adapter watches the main content area and speaks a short summary of what
// appeared; a page's own alert/status nodes are spoken immediately, everything
// else is debounced so a burst of inserts reads as one announcement.
//
// Reversible by construction: one visually-hidden <div> is injected and a
// MutationObserver watches for additions; disable() clears the pending
// debounce, disconnects the observer, and removes the region.
import { announce } from '../../utils/ai.js';

const REGION_ID = 'ai4a11y-live-region';
const MAX_ANNOUNCE_CHARS = 200;

export const LiveRegionAnnouncer = {
  regionId: REGION_ID,
  enabled: false,
  region: null,
  observer: null,
  debounceMs: 300,
  debounceTimer: null,
  pending: '',

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.debounceMs = options.debounceMs ?? 300;
    this.pending = '';

    // Visually hidden but exposed to assistive tech (standard sr-only recipe).
    const region = document.createElement('div');
    region.id = REGION_ID;
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    region.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    (document.body || document.documentElement).appendChild(region);
    this.region = region;

    // Watch the main content area if the page marks one, the whole body
    // otherwise. characterData is off — text tweaks inside existing nodes are
    // too noisy to speak; inserted nodes are the signal.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        this.onMutations(mutations);
      });
      const target = document.querySelector('main, [role="main"]') || document.body;
      if (target) this.observer.observe(target, { childList: true, subtree: true, characterData: false });
    }

    console.log('[AI4A11y] Live-Region Announcer enabled');
    announce('Announcing page updates');
  },

  onMutations(mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const text = this.summarize(node);
        if (!text) continue;
        if (this.isUrgent(node)) this.speak(text);
        else { this.pending = text; this.schedule(); }
      }
    }
  },

  // Short spoken summary of an inserted element, or '' if it isn't worth
  // announcing (our own region, scripts/styles, near-empty nodes).
  summarize(el) {
    if (!el || el.nodeType !== 1) return '';
    // Never mirror our own live region — that would be a feedback loop.
    if (this.region && (this.region.contains(el) || (el.contains && el.contains(this.region)))) return '';
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return '';
    let text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3) return '';
    if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + '…';
    return text;
  },

  // The page already marked this node as an announcement — speak it now.
  isUrgent(el) {
    if (!el.getAttribute) return false;
    const role = el.getAttribute('role');
    return role === 'alert' || role === 'status' || el.hasAttribute('aria-live');
  },

  speak(text) {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.pending = '';
    if (this.region) this.region.textContent = text;
  },

  schedule() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.enabled || !this.region || !this.pending) return;
      this.region.textContent = this.pending;
      this.pending = '';
    }, this.debounceMs);
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.pending = '';
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    try { (this.region || document.getElementById(REGION_ID))?.remove(); } catch { /* already gone */ }
    this.region = null;
    console.log('[AI4A11y] Live-Region Announcer disabled');
    announce('Stopped announcing page updates');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yLiveRegionAnnouncer = LiveRegionAnnouncer;
