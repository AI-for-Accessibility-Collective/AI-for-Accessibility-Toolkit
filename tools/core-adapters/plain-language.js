// plain-language.js — Lets the person read long or hard paragraphs in plain language.
// Barrier: Long, dense, or complex paragraphs create cognitive barriers for people
// with learning disabilities, cognitive differences, or lower reading proficiency.
//
// Suggested in onboarding for: cognitive, reading (a suggestion only, never a gate).
// The person's settings it reads: readingLevel (from profile).
// What the person can adjust: nothing in the profile (reading level is a profile field,
//   not a setting); the person chooses which parts to simplify.
// Prior work to learn from: tools/adapters/simplify-text.js.
//
// Options:
//   minChars: Minimum character count for a paragraph to be considered long (default: 200).
//   readingLevel: Default reading level if not set in profile (e.g. 'plain', 'easy-read', 1-12).
//   keep: Additional terms to preserve exactly in rewrites (default: []).
//   maxParagraphsBeforeSection: Maximum long paragraphs before switching to one button
//     per section (default: 8).
//
// Decisions:
//   • Never simplifies on load; rewrites happen only on request when a button is clicked.
//   • Never sends more than one paragraph at a time to s.ai.text('simplify', ...).
//   • Places a small 'Plain language' button after each long paragraph in the main content
//     (or one button per section when there are more than 8 long paragraphs).
//   • When simplified, replaces the paragraph using s.text.replaceBlock with showOriginal: false,
//     and changes the button text to 'Show original' for one-click toggle back.
//   • While a request is in flight, the button maintains focus with aria-busy="true" and
//     aria-disabled="true", never native disabled (avoiding focus drop in Chromium).
//   • Extracts names, numbers, dates, and links' meaning to pass in the prompt's `keep` list.
//   • If AI is unavailable or returns null, leaves the paragraph untouched and announces
//     that it could not simplify via s.announce.
//   • Cleanly restores original DOM on disable() through session cleanup.
//
// What it cannot do:
//   • Does not rewrite non-prose content (code, tables, mathematical formulas, navigation).
//   • Does not simplify content if no AI model is connected or budget is exhausted.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());

    const minChars = Number(this.options.minChars) || 200;
    const maxParagraphsBeforeSection = Number(this.options.maxParagraphsBeforeSection) || 8;
    const extraKeep = Array.isArray(this.options.keep) ? this.options.keep : [];
    const defaultReadingLevel = this.options.readingLevel || 'plain';

    const main = this.toolkit.page.main();
    if (!main) return false;

    // Helper: is element a long paragraph in main content?
    const isLongParagraph = (p) => {
      if (!p || p.tagName !== 'P') return false;
      if (!this.toolkit.page.isVisible(p) || this.toolkit.page.isOurs(p)) return false;
      if (p.closest('nav, header, footer, aside, table, pre, code, form, dialog, template, noscript')) return false;
      if (p.querySelector('table')) return false;
      const text = this.toolkit.page.readableText(p);
      return text.length >= minChars && text.length <= 6000;
    };

    const longParas = [...main.querySelectorAll('p')].filter(isLongParagraph);
    if (!longParas.length) return false;

    // Inject stylesheet with high-contrast, unobtrusive button styling
    s.css(
      'plain-language-styles',
      `
      .ai4a11y-plain-btn {
        display: inline-block;
        font: inherit;
        font-size: 0.85em;
        line-height: normal;
        min-height: 24px;
        min-width: 24px;
        padding: 3px 10px;
        margin: 4px 0 10px 0;
        box-sizing: border-box;
        border: 1px solid currentColor;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        vertical-align: middle;
      }
      .ai4a11y-plain-btn:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
      .ai4a11y-plain-btn[aria-busy="true"] {
        cursor: wait;
        opacity: 0.7;
      }
      `
    );

    const extractKeepTerms = (el) => {
      const terms = new Set(extraKeep);
      for (const a of el.querySelectorAll('a')) {
        const text = a.textContent.trim();
        if (text && text.length <= 80) terms.add(text);
      }
      const text = el.textContent || '';
      const dateRegex = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s+\d{4})?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{4}-\d{2}-\d{2})\b/gi;
      for (const match of text.matchAll(dateRegex)) {
        if (match[0].length <= 80) terms.add(match[0]);
      }
      const numRegex = /\b(?:\$|€|£|¥)?\d+(?:[.,]\d+)*(?:%|st|nd|rd|th)?\b/g;
      for (const match of text.matchAll(numRegex)) {
        if (match[0].length <= 80) terms.add(match[0]);
      }
      const nameRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
      for (const match of text.matchAll(nameRegex)) {
        if (match[0].length <= 80 && match[0].length > 2) terms.add(match[0]);
      }
      return [...terms].filter((t) => typeof t === 'string' && t.trim().length > 0 && t.length <= 80).slice(0, 50);
    };

    const findHeadingFor = (el) => {
      const headings = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].filter(
        (h) => this.toolkit.page.isVisible(h) && !this.toolkit.page.isOurs(h)
      );
      let closest = null;
      for (const h of headings) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          closest = h;
        }
      }
      return closest?.textContent?.trim() || document.title || '';
    };

    if (longParas.length <= maxParagraphsBeforeSection) {
      // Paragraph mode: one button after each long paragraph
      for (const p of longParas) {
        let rep = null;
        let showingOriginal = true;
        const btn = s.el('button', {
          text: 'Plain language',
          attrs: {
            type: 'button',
            class: 'ai4a11y-plain-btn',
          },
        });

        s.listen(btn, 'click', async () => {
          if (!s.alive()) return;
          if (btn.getAttribute('aria-busy') === 'true' || btn.getAttribute('aria-disabled') === 'true') return;

          if (!showingOriginal) {
            if (rep) rep.toggle(true);
            btn.textContent = 'Plain language';
            showingOriginal = true;
            s.announce('Showing original text.');
            return;
          }

          if (rep) {
            rep.toggle(false);
            btn.textContent = 'Show original';
            showingOriginal = false;
            s.announce('Showing plain language.');
            return;
          }

          s.setAttr(btn, 'aria-busy', 'true');
          s.setAttr(btn, 'aria-disabled', 'true');

          try {
            const text = this.toolkit.page.readableText(p);
            const keep = extractKeepTerms(p);
            const context = findHeadingFor(p);
            const plain = await s.ai.text('simplify', text, {
              readingLevel: defaultReadingLevel,
              context,
              keep,
            });

            if (!s.alive()) return;

            s.setAttr(btn, 'aria-busy', null);
            s.setAttr(btn, 'aria-disabled', null);

            if (!plain) {
              s.announce('Could not simplify this paragraph.');
              return;
            }

            rep = s.text.replaceBlock(p, plain, { showOriginal: false });
            if (rep) {
              btn.textContent = 'Show original';
              showingOriginal = false;
              s.announce('Showing plain language.');
            }
          } catch {
            if (!s.alive()) return;
            s.setAttr(btn, 'aria-busy', null);
            s.setAttr(btn, 'aria-disabled', null);
            s.announce('Could not simplify this paragraph.');
          }
        });

        s.insert(p.parentNode, btn, p.nextSibling);
      }
    } else {
      // Section mode: one button per section containing long paragraphs
      const getSections = () => {
        const sectionNodes = [...main.querySelectorAll('section, article')].filter((sec) =>
          longParas.some((p) => sec.contains(p))
        );
        if (sectionNodes.length > 1) {
          return sectionNodes
            .map((sec) => ({
              heading: sec.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]'),
              anchor: sec.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]') || sec.firstElementChild,
              paras: longParas.filter((p) => sec.contains(p)),
            }))
            .filter((s) => s.paras.length > 0);
        }

        const headings = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].filter(
          (h) => this.toolkit.page.isVisible(h) && !this.toolkit.page.isOurs(h)
        );
        if (headings.length > 1) {
          const groups = new Map();
          for (const p of longParas) {
            let prevHeading = null;
            for (const h of headings) {
              if (h.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) {
                prevHeading = h;
              }
            }
            const key = prevHeading || headings[0];
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
          }
          return [...groups.entries()].map(([heading, paras]) => ({
            heading,
            anchor: heading,
            paras,
          }));
        }

        return [
          {
            heading: main.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]'),
            anchor: main.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]') || longParas[0],
            paras: longParas,
          },
        ];
      };

      const sections = getSections();
      for (const section of sections) {
        const repMap = new Map();
        let showingOriginal = true;
        const btn = s.el('button', {
          text: 'Plain language',
          attrs: {
            type: 'button',
            class: 'ai4a11y-plain-btn ai4a11y-plain-section-btn',
          },
        });

        s.listen(btn, 'click', async () => {
          if (!s.alive()) return;
          if (btn.getAttribute('aria-busy') === 'true' || btn.getAttribute('aria-disabled') === 'true') return;

          if (!showingOriginal) {
            for (const p of section.paras) {
              const rep = repMap.get(p);
              if (rep) rep.toggle(true);
            }
            btn.textContent = 'Plain language';
            showingOriginal = true;
            s.announce('Showing original text.');
            return;
          }

          const allCached = section.paras.every((p) => repMap.has(p));
          if (allCached) {
            for (const p of section.paras) {
              const rep = repMap.get(p);
              if (rep) rep.toggle(false);
            }
            btn.textContent = 'Show original';
            showingOriginal = false;
            s.announce('Showing plain language.');
            return;
          }

          s.setAttr(btn, 'aria-busy', 'true');
          s.setAttr(btn, 'aria-disabled', 'true');

          try {
            const context = section.heading?.textContent?.trim() || document.title || '';
            const results = await Promise.all(
              section.paras.map(async (p) => {
                if (repMap.has(p)) return { p, rep: repMap.get(p) };
                const text = this.toolkit.page.readableText(p);
                const keep = extractKeepTerms(p);
                const plain = await s.ai.text('simplify', text, {
                  readingLevel: defaultReadingLevel,
                  context,
                  keep,
                });
                return { p, plain };
              })
            );

            if (!s.alive()) return;

            s.setAttr(btn, 'aria-busy', null);
            s.setAttr(btn, 'aria-disabled', null);

            let simplifiedCount = 0;
            for (const item of results) {
              if (item.rep) {
                item.rep.toggle(false);
                simplifiedCount++;
              } else if (item.plain) {
                const r = s.text.replaceBlock(item.p, item.plain, { showOriginal: false });
                if (r) {
                  repMap.set(item.p, r);
                  simplifiedCount++;
                }
              }
            }

            if (simplifiedCount === 0) {
              s.announce('Could not simplify this section.');
              return;
            }

            btn.textContent = 'Show original';
            showingOriginal = false;
            s.announce('Showing plain language.');
          } catch {
            if (!s.alive()) return;
            s.setAttr(btn, 'aria-busy', null);
            s.setAttr(btn, 'aria-disabled', null);
            s.announce('Could not simplify this section.');
          }
        });

        const anchor = section.anchor;
        if (anchor && anchor.parentNode) {
          s.insert(anchor.parentNode, btn, anchor.nextSibling);
        } else if (section.paras[0]?.parentNode) {
          s.insert(section.paras[0].parentNode, btn, section.paras[0].nextSibling);
        }
      }
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
