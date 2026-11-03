// Plain language: lets the person read long or hard paragraphs in plain
// language at their reading level, on request.
//
//   export default { enable(options, toolkit), disable() }
//
// Barrier:
//   Complex, jargon-heavy, or overly long text that is difficult to process,
//   for people who benefit from plain language.
//
// Suggested in onboarding for:
//   cognitive, reading (a suggestion only, never a gate).
//
// The person's settings it reads:
//   readingLevel ('plain', 'easy-read', or grade 1-12). s.ai.text passes this
//   to the simplification prompt.
//
// What the person can adjust:
//   Nothing in the profile (reading level is a profile field, not a setting);
//   the person chooses which paragraphs to simplify by activating their
//   individual "Plain language" buttons.
//
// Options:
//   minChars: minimum character length of a paragraph to offer simplification
//             (default 150).
//   maxButtons: maximum number of simplification buttons on the page
//               (default 30).
//   keep: array of terms to preserve verbatim in simplification.
//   readingLevel: fallback reading level if not set in profile.
//
// Decisions it makes:
//   - Measures before changing: finds long paragraphs in the main content
//     region only, skipping short paragraphs, navigation, tables, and forms.
//   - On-demand only: never simplifies on page load, preserving the user's
//     reading context and AI call budget.
//   - Reversible in place: uses s.text.replaceBlock so the simplified text
//     replaces the paragraph with one click to toggle back to the original.
//   - Preserves meaning: automatically extracts names, numbers, dates, and
//     link text to include in the AI prompt's keep list.
//   - Accessible controls: each button is a native <button type="button">
//     with a visible label matching its accessible name, at least 24x24 px.
//
// What it cannot do:
//   - Does not rewrite whole documents or sections at once.
//   - Does not alter tables, code snippets, or user input fields.
//   - Cannot simplify if AI is unavailable (leaves the text intact and
//     announces the failure).

const DEFAULT_MIN_CHARS = 150;
const DEFAULT_MAX_BUTTONS = 30;

function extractKeep(el, text, userKeep = []) {
  const keep = new Set(Array.isArray(userKeep) ? userKeep : []);

  if (el) {
    for (const a of el.querySelectorAll('a[href]')) {
      const linkText = a.textContent.trim();
      if (linkText && linkText.length <= 80) keep.add(linkText);
      const aria = a.getAttribute('aria-label');
      if (aria && aria.trim().length <= 80) keep.add(aria.trim());
    }
  }

  // Dates
  const datePatterns = [
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?\b/gi,
    /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  ];
  for (const re of datePatterns) {
    for (const m of text.matchAll(re)) {
      if (m[0] && m[0].length <= 80) keep.add(m[0]);
    }
  }

  // Numbers, amounts, percentages, quantities
  const numberPatterns = [
    /\b[\$€£¥]\s*\d+(?:[.,]\d+)*(?:\s*(?:million|billion|thousand))?\b/gi,
    /\b\d+(?:[.,]\d+)*\s*%\b/g,
    /\b\d+(?:[.,]\d+)*(?:\s*(?:days|hours|minutes|seconds|weeks|months|years|dollars|cents|percent))\b/gi,
    /\b\d+(?:[.,]\d+)*\b/g,
  ];
  for (const re of numberPatterns) {
    for (const m of text.matchAll(re)) {
      if (m[0] && m[0].length <= 80) keep.add(m[0]);
    }
  }

  // Names / Proper nouns
  const properNouns = text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  for (const m of properNouns) {
    if (m[0] && m[0].length <= 80) keep.add(m[0]);
  }

  return Array.from(keep).filter((s) => s && s.length <= 80).slice(0, 50);
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());

    const minChars = Math.max(20, Number(options.minChars) || DEFAULT_MIN_CHARS);
    const maxButtons = Math.max(1, Number(options.maxButtons) || DEFAULT_MAX_BUTTONS);

    const main = s.page.main();
    if (!main) {
      s.end();
      return false;
    }

    // Identify candidate paragraphs
    const paragraphs = [];
    const candidates = main.querySelectorAll('p');
    for (const p of candidates) {
      if (paragraphs.length >= maxButtons) break;
      if (s.page.isOurs(p)) continue;
      if (!s.page.isVisible(p)) continue;

      // Skip paragraphs inside non-prose or secondary structures
      if (p.closest('nav, header, footer, aside, table, form, dialog, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]')) {
        continue;
      }

      const text = s.page.readableText(p).trim();
      if (text.length < minChars) continue;

      paragraphs.push({ el: p, text });
    }

    if (!paragraphs.length) {
      s.end();
      return false;
    }

    s.css('plain-language', `
      .ai4a11y-plain-btn {
        display: inline-block;
        margin: 4px 0 10px;
        padding: 3px 10px;
        font: inherit;
        font-size: 0.85em;
        line-height: 1.4;
        min-height: 28px;
        min-width: 28px;
        border: 1px solid currentColor;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        box-sizing: border-box;
        vertical-align: middle;
      }
      .ai4a11y-plain-btn:focus-visible {
        outline: 2px solid #1a5fb4;
        outline-offset: 2px;
        box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1a5fb4;
      }
      .ai4a11y-plain-btn[disabled] {
        opacity: 0.6;
        cursor: wait;
      }
    `);

    for (const { el: p, text } of paragraphs) {
      let replaced = null;
      let state = 'initial'; // 'initial' | 'simplified' | 'original'
      let busy = false;

      const btn = s.el('button', {
        text: 'Plain language',
        attrs: {
          type: 'button',
          class: 'ai4a11y-plain-btn',
          'data-ai4a11y-plain-btn': s.id,
        },
      });

      s.listen(btn, 'click', async () => {
        if (!s.alive() || busy) return;

        if (state === 'initial') {
          busy = true;
          btn.setAttribute('disabled', '');
          btn.setAttribute('aria-busy', 'true');

          const keep = extractKeep(p, text, options.keep);
          const aiOpts = {
            keep: keep.length ? keep : undefined,
          };
          if (options.readingLevel) aiOpts.readingLevel = options.readingLevel;

          let simplified = null;
          try {
            simplified = await s.ai.text('simplify', text, aiOpts);
          } catch {
            simplified = null;
          }

          if (!s.alive()) return;

          busy = false;
          btn.removeAttribute('disabled');
          btn.removeAttribute('aria-busy');

          if (!simplified) {
            s.announce('Could not simplify this paragraph.');
            return;
          }

          replaced = s.text.replaceBlock(p, simplified, { showOriginal: false });
          if (!replaced) {
            s.announce('Could not simplify this paragraph.');
            return;
          }

          state = 'simplified';
          btn.textContent = 'Show original';
          s.announce('Paragraph simplified in plain language.');
        } else if (state === 'simplified') {
          replaced.toggle(true);
          state = 'original';
          btn.textContent = 'Show simplified';
          s.announce('Showing original paragraph.');
        } else if (state === 'original') {
          replaced.toggle(false);
          state = 'simplified';
          btn.textContent = 'Show original';
          s.announce('Showing simplified paragraph.');
        }
      });

      s.insert(p.parentNode, btn, p.nextSibling);
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
