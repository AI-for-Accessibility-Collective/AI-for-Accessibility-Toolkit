// text-size.js — Makes text bigger and gives it more room, as the person's settings say.
// Barrier: People with low vision or reading barriers need larger text and increased
// line and letter spacing to read comfortably without visual crowding or clipping.
//
// Suggested in onboarding for: vision, reading (a suggestion only, never a gate).
// The person's settings it reads: fontScale, textSizeMethod, lineHeight, letterSpacing.
// What the person can adjust:
//   • With the person's shortcut (s.keys.adjust, label 'Text size', settings ['fontScale']):
//     up and down change fontScale in steps of 10 percent, 100 to 200, saved for this site
//     and announced.
//   • Line and letter spacing follow the person's settings (lineHeight, letterSpacing),
//     adjusted in their profile.
//
// Options:
//   method: 'zoom' | 'font'. Preferred text sizing method when not set in profile. Defaults to 'zoom'.
//
// Decisions:
//   • Text size uses the browser's zoom or text size alone (s.zoom.method()), never both.
//   • Text size alone uses s.text.scale, which measures before scaling and never compounds.
//   • Spacing follows WCAG 1.4.12 and is applied via a single stylesheet wrapped in s.text.fit,
//     growing only the boxes the spacing made cut text off.
//   • Boxes cut off by design (e.g. teasers, truncated cards) are left untouched.
//   • Where no setting asks for anything, it keeps running and changes nothing (no zoom call
//     or text scale) so the shortcut can adjust it there.
//   • Turning spacing off removes the spacing stylesheet; letterSpacing 0 asks for no spacing.
//
// What it cannot do:
//   • Cannot scale text rendered inside bitmap images or canvas elements.
//   • Does not force layout changes on iframes from other origins.

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());

    this.hasScaled = false;
    this.appliedMethod = null;
    this.spacingSheet = null;

    s.keys.adjust({
      label: 'Text size',
      settings: ['fontScale'],
      up: async () => {
        const cur = (s.profile.get('fontScale') != null && Number.isFinite(Number(s.profile.get('fontScale'))))
          ? Number(s.profile.get('fontScale'))
          : 100;
        const next = Math.min(200, Math.round(cur / 10) * 10 + 10);
        if (next !== cur) {
          const res = await s.profile.set({ fontScale: next });
          if (res && res.applied) {
            s.announce(`Text size ${next}% on this site.`);
          }
        }
      },
      down: async () => {
        const cur = (s.profile.get('fontScale') != null && Number.isFinite(Number(s.profile.get('fontScale'))))
          ? Number(s.profile.get('fontScale'))
          : 100;
        const next = Math.max(100, Math.round(cur / 10) * 10 - 10);
        if (next !== cur) {
          const res = await s.profile.set({ fontScale: next });
          if (res && res.applied) {
            s.announce(`Text size ${next}% on this site.`);
          }
        }
      },
    });

    const applySettings = async (personal) => {
      if (!s.alive()) return;
      const p = personal || {};

      // Spacing
      const lh = p.lineHeight;
      const ls = p.letterSpacing;
      const hasLineHeight = typeof lh === 'number' && Number.isFinite(lh) && lh > 0;
      const hasLetterSpacing = typeof ls === 'number' && Number.isFinite(ls) && ls > 0;

      if (hasLineHeight || hasLetterSpacing) {
        let rules = '';
        const textProps = [];
        if (hasLineHeight) {
          textProps.push(`line-height: ${lh} !important;`);
        }
        if (hasLetterSpacing) {
          textProps.push(`letter-spacing: ${ls}em !important;`);
          textProps.push(`word-spacing: 0.16em !important;`);
        }
        if (textProps.length > 0) {
          rules += `*:not([data-ai4a11y-ui], [data-ai4a11y-ui] *) {\n  ${textProps.join('\n  ')}\n}\n`;
        }
        if (hasLetterSpacing) {
          rules += `p:not([data-ai4a11y-ui], [data-ai4a11y-ui] *) {\n  margin-bottom: 2em !important;\n}\n`;
        }
        s.text.fit(() => {
          this.spacingSheet = s.css('spacing', rules);
          if (this.spacingSheet && this.spacingSheet.el && !this.spacingSheet.el.parentNode) {
            s.append(document.head || document.documentElement, this.spacingSheet.el);
          }
        });
      } else if (this.spacingSheet) {
        this.spacingSheet.update('');
        if (this.spacingSheet.el && this.spacingSheet.el.parentNode) {
          this.spacingSheet.el.remove();
        }
        this.spacingSheet = null;
      }

      // Text size
      const method = s.zoom.method(this.options.method || 'zoom');
      const fontScale = (p.fontScale !== undefined && p.fontScale !== null && Number.isFinite(Number(p.fontScale)))
        ? Number(p.fontScale)
        : null;

      if (fontScale === null || fontScale === 100) {
        if (this.hasScaled) {
          if (this.appliedMethod === 'zoom') {
            await s.zoom.set(1.0);
          } else if (this.appliedMethod === 'font') {
            s.text.scale(1.0);
          }
        }
      } else {
        this.hasScaled = true;
        if (method === 'zoom') {
          if (this.appliedMethod === 'font') {
            s.text.scale(1.0);
          }
          this.appliedMethod = 'zoom';
          await s.zoom.set(fontScale / 100);
        } else {
          if (this.appliedMethod === 'zoom') {
            await s.zoom.set(1.0);
          }
          this.appliedMethod = 'font';
          s.text.scale(fontScale / 100);
        }
      }
    };

    s.profile.onChange((personal) => {
      applySettings(personal);
    });

    await applySettings(s.profile.get());
  },

  disable() {
    this.s?.end();
    this.s = null;
    this.hasScaled = false;
    this.appliedMethod = null;
    this.spacingSheet = null;
  },
};
