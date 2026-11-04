// text-size.js — Makes text bigger and gives it more room, as the person's settings say.
// Barrier: Small text and tightly spaced lines or letters are difficult or impossible
// to read for people with low vision, dyslexia, or other reading and visual processing differences.
//
// Suggested in onboarding for: vision, reading (a suggestion only, never a gate).
// The person's settings it reads: fontScale, textSizeMethod, lineHeight, letterSpacing.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Text size',
// settings fontScale): up and down change fontScale in steps of 10 percent, 100 to 200,
// saved for this site and announced. Line and letter spacing follow the person's settings
// (lineHeight, letterSpacing); they adjust those in their profile.
//
// Options:
//   method: 'zoom' (browser zoom) or 'font' (text size alone). Defaults to 'zoom'
//           (overridden by the person's profile textSizeMethod).
//   fontScale: Default text size percentage (100 to 200) if not set in profile.
//   lineHeight: Default line height (1 to 2) if not set in profile.
//   letterSpacing: Default letter spacing in em (0 to 0.12) if not set in profile.
//
// Decisions:
//   • Uses browser zoom or text size alone, as s.zoom.method() says, never both.
//   • With 'zoom', browser zoom reflows the page as the person's own zoom does (via s.zoom.set);
//     original zoom is put back on disable().
//   • With 'font', scales text sizes (including pixel sizes) via s.text.scale; zoom is never touched.
//   • Where no setting asks for anything on load, keeps running without changing anything or reading
//     element layout, allowing the shortcut to adjust size on the page.
//   • Spacing follows WCAG 1.4.12: line height up to 2, letter spacing up to 0.12 em, word spacing 0.16 em,
//     and paragraph spacing 2 em when any spacing setting is active.
//   • Spacing is one stylesheet applied through s.text.fit(() => s.css(...)), which grows only boxes
//     the spacing made cut text off, leaving intentionally truncated boxes alone.
//   • Size is applied first, then spacing.
//   • Each setting the person can turn off lives in its own s.group(): turning it off is that group's end().
//   • When fontScale returns to 100%, forgets what was scaled by ending its group.
//   • Dynamically added text is sized as it arrives via the building blocks' watchers.
//   • Announces fontScale adjustments ("Text size N% on this site.") only after the person's shortcut action.
//
// What it cannot do:
//   • Cannot scale text burned into raster images (bitmaps) or canvas drawings.
//   • Cannot expand fixed-dimension container elements that clip via CSS overflow: scroll or auto.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    let sizeGroup = null;
    let spacingGroup = null;
    let zoomApplied = false;

    const applySize = (fontScale, method) => {
      const isZoom = method === 'zoom';
      const scaleVal = fontScale !== undefined && fontScale !== null ? Number(fontScale) : null;
      const isScaled = scaleVal !== null && scaleVal > 100;

      if (isZoom) {
        // Zoom method: clean up any font scaling group
        if (sizeGroup) {
          sizeGroup.text.scale(1);
          sizeGroup.end();
          sizeGroup = null;
        }

        if (isScaled) {
          s.zoom.set(scaleVal / 100);
          zoomApplied = true;
        } else if (zoomApplied) {
          // Previously zoomed, now back at 100% or unset after adjustment
          s.zoom.set(1);
        }
      } else {
        // Font method: zoom is never touched
        if (zoomApplied) {
          s.zoom.set(1);
          zoomApplied = false;
        }

        if (isScaled) {
          if (!sizeGroup) sizeGroup = s.group();
          sizeGroup.text.scale(scaleVal / 100);
        } else {
          // Back at 100%: forget what was scaled
          if (sizeGroup) {
            sizeGroup.text.scale(1);
            sizeGroup.end();
            sizeGroup = null;
          }
        }
      }
    };

    const applySpacing = (lineHeight, letterSpacing) => {
      const hasLineHeight = lineHeight !== undefined && lineHeight !== null && Number(lineHeight) > 0;
      const lsNum = letterSpacing !== undefined && letterSpacing !== null ? Number(letterSpacing) : null;
      const hasLetterSpacing = lsNum !== null && lsNum > 0;
      const hasSpacing = hasLineHeight || hasLetterSpacing;

      if (!hasSpacing) {
        if (spacingGroup) {
          spacingGroup.end();
          spacingGroup = null;
        }
        return;
      }

      if (spacingGroup) {
        spacingGroup.end();
        spacingGroup = null;
      }

      spacingGroup = s.group();

      const textProps = [];
      if (hasLineHeight) {
        const lh = Math.min(2, Math.max(1, Number(lineHeight)));
        textProps.push(`line-height: ${lh} !important;`);
      }

      if (hasLetterSpacing) {
        const ls = Math.min(0.12, Math.max(0, lsNum));
        textProps.push(`letter-spacing: ${ls}em !important;`);
        textProps.push(`word-spacing: 0.16em !important;`);
      }

      const rules = [];
      if (textProps.length) {
        rules.push(`body, body *:not(svg):not(svg *):not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *):not(i):not([class*="icon"]):not([class*="material-"]):not([class*="fa-"]) {\n  ${textProps.join('\n  ')}\n}`);
      }

      // Paragraph spacing comes with any spacing setting
      rules.push(`p:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *) {\n  margin-bottom: 2em !important;\n}`);
      rules.push(`input[type="radio"], input[type="checkbox"] {\n  flex-shrink: 0 !important;\n}`);

      const cssText = rules.join('\n');
      spacingGroup.text.fit(() => spacingGroup.css('text-spacing', cssText));
    };

    const applyAll = () => {
      if (!s.alive()) return;

      const fontScale = s.profile.get('fontScale') ?? this.options.fontScale;
      const lineHeight = s.profile.get('lineHeight') ?? this.options.lineHeight;
      const letterSpacing = s.profile.get('letterSpacing') ?? this.options.letterSpacing;
      const method = s.zoom.method(this.options.method || 'zoom');

      // Size first, then spacing
      applySize(fontScale, method);
      applySpacing(lineHeight, letterSpacing);
    };

    // Shortcut adjust for fontScale: up and down in 10% steps (100 to 200)
    const adjustSize = async (delta) => {
      if (!s.alive()) return;
      const current = s.profile.get('fontScale') ?? this.options.fontScale;
      const base = current !== undefined && current !== null ? Number(current) : 100;
      const next = Math.max(100, Math.min(200, Math.round((base + delta) / 10) * 10));
      if (next === current) return;

      const res = await s.profile.set({ fontScale: next });
      if (res && res.applied) {
        s.announce(`Text size ${next}% on this site.`);
      }
    };

    s.keys.adjust({
      label: 'Text size',
      settings: ['fontScale'],
      up: () => adjustSize(10),
      down: () => adjustSize(-10),
    });

    s.profile.onChange(() => {
      applyAll();
    });

    // Initial apply on load
    applyAll();
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
