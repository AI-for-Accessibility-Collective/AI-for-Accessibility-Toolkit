// text-size.js — Text size and spacing.
// Barrier: Low vision and reading difficulties (such as dyslexia) make standard
// text sizes, tight line heights, and compact letter spacing difficult or
// fatiguing to read, and small text hard to discern.
//
// Suggested in onboarding for: vision, reading (a suggestion only, never a gate).
// The person's settings it reads: fontScale, textSizeMethod, lineHeight, letterSpacing.
// What the person can adjust:
//   With the person's shortcut (s.keys.adjust, label 'Text size', settings fontScale):
//   up and down change fontScale in steps of 10 percent, 100 to 200, saved for this site
//   and announced. Line and letter spacing follow the person's settings (lineHeight, letterSpacing);
//   they adjust those in their profile.
//
// Options:
//   method: 'zoom' (browser zoom) or 'font' (text size alone). Default 'zoom'.
//   lineHeight: Number, line height multiplier up to 2 (WCAG 1.4.12).
//   letterSpacing: Number, letter spacing in em up to 0.12 (WCAG 1.4.12).
//   wordSpacing: Number, word spacing in em up to 0.16 (WCAG 1.4.12).
//   paragraphSpacing: Number, paragraph spacing margin-bottom in em up to 2 (WCAG 1.4.12).
//   wcagSpacing: Boolean, apply full WCAG 1.4.12 spacing defaults when true.
//
// Decisions:
//   • Uses s.zoom.method() to arbitrate between browser zoom and text size alone; never both.
//   • With 'zoom', sets browser zoom (s.zoom.set) to fontScale/100 and restores on disable().
//   • With 'font', scales text sizes using s.text.scale, preserving proportions and px sizes without compounding.
//   • When no fontScale is asked (<= 100 or unset), s.zoom is never called and the page is unchanged.
//   • Shortcut adjuster (s.keys.adjust) steps fontScale by 10% (100–200%), saves for this site (s.profile.set),
//     and announces the applied size.
//   • Spacing is injected as one scoped stylesheet (s.css), targeting text elements without breaking icon fonts.
//   • Detects boxes whose text would be cut off by fixed heights and allows them to grow (height: auto, min-height).
//   • Watches for content added dynamically (s.watch.added) to ensure proper sizing without double-scaling.
//   • Uses overflow-wrap: break-word to prevent sideways scrolling at 320px.
//
// What it cannot do:
//   • Cannot scale text rendered inside bitmap images or canvas elements.
//   • Cannot resize browser UI outside the web page content.

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());

    const doc = document;
    const win = window;
    const body = doc.body;

    // Snapshot pre-existing overflowing boxes before any styles or scales are applied
    const wasOverflowing = new WeakSet();
    if (body) {
      for (const el of body.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 1) {
          wasOverflowing.add(el);
        }
      }
    }

    const personal = s.profile.get() || {};
    const method = s.zoom.method(this.options.method || 'zoom');

    let currentAppliedScale = null;
    let hasZoomed = false;

    // Expand boxes with fixed height or max-height that now cut off text
    const fixClippedBoxes = () => {
      if (!body || !s.alive()) return;
      for (const el of body.querySelectorAll('*')) {
        if (wasOverflowing.has(el)) continue;
        if (el.scrollHeight > el.clientHeight + 1) {
          const cs = win.getComputedStyle(el);
          if (cs.display === 'inline' || /^(auto|scroll)$/.test(cs.overflowY)) continue;
          if (cs.height !== 'auto') {
            s.setStyle(el, 'min-height', cs.height);
            s.setStyle(el, 'height', 'auto', 'important');
          }
          if (cs.maxHeight !== 'none') {
            s.setStyle(el, 'max-height', 'none', 'important');
          }
        }
      }
    };

    // Apply or update text scaling via zoom or s.text.scale
    const applyFontScale = async (scale) => {
      if (!s.alive()) return;
      let raw = scale !== undefined && scale !== null ? Number(scale) : null;
      if (raw !== null && Number.isFinite(raw)) {
        if (raw > 0 && raw <= 2) raw = Math.round(raw * 100);
        raw = Math.max(100, Math.min(200, Math.round(raw)));
      } else {
        raw = 100;
      }

      if (raw === currentAppliedScale) return;
      currentAppliedScale = raw;

      if (method === 'zoom') {
        if (raw > 100) {
          hasZoomed = true;
          await s.zoom.set(raw / 100);
        } else if (hasZoomed) {
          await s.zoom.set(1.0);
        }
      } else {
        // Text size alone (method === 'font')
        if (raw > 100) {
          s.text.scale(raw / 100);
        } else if (currentAppliedScale !== null) {
          s.text.scale(1.0);
        }
      }
    };

    // Apply WCAG 1.4.12 text spacing via one stylesheet
    const applySpacing = (p = {}) => {
      if (!s.alive()) return;
      const opts = this.options;
      const wcag = opts.wcagSpacing;

      const rawLh = p.lineHeight ?? opts.lineHeight ?? (wcag ? 2 : undefined);
      const rawLs = p.letterSpacing ?? opts.letterSpacing ?? (wcag ? 0.12 : undefined);
      const rawWs = opts.wordSpacing ?? (wcag ? 0.16 : undefined);
      const rawPs = opts.paragraphSpacing ?? (wcag ? 2 : undefined);

      const lh = rawLh !== undefined && rawLh !== null ? Math.min(2, Math.max(1, Number(rawLh))) : null;
      const ls = rawLs !== undefined && rawLs !== null ? Math.min(0.12, Math.max(0, Number(rawLs))) : null;
      const ws = rawWs !== undefined && rawWs !== null
        ? (rawWs === true ? 0.16 : Math.min(0.16, Math.max(0, Number(rawWs))))
        : (ls !== null && ls > 0 ? 0.16 : null);
      const ps = rawPs !== undefined && rawPs !== null
        ? (rawPs === true ? 2 : Math.min(2, Math.max(0, Number(rawPs))))
        : null;

      if (!lh && !ls && !ws && !ps) return;

      const textProps = [];
      if (lh) textProps.push(`line-height: ${lh} !important;`);
      if (ls) textProps.push(`letter-spacing: ${ls}em !important;`);
      if (ws) textProps.push(`word-spacing: ${ws}em !important;`);
      textProps.push(`overflow-wrap: break-word !important;`);

      const rules = [];
      if (textProps.length) {
        rules.push(`
body {
  ${textProps.join('\n  ')}
}
p, li, dd, dt, label, blockquote, figcaption, h1, h2, h3, h4, h5, h6 {
  ${textProps.join('\n  ')}
}
`);
      }

      if (ps) {
        rules.push(`
p, [role="paragraph"] {
  margin-block-end: ${ps}em !important;
  margin-bottom: ${ps}em !important;
}
`);
      }

      // Preserve icon fonts from ligature breakdown and prevent radio/checkbox deformation
      rules.push(`
[aria-hidden="true"], [class*="icon"], [class*="material-"], [class*="fa-"], i, svg {
  letter-spacing: normal !important;
  word-spacing: normal !important;
}
input[type="radio"], input[type="checkbox"] {
  flex-shrink: 0 !important;
}
`);

      s.css('text-spacing', rules.join('\n'));
    };

    // Apply initial settings if present
    applySpacing(personal);
    await applyFontScale(personal.fontScale);
    fixClippedBoxes();

    // Register shortcut adjuster for Text size (fontScale 100-200 in 10% steps)
    s.keys.adjust({
      label: 'Text size',
      settings: ['fontScale'],
      up: async () => {
        const cur = s.profile.get('fontScale') || 100;
        const next = Math.min(200, Math.round(cur / 10) * 10 + 10);
        const res = await s.profile.set({ fontScale: next });
        if (res && res.applied) {
          s.announce(`Text size ${next}% on this site.`);
          await applyFontScale(next);
          fixClippedBoxes();
        }
      },
      down: async () => {
        const cur = s.profile.get('fontScale') || 100;
        const next = Math.max(100, Math.round(cur / 10) * 10 - 10);
        const res = await s.profile.set({ fontScale: next });
        if (res && res.applied) {
          s.announce(`Text size ${next}% on this site.`);
          await applyFontScale(next);
          fixClippedBoxes();
        }
      },
    });

    // Follow profile changes dynamically
    s.profile.onChange((updated, changed) => {
      if (changed && 'fontScale' in changed) {
        applyFontScale(changed.fontScale);
        fixClippedBoxes();
      }
      if (changed && ('lineHeight' in changed || 'letterSpacing' in changed)) {
        applySpacing(updated);
        fixClippedBoxes();
      }
    });

    // Watch for dynamically added elements to prevent text cut-off
    if (body) {
      s.watch.added(
        body,
        (el) => {
          for (let p = el; p && p !== body; p = p.parentElement) {
            if (wasOverflowing.has(p)) continue;
            if (p.scrollHeight > p.clientHeight + 1) {
              const cs = win.getComputedStyle(p);
              if (cs.display === 'inline' || /^(auto|scroll)$/.test(cs.overflowY)) continue;
              if (cs.height !== 'auto') {
                s.setStyle(p, 'min-height', cs.height);
                s.setStyle(p, 'height', 'auto', 'important');
              }
              if (cs.maxHeight !== 'none') {
                s.setStyle(p, 'max-height', 'none', 'important');
              }
            }
          }
        },
        { debounceMs: 150 }
      );
    }

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
