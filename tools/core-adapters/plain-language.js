// plain-language.js — Lets the person read long or complex paragraphs in plain language on request.
// Barrier: People with cognitive impairments, reading difficulties, or non-native language
// comprehension can find dense, jargon-filled, or syntactically complex paragraphs difficult
// to process and retain.
//
// Suggested in onboarding for: cognitive, reading (a suggestion only, never a gate).
// The person's settings it reads: readingLevel ('plain', 'easy-read', or grade 1-12).
// What the person can adjust:
//   Nothing in the profile (reading level is a profile field, not a setting);
//   the person chooses which paragraphs or sections to simplify by activating their buttons.
//
// Options:
//   minChars: Minimum length in characters for a paragraph to be considered long (default: 150).
//   maxParagraphsBeforeSection: Maximum number of long paragraphs before switching to
//     one button per section (default: 8).
//   readingLevel: Default reading level if not provided in the profile (default: 'plain').
//   keep: Additional terms to preserve exactly as written (default: []).
//
// Decisions:
//   • Never simplifies on load and never sends more than the single paragraph requested to AI.
//   • Inserts a small 'Plain language' button after each long paragraph in the main content.
//   • The main content is what the page marks (main, role main, or its one article: page.main()),
//     with no wait. Where it marks none, enable() asks the toolkit's model which part is
//     (s.page.findMain()), once per page, and only when the page has long paragraphs: then only
//     that part's paragraphs get buttons. When the model cannot tell, or there is none, no
//     buttons are added and enable() returns false: no part is guessed (ids and classes like
//     #content are not the page saying), and buttons all over the page land on its boilerplate.
//   • When there are more than 8 long paragraphs (or options.maxParagraphsBeforeSection),
//     inserts one button per innermost section or article (including role="region" and role="article")
//     instead of after each paragraph.
//   • Paragraphs outside every section always get their own button after them.
//   • Keeps names, numbers, dates (day-first and short months), acronyms (all capitals),
//     and the meaning of links by extracting them into the keep prompt parameter (at most 50 items, at most 80 chars each).
//   • Does not keep a capitalized first word of a sentence as a name.
//   • Replaces simplified paragraphs using s.text.replaceBlock with showOriginal: false,
//     and updates the button text to 'Show original' to toggle back.
//   • While a request is in flight, the button keeps focus using aria-disabled and aria-busy;
//     never sets disabled because Chrome moves focus to the document root.
//   • On null AI output, leaves the paragraph as-is and announces that it could not simplify.
//   • In section mode, paragraphs that fail to simplify remain untouched while successfully
//     simplified paragraphs are replaced and toggled without re-requesting AI.
//   • Ends the session before enable() returns false if there are no qualifying paragraphs.
//   • Restores original markup and attributes on disable() via session cleanup.
//
// What it cannot do:
//   • Cannot simplify text if the AI provider is unavailable or rejects the passage.
//   • Cannot simplify text embedded in raster images or canvas graphics without OCR.

