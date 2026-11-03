// plain-language.js — Simplifies long or complex paragraphs into plain language on request.
// Barrier: Cognitive, reading, and learning barriers make dense prose, bureaucratic jargon,
// and complex sentence structures difficult to comprehend.
//
// Suggested in onboarding for: cognitive, reading (a suggestion only, never a gate).
// The person's settings it reads: readingLevel (from profile/personal settings).
// What the person can adjust: nothing in the profile (reading level is a profile field,
// not a setting); the person chooses which parts to simplify.
//
// Options:
//   minChars: Minimum character count for a paragraph to be considered long (default: 140).
//   minWords: Minimum word count for a paragraph to be considered long (default: 20).
//   maxParagraphsBeforeSection: Maximum number of long paragraphs before switching to
//     one button per section (default: 8).
//   readingLevel: Default reading level when not specified in profile (default: 'plain').
//
// Decisions:
//   • Never simplifies on load and never sends more than the paragraph asked for.
//   • Identifies long paragraphs strictly within the main content area (s.page.main()).
//   • Inserts a small 'Plain language' button after each long paragraph, or one per
//     section when long paragraphs exceed maxParagraphsBeforeSection.
//   • In section mode, each long paragraph belongs to its innermost section or article,
//     and paragraphs outside every section get one button of their own.
//   • Extracts terms to keep in prompt: proper names, numbers, dates, times, currency,
//     percentages, links' meaning, and acronyms (all capitals).
//   • While a simplification request is pending, the button retains focus with aria-disabled
//     and aria-busy, never disabled (avoiding Chrome focus-drop to page).
//   • On null AI response, leaves the paragraph untouched and announces failure.
//   • Replaces text via s.text.replaceBlock and toggles between simplified and original.
//   • Ends session before enable() returns false if no qualifying content exists.
//
// What it cannot do:
//   • Cannot simplify without an AI model available (degrades gracefully).
//   • Does not simplify data tables, code blocks, or forms.
//   • Does not translate language (use translation adapter).

