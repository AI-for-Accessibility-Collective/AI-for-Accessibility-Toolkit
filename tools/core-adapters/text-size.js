// text-size.js — Makes text bigger and gives it more room, as the person's settings say.
// Barrier: Small text and cramped line or letter spacing make reading difficult or
// exhausting for people with low vision, dyslexia, or reading barriers.
//
// Suggested in onboarding for: vision, reading (a suggestion only, never a gate).
// The person's settings it reads: fontScale, textSizeMethod, lineHeight, letterSpacing.
// What the person can adjust: With the person's shortcut (s.keys.adjust, label 'Text size',
// settings fontScale): up and down change fontScale in steps of 10 percent, 100 to 200,
// saved for this site and announced. Line and letter spacing follow the person's settings
// (lineHeight, letterSpacing); they adjust those in their profile.
//
// Options:
//   method: 'zoom' (browser zoom) or 'font' (text size only). Defaults to 'zoom'.
//   fontScale: Initial text scale in percent (100–200). Defaults to 100.
//   lineHeight: Line spacing multiplier (1–2).
//   letterSpacing: Letter spacing in em (0–0.12).
//   wordSpacing: Word spacing in em (0–0.16).
//   paragraphSpacing: Paragraph spacing in em (up to 2).
//
// Decisions:
//   • Text size uses the browser's zoom or text size alone, as s.zoom.method() says, never both.
//   • With 'zoom', zoom is set to fontScale/100 and put back on disable().
//   • With 'font', scales text elements directly (s.text.scale) without touching zoom.
//   • Applies once, in enable(). When no setting asks for anything, changes nothing and reads
//     no element's layout, but keeps running so the shortcut can adjust it there.
//   • Spacing is one stylesheet following WCAG 1.4.12, wrapped in s.text.fit(() => s.css(...)),
//     growing only the boxes that the spacing change caused to cut text off.
//   • Never touches or grows boxes that cut text off by design before changes (e.g. teasers, cards).
//   • Handles dynamically added text without compounding or double-scaling.
//   • Listens for shortcut adjustments (s.keys.adjust) and profile changes (s.profile.onChange).
//   • Announces changes made by the shortcut via s.announce; announces nothing on load.
//
// What it cannot do:
//   • Does not modify text embedded in raster images, SVG graphics, or video frames.
//   • Cannot expand boxes that have hard fixed dimensions preventing content expansion without
//     breaking outer container layout beyond the three-level ancestor hierarchy.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const doc = document;
    if (!doc || (!doc.body && !doc.documentElement)) return false;

    const s = (this.s = this.toolkit.session());

    let currentScale = 100;
    let lastAppliedMethod = null;

    const getTargetScale = () => {
      const raw = s.profile.get('fontScale') ?? this.options.fontScale;
      if (raw === undefined || raw === null) return 100;
      const num = Number(raw);
      if (!Number.isFinite(num)) return 100;
      const scale = num <= 10 ? Math.round(num * 100) : Math.round(num);
      return Math.max(100, Math.min(200, scale));
    };

    const applyFontScale = async (scale) => {
      currentScale = scale;
      const factor = Math.round((scale / 100) * 100) / 100;
      const method = s.zoom.method(this.options.method || 'zoom');

      if (lastAppliedMethod && lastAppliedMethod !== method) {
        if (lastAppliedMethod === 'zoom') {
          await s.zoom.set(1);
        } else if (lastAppliedMethod === 'font') {
          s.text.scale(1);
        }
      }

      if (method === 'zoom') {
        await s.zoom.set(factor);
      } else {
        s.text.scale(factor);
      }
      lastAppliedMethod = method;
    };

    const applySpacing = () => {
      const lineH = s.profile.get('lineHeight') ?? this.options.lineHeight;
      const letterSp = s.profile.get('letterSpacing') ?? this.options.letterSpacing;
      const wordSp = this.options.wordSpacing ?? (letterSp !== undefined && letterSp !== null ? 0.16 : undefined);
      const paraSp = this.options.paragraphSpacing !== undefined ? (this.options.paragraphSpacing === true ? 2 : this.options.paragraphSpacing) : undefined;

      const hasLh = lineH !== undefined && lineH !== null && Number(lineH) > 0;
      const hasLs = letterSp !== undefined && letterSp !== null && Number(letterSp) > 0;
      const hasWs = wordSp !== undefined && wordSp !== null && Number(wordSp) > 0;
      const hasPs = paraSp !== undefined && paraSp !== null && Number(paraSp) > 0;

      if (!hasLh && !hasLs && !hasWs && !hasPs) return;

      let props = '';
      if (hasLh) props += `  line-height: ${Math.min(2, Math.max(1, Number(lineH)))} !important;\n`;
      if (hasLs) props += `  letter-spacing: ${Math.min(0.12, Math.max(0, Number(letterSp)))}em !important;\n`;
      if (hasWs) props += `  word-spacing: ${Math.min(0.16, Math.max(0, Number(wordSp)))}em !important;\n`;

      let css = '';
      if (props) {
        css += `body, p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, label, blockquote, figcaption, a, button, input, select, textarea {\n${props}}\n`;
      }
      if (hasPs) {
        css += `p {\n  margin-bottom: ${Math.min(2, Math.max(0, Number(paraSp)))}em !important;\n}\n`;
      }
      css += `input[type="radio"], input[type="checkbox"] {\n  flex-shrink: 0 !important;\n}\n`;
      css += `[data-ai4a11y-ui], [data-ai4a11y-ui] *, [class*="icon"], [class*="material-"], [class*="fa-"], svg, math {\n  letter-spacing: normal !important;\n  word-spacing: normal !important;\n}\n`;

      s.text.fit(() => {
        s.css('spacing', css);
      });
    };

    const targetScale = getTargetScale();
    const hasFontScaleSetting = (s.profile.get('fontScale') !== undefined && s.profile.get('fontScale') !== null) ||
                                (this.options.fontScale !== undefined && this.options.fontScale !== null);

    if (hasFontScaleSetting && targetScale !== 100) {
      applyFontScale(targetScale);
    } else {
      currentScale = 100;
    }

    applySpacing();

    s.keys.adjust({
      label: 'Text size',
      settings: ['fontScale'],
      up: async () => {
        const next = Math.min(200, Math.round(currentScale / 10) * 10 + 10);
        if (next !== currentScale) {
          const res = await s.profile.set({ fontScale: next });
          if (res && res.applied) {
            await applyFontScale(next);
            s.announce(`Text size ${next}% on this site.`);
          }
        }
      },
      down: async () => {
        const prev = Math.max(100, Math.round(currentScale / 10) * 10 - 10);
        if (prev !== currentScale) {
          const res = await s.profile.set({ fontScale: prev });
          if (res && res.applied) {
            await applyFontScale(prev);
            s.announce(`Text size ${prev}% on this site.`);
          }
        }
      },
    });

    s.profile.onChange((personal, changed) => {
      if (!changed) return;
      if ('fontScale' in changed || 'textSizeMethod' in changed) {
        const target = getTargetScale();
        if (target !== currentScale || ('textSizeMethod' in changed && lastAppliedMethod)) {
          applyFontScale(target);
        }
      }
      if ('lineHeight' in changed || 'letterSpacing' in changed) {
        applySpacing();
      }
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