function extractKeepTerms(element, extraKeep = []) {
  const terms = new Set();

  if (Array.isArray(extraKeep)) {
    for (const k of extraKeep) {
      if (k && typeof k === 'string') terms.add(k.trim());
    }
  }

  // Links' meaning: link text inside the element
  for (const a of element.querySelectorAll('a')) {
    const linkText = a.textContent?.trim();
    if (linkText && linkText.length > 1) {
      terms.add(linkText);
    }
  }

  const text = element.textContent || '';

  // Months: January, Jan, February, Feb, etc.
  const months = 'Jan(?:uary|\\.)?|Feb(?:ruary|\\.)?|Mar(?:ch|\\.)?|Apr(?:il|\\.)?|May|Jun(?:e|\\.)?|Jul(?:y|\\.)?|Aug(?:ust|\\.)?|Sep(?:tember|\\.)?|Oct(?:ober|\\.)?|Nov(?:ember|\\.)?|Dec(?:ember|\\.)?';

  // Day-first dates: 15 January 2024, 15 Jan 2024, 15th of Jan 2024, 15 Jan
  const dayFirstRegex = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${months})(?:,?\\s+\\d{2,4})?(?=\\b|\\s|[.,;:!?]|$)`, 'gi');
  for (const m of text.matchAll(dayFirstRegex)) {
    terms.add(m[0].trim());
  }

  // Month-first dates: January 15, 2024, Jan 15 2024, Jan 15
  const monthFirstRegex = new RegExp(`\\b(?:${months})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?(?=\\b|\\s|[.,;:!?]|$)`, 'gi');
  for (const m of text.matchAll(monthFirstRegex)) {
    terms.add(m[0].trim());
  }

  // ISO / numeric dates: 2024-01-15 or 15/01/2024
  for (const m of text.matchAll(/\b\d{1,4}[/-]\d{1,2}[/-]\d{2,4}\b/g)) {
    terms.add(m[0].trim());
  }

  // Acronyms (all capitals, length >= 2)
  for (const m of text.matchAll(/\b[A-Z]{2,}\b/g)) {
    terms.add(m[0]);
  }

  // Numbers, currency, percentages, times (e.g. 4:30 PM, $50,000, 250%, 2025)
  for (const m of text.matchAll(/(?:[\$£€]\s*)?\b\d+(?:,\d{3})*(?::\d{2}|\.\d+)?%?(?:\s*(?:AM|PM|am|pm))?(?=\b|\s|[.,;:!?]|$)/gi)) {
    terms.add(m[0].trim());
  }

  // Proper names / capitalized words: do not keep a capitalized first word of a sentence.
  // Preceded by title: Dr. Robert Miller
  for (const m of text.matchAll(/\b(?:Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g)) {
    terms.add(m[0].trim());
  }

  // Sentence split
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    // Drop first word of sentence
    const firstWordMatch = trimmed.match(/^[A-Z][a-z]*/);
    const rest = firstWordMatch ? trimmed.slice(firstWordMatch[0].length) : trimmed;
    for (const m of rest.matchAll(/\b[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*\b/g)) {
      const w = m[0].trim();
      if (w.length > 1) {
        terms.add(w);
      }
    }
  }

  return [...terms].filter((t) => t && typeof t === 'string' && t.length <= 80).slice(0, 50);
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return false;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    const main = this.toolkit.page ? this.toolkit.page.main() : (document.querySelector('main, [role="main"]') || document.body);
    if (!main) {
      this.disable();
      return false;
    }

    const minChars = this.options.minChars ?? 150;
    const isVisible = (el) => {
      if (this.toolkit.page && typeof this.toolkit.page.isVisible === 'function') {
        return this.toolkit.page.isVisible(el);
      }
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };

    const allP = Array.from(main.querySelectorAll('p'));
    const longParagraphs = allP.filter((p) => {
      if (p.closest('nav, aside, header, footer, table, [role="navigation"], [role="complementary"], [role="contentinfo"], [role="banner"]')) {
        return false;
      }
      if (!isVisible(p)) return false;
      const text = (this.toolkit.page ? this.toolkit.page.readableText(p) : p.textContent) || '';
      return text.trim().length >= minChars;
    });

    if (longParagraphs.length === 0) {
      this.disable();
      return false;
    }

    // The page marks its main content: the buttons go in it, now.
    const body = document.body || document.documentElement;
    if (main !== body || !s.page || typeof s.page.findMain !== 'function') {
      this._addButtons(s, main, longParagraphs);
      return true;
    }
    // It does not: the toolkit's model may tell which part is (s.page.findMain()). With an
    // answer, only that part's paragraphs get buttons. Without one, none do: buttons all over the
    // page would land on its boilerplate too (a status line, a copyright), and there is no model
    // to simplify with when there is none to ask.
    const none = () => {
      if (this.s === s) this.disable();
      return false;
    };
    return s.page.findMain().then((found) => {
      if (this.s !== s || !s.alive() || !found) return none();
      const inMain = longParagraphs.filter((p) => found.contains(p));
      if (inMain.length === 0) return none();
      this._addButtons(s, found, inMain);
      return true;
    }, none);
  },

  _addButtons(s, main, longParagraphs) {
    const maxParagraphsBeforeSection = this.options.maxParagraphsBeforeSection ?? 8;

    // Styles for button
    s.css('plain-language', `