function extractKeep(el) {
  const text = el.textContent || '';
  const keep = new Set();

  // Links' meaning/text
  if (el.querySelectorAll) {
    for (const a of el.querySelectorAll('a')) {
      const t = a.textContent.trim();
      if (t && t.length <= 80) keep.add(t);
    }
  }

  // Dates (e.g. January 15, 2024 or November 30, 2026)
  const dateRegex = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?\b/gi;
  for (const m of text.matchAll(dateRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0].trim());
  }

  // Times (e.g. 4:30 PM)
  const timeRegex = /\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/g;
  for (const m of text.matchAll(timeRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0].trim());
  }

  // Names with honorifics (e.g. Dr. Robert Miller)
  const honorificRegex = /\b(?:Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g;
  for (const m of text.matchAll(honorificRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0].trim());
  }

  // Acronyms (all capitals, 2+ letters)
  const acronymRegex = /\b[A-Z]{2,}\b/g;
  for (const m of text.matchAll(acronymRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0]);
  }

  // Numbers, currency, percentages
  const numRegex = /\b(?:\$\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:,\d{3})*(?:\.\d+)?(?:%|\b))\b/g;
  for (const m of text.matchAll(numRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0]);
  }

  // Multi-word proper names (e.g. Medicare Part B)
  const properRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z0-9]*)+\b/g;
  for (const m of text.matchAll(properRegex)) {
    if (m[0] && m[0].length <= 80) keep.add(m[0].trim());
  }

  return Array.from(keep).slice(0, 50);
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    const main = this.toolkit.page?.main?.() || document.querySelector('main, [role="main" i], article') || document.body;
    if (!main) {
      this.disable();
      return false;
    }

    const minChars = this.options.minChars ?? 140;
    const minWords = this.options.minWords ?? 20;

    const allP = Array.from(main.querySelectorAll('p'));
    const longParas = allP.filter((p) => {
      if (p.closest('aside, nav, header, footer, [role="complementary"], [role="navigation"]')) return false;
      if (this.toolkit.page?.isOurs?.(p)) return false;
      if (p.hidden || p.getAttribute('aria-hidden') === 'true') return false;
      if (this.toolkit.page && !this.toolkit.page.isVisible(p)) return false;
      const text = (p.textContent || '').trim();
      if (text.length < minChars) return false;
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length < minWords) return false;
      return true;
    });

    if (longParas.length === 0) {
      this.disable();
      return false;
    }

    s.css(
      'plain-language-styles',
      `.ai4a11y-plain-btn {
  display: inline-block;
  margin: 4px 0 16px;
  padding: 4px 12px;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.4;
  min-height: 28px;
  min-width: 24px;
  box-sizing: border-box;
  color: inherit;
  background-color: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  vertical-align: middle;
}
.ai4a11y-plain-btn:hover {
  background-color: rgba(128, 128, 128, 0.15);
}
.ai4a11y-plain-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.ai4a11y-plain-btn[aria-disabled="true"] {
  opacity: 0.65;
  cursor: wait;
}
.ai4a11y-plain-section-btn {
  margin: 8px 0 16px;
}`
    );

    const replacements = new Map();

    const simplifyParagraph = async (p) => {
      if (replacements.has(p)) return replacements.get(p);
      const text = p.textContent.trim();
      const readingLevel = s.profile?.get?.('readingLevel') || this.options.readingLevel || 'plain';
      const keep = extractKeep(p);
      const heading = p.closest('section, article')?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || '';
      const context = (heading ? `${heading} — ` : '') + (document.title || '');

      const simplified = await s.ai.text('simplify', text, { readingLevel, keep, context });
      if (!s.alive() || !simplified) return null;

      const rep = s.text.replaceBlock(p, simplified, { showOriginal: false });
      if (!rep) return null;

      const entry = { rep, simplified };
      replacements.set(p, entry);
      return entry;
    };

    const maxParagraphsBeforeSection = this.options.maxParagraphsBeforeSection ?? 8;
    const useSections = longParas.length > maxParagraphsBeforeSection;

    if (!useSections) {
      for (const p of longParas) {
        const btn = s.el('button', {
          text: 'Plain language',
          attrs: {
            type: 'button',
            class: 'ai4a11y-plain-btn',
          },
        });
        s.insert(p.parentNode, btn, p.nextSibling);

        let busy = false;
        s.listen(btn, 'click', async () => {
          if (!s.alive() || busy || btn.getAttribute('aria-disabled') === 'true') return;
          const existing = replacements.get(p);
          if (existing) {
            const showingOrig = existing.rep.showingOriginal;
            existing.rep.toggle(!showingOrig);
            if (existing.rep.showingOriginal) {
              btn.textContent = 'Plain language';
              s.announce('Original text shown.');
            } else {
              btn.textContent = 'Show original';
              s.announce('Simplified text shown.');
            }
            return;
          }

          busy = true;
          s.setAttr(btn, 'aria-busy', 'true');
          s.setAttr(btn, 'aria-disabled', 'true');
          try {
            const res = await simplifyParagraph(p);
            if (!s.alive()) return;
            if (res) {
              btn.textContent = 'Show original';
              s.announce('Simplified text shown.');
            } else {
              s.announce('Could not simplify this text.');
            }
          } finally {
            if (s.alive()) {
              busy = false;
              s.setAttr(btn, 'aria-busy', null);
              s.setAttr(btn, 'aria-disabled', null);
            }
          }
        });
      }
    } else {
      // Group paragraphs by innermost section or article; outside paragraphs get their own group
      const sectionMap = new Map();
      const outsideParas = [];

      for (const p of longParas) {
        const sec = p.closest('section, article');
        if (sec && main.contains(sec)) {
          if (!sectionMap.has(sec)) {
            sectionMap.set(sec, []);
          }
          sectionMap.get(sec).push(p);
        } else {
          outsideParas.push(p);
        }
      }

      const groups = [];
      for (const [sec, paras] of sectionMap.entries()) {
        groups.push({ container: sec, paras });
      }
      if (outsideParas.length > 0) {
        groups.push({ container: null, paras: outsideParas });
      }

      for (const group of groups) {
        const { container, paras } = group;
        const btn = s.el('button', {
          text: 'Plain language',
          attrs: {
            type: 'button',
            class: 'ai4a11y-plain-btn ai4a11y-plain-section-btn',
          },
        });

        if (container) {
          const heading = container.querySelector('h1, h2, h3, h4, h5, h6');
          if (heading && container.contains(heading)) {
            s.insert(heading.parentNode, btn, heading.nextSibling);
          } else {
            s.insert(container, btn, container.firstChild);
          }
        } else {
          const firstP = paras[0];
          s.insert(firstP.parentNode, btn, firstP);
        }

        let secBusy = false;
        s.listen(btn, 'click', async () => {
          if (!s.alive() || secBusy || btn.getAttribute('aria-disabled') === 'true') return;
          const allExisting = paras.every((p) => replacements.has(p));
          if (allExisting) {
            const anyShowingOriginal = paras.some((p) => replacements.get(p)?.rep.showingOriginal);
            if (anyShowingOriginal) {
              for (const p of paras) {
                const entry = replacements.get(p);
                if (entry && entry.rep.showingOriginal) entry.rep.toggle(false);
              }
              btn.textContent = 'Show original';
              s.announce('Simplified section shown.');
            } else {
              for (const p of paras) {
                const entry = replacements.get(p);
                if (entry && !entry.rep.showingOriginal) entry.rep.toggle(true);
              }
              btn.textContent = 'Plain language';
              s.announce('Original section text shown.');
            }
            return;
          }

          secBusy = true;
          s.setAttr(btn, 'aria-busy', 'true');
          s.setAttr(btn, 'aria-disabled', 'true');
          try {
            const results = await Promise.all(paras.map((p) => simplifyParagraph(p)));
            if (!s.alive()) return;
            const anySuccess = results.some(Boolean);
            if (anySuccess) {
              btn.textContent = 'Show original';
              s.announce('Simplified section shown.');
            } else {
              s.announce('Could not simplify this section.');
            }
          } finally {
            if (s.alive()) {
              secBusy = false;
              s.setAttr(btn, 'aria-busy', null);
              s.setAttr(btn, 'aria-disabled', null);
            }
          }
        });
      }
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