.ai4a11y-plain-btn {
  display: inline-block;
  margin: 2px 0 4px 0;
  padding: 4px 10px;
  min-height: 24px;
  min-width: 24px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.3;
  color: #0a4b78;
  background-color: #f0f4f8;
  border: 1px solid #0a4b78;
  border-radius: 4px;
  cursor: pointer;
  vertical-align: middle;
  text-decoration: none;
}
.ai4a11y-plain-btn:hover {
  background-color: #e1ebf5;
}
.ai4a11y-plain-btn:focus-visible {
  outline: 2px solid #0a4b78;
  outline-offset: 2px;
  box-shadow: 0 0 0 2px #ffffff;
}
.ai4a11y-plain-btn[aria-busy="true"],
.ai4a11y-plain-btn[aria-disabled="true"] {
  cursor: wait;
  opacity: 0.7;
}
@media (prefers-color-scheme: dark) {
  .ai4a11y-plain-btn {
    color: #e0f2fe;
    background-color: #0f2d4a;
    border-color: #38bdf8;
  }
  .ai4a11y-plain-btn:hover {
    background-color: #16436e;
  }
  .ai4a11y-plain-btn:focus-visible {
    outline-color: #38bdf8;
    box-shadow: 0 0 0 2px #0f172a;
  }
}
@media (forced-colors: active) {
  .ai4a11y-plain-btn {
    border: 1px solid ButtonText;
    color: ButtonText;
    background-color: ButtonFace;
  }
}
`);

    const useSections = longParagraphs.length > maxParagraphsBeforeSection;

    if (useSections) {
      // Group by innermost section or article (including role="region" and role="article")
      const sectionSelector = 'section, article, [role="region"], [role="article"]';
      const sectionMap = new Map();
      const outside = [];

      for (const p of longParagraphs) {
        const sec = p.closest(sectionSelector);
        if (sec && sec !== main && main.contains(sec)) {
          if (!sectionMap.has(sec)) sectionMap.set(sec, []);
          sectionMap.get(sec).push(p);
        } else {
          outside.push(p);
        }
      }

      // One button per section
      for (const [sec, paras] of sectionMap.entries()) {
        const btn = s.el('button', {
          text: 'Plain language',
          attrs: { type: 'button', class: 'ai4a11y-plain-btn ai4a11y-plain-section-btn' },
        });

        const heading = Array.from(sec.querySelectorAll('h1, h2, h3, h4, h5, h6')).find((h) => h.closest(sectionSelector) === sec);
        let insertTarget = null;
        if (heading) {
          let cur = heading;
          while (cur && cur.parentNode !== sec) {
            cur = cur.parentNode;
          }
          if (cur && cur.parentNode === sec) {
            insertTarget = cur.nextSibling;
          }
        }
        if (!insertTarget) {
          let cur = paras[0];
          while (cur && cur.parentNode !== sec) {
            cur = cur.parentNode;
          }
          insertTarget = (cur && cur.parentNode === sec) ? cur : sec.firstChild;
        }
        s.insert(sec, btn, insertTarget);

        const paragraphStates = new Map();
        let sectionShowingOriginal = false;
        let hasAnySimplified = false;
        let isBusy = false;

        s.listen(btn, 'click', async () => {
          if (isBusy) return;
          if (btn.getAttribute('aria-busy') === 'true' || btn.getAttribute('aria-disabled') === 'true') return;

          if (hasAnySimplified) {
            sectionShowingOriginal = !sectionShowingOriginal;
            for (const p of paras) {
              const st = paragraphStates.get(p);
              if (st && st.replacedHandle) {
                st.replacedHandle.toggle(sectionShowingOriginal);
              }
            }
            if (sectionShowingOriginal) {
              btn.textContent = 'Plain language';
              s.announce('Showing original text.');
            } else {
              btn.textContent = 'Show original';
              s.announce('Section in plain language.');
            }
            return;
          }

          isBusy = true;
          btn.setAttribute('aria-busy', 'true');
          btn.setAttribute('aria-disabled', 'true');

          try {
            let simplifiedCount = 0;
            for (const p of paras) {
              if (!s.alive()) return;
              const text = (this.toolkit.page ? this.toolkit.page.readableText(p) : p.textContent) || '';
              const keep = extractKeepTerms(p, this.options.keep);
              const readingLevel = s.profile.get('readingLevel') || this.options.readingLevel || 'plain';

              const answer = await s.ai.text('simplify', text, {
                context: document.title || '',
                readingLevel,
                keep,
              });

              if (!s.alive()) return;

              if (answer && typeof answer === 'string' && answer.trim()) {
                const rep = s.text.replaceBlock(p, answer, { showOriginal: false });
                if (rep) {
                  paragraphStates.set(p, { replacedHandle: rep, failed: false });
                  simplifiedCount++;
                } else {
                  paragraphStates.set(p, { replacedHandle: null, failed: true });
                }
              } else {
                paragraphStates.set(p, { replacedHandle: null, failed: true });
              }
            }

            if (simplifiedCount > 0) {
              hasAnySimplified = true;
              sectionShowingOriginal = false;
              btn.textContent = 'Show original';
              s.announce(`${simplifiedCount} paragraph${simplifiedCount === 1 ? '' : 's'} in plain language.`);
            } else {
              s.announce('Could not simplify this section in plain language.');
            }
          } catch {
            if (s.alive()) {
              s.announce('Could not simplify this section in plain language.');
            }
          } finally {
            if (s.alive()) {
              btn.removeAttribute('aria-busy');
              btn.removeAttribute('aria-disabled');
              isBusy = false;
            }
          }
        });
      }

      // Paragraphs outside sections get their own button after each
      for (const p of outside) {
        this._setupSingleParagraphButton(s, p);
      }
    } else {
      // Per-paragraph mode: one button after each long paragraph
      for (const p of longParagraphs) {
        this._setupSingleParagraphButton(s, p);
      }
    }
  },

  _setupSingleParagraphButton(s, p) {
    const btn = s.el('button', {
      text: 'Plain language',
      attrs: { type: 'button', class: 'ai4a11y-plain-btn' },
    });
    s.insert(p.parentNode, btn, p.nextSibling);

    let replacedHandle = null;
    let isBusy = false;

    s.listen(btn, 'click', async () => {
      if (isBusy) return;
      if (btn.getAttribute('aria-busy') === 'true' || btn.getAttribute('aria-disabled') === 'true') return;

      if (replacedHandle) {
        replacedHandle.toggle();
        const showingOriginal = replacedHandle.showingOriginal;
        if (showingOriginal) {
          btn.textContent = 'Plain language';
          s.announce('Showing original text.');
        } else {
          btn.textContent = 'Show original';
          s.announce('Paragraph in plain language.');
        }
        return;
      }

      isBusy = true;
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-disabled', 'true');

      try {
        const text = (this.toolkit.page ? this.toolkit.page.readableText(p) : p.textContent) || '';
        const keep = extractKeepTerms(p, this.options.keep);
        const readingLevel = s.profile.get('readingLevel') || this.options.readingLevel || 'plain';

        const answer = await s.ai.text('simplify', text, {
          context: document.title || '',
          readingLevel,
          keep,
        });

        if (!s.alive()) return;

        if (answer && typeof answer === 'string' && answer.trim()) {
          replacedHandle = s.text.replaceBlock(p, answer, { showOriginal: false });
          if (replacedHandle) {
            btn.textContent = 'Show original';
            s.announce('Paragraph in plain language.');
          } else {
            s.announce('Could not simplify this text in plain language.');
          }
        } else {
          s.announce('Could not simplify this text in plain language.');
        }
      } catch {
        if (s.alive()) {
          s.announce('Could not simplify this text in plain language.');
        }
      } finally {
        if (s.alive()) {
          btn.removeAttribute('aria-busy');
          btn.removeAttribute('aria-disabled');
          isBusy = false;
        }
      }
    });
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
