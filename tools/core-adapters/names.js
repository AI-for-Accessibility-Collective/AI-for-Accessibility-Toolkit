// names.js — Names for controls and images.
// Barrier: Buttons, links, form fields, and informative images without accessible
// names or alt text cannot be identified or operated by people using screen readers
// or speech navigation.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   limit: Maximum number of AI calls per page (defaults to 10).
//
// Decisions:
//   • Measures first with s.page.nameOf helper: never renames anything that already
//     has an accessible name, images included. Controls with their own HTML title
//     attribute already have an accessible name via s.page.nameOf and are left as-is.
//   • Names from the page first without AI: SVG titles, icon class words, small icon image
//     file names, link URL last path parts, nearby label text (which takes precedence over
//     placeholder and form field name attributes), placeholder attributes, and input names.
//   • Decorative images (tiny spacers <= 2px in both dimensions, role presentation/none)
//     are left alone or marked clearly with alt="" if spacers, never sent to AI.
//   • Elements with aria-hidden="true" or inside aria-hidden subtrees are skipped.
//   • A file name's words name only a small icon (48 by 48 pixels or smaller); photos
//     and illustrations are never named from file names (on null from AI, left untouched).
//   • Words from class or file name match whole words; style words (primary, secondary,
//     btn, icon, large) are filtered out and not treated as names.
//   • A link to '#...', '?...', or non-http(s) schemes (mailto:, tel:) is never named from the path.
//   • A nearby label names a field only when it sits right before it and labels nothing else.
//   • Marks an image inside a named control alt="" only when it is small (<= 48px)
//     or clearly decorative.
//   • Informative images (> 48px on either side and not decorative) lacking alt text
//     are described via s.ai.vision('describe', img, { purpose: 'alt' }).
//   • Calls AI only for what is still nameless, visible elements first, at most the
//     configured limit per page (default 10).
//   • Never queries AI or modifies content that the page hides (s.page.isVisible).
//   • Reversible changes: every attribute modification is tracked in the session so
//     disable() restores the DOM exactly as it was.
//
// What it cannot do:
//   • Cannot infer names for custom icon controls when AI is unavailable and no page-first
//     signals exist.
//   • Does not describe decorative background images applied via CSS or canvas elements.

const CANDIDATE_SELECTOR = 'button, a[href], input, textarea, select, img, [role="button"], [role="link"], [role="img"]';

const STYLE_WORDS = new Set([
  'btn', 'button', 'icon', 'icons', 'primary', 'secondary', 'tertiary',
  'large', 'small', 'medium', 'tiny', 'huge', 'dark', 'light',
  'default', 'custom', 'active', 'disabled', 'fab', 'fas', 'far',
  'fal', 'fad', 'fa', 'bi', 'glyphicon', 'material-icons', 'material-symbols',
  'material', 'symbols', 'svg', 'img', 'nav', 'link',
  'solid', 'regular', 'brands', 'duotone', 'thin', 'sharp', 'outline',
  'outlined', 'ui', 'js', 'filled', 'round', 'rounded', 'glyph',
  'classic', 'mini', 'micro', 'feather', 'lucide', 'ion', 'ionicons',
  'xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'danger', 'warning', 'success', 'info'
]);

const JUNK_NAME_RE = /^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken)$/i;

function isJunkName(name) {
  return !name || JUNK_NAME_RE.test(name.trim());
}

function sentenceCase(words) {
  if (!words || !words.length) return '';
  return words.map((w, idx) => idx === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}

function getImageDimensions(img) {
  let w = null;
  let h = null;

  const rawW = img.getAttribute('width');
  const rawH = img.getAttribute('height');
  if (rawW && !isNaN(parseFloat(rawW))) w = parseFloat(rawW);
  if (rawH && !isNaN(parseFloat(rawH))) h = parseFloat(rawH);

  if (w === null && img.style?.width) {
    const parsed = parseFloat(img.style.width);
    if (!isNaN(parsed)) w = parsed;
  }
  if (h === null && img.style?.height) {
    const parsed = parseFloat(img.style.height);
    if (!isNaN(parsed)) h = parsed;
  }

  try {
    const rect = img.getBoundingClientRect?.();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      if (w === null && rect.width > 0) w = rect.width;
      if (h === null && rect.height > 0) h = rect.height;
    }
  } catch {}

  if (w === null && img.naturalWidth) w = img.naturalWidth;
  if (h === null && img.naturalHeight) h = img.naturalHeight;

  return { w, h };
}

function isSpacerImage(img) {
  const { w, h } = getImageDimensions(img);
  if (w === null || h === null) return false;
  if (w > 48 || h > 48) return false;
  return w <= 2 && h <= 2;
}

function isSmallIcon(img) {
  const { w, h } = getImageDimensions(img);
  if (w !== null && w > 48) return false;
  if (h !== null && h > 48) return false;
  if ((w !== null && w <= 48) || (h !== null && h <= 48)) return true;
  return false;
}

function isInformativeImage(img) {
  const { w, h } = getImageDimensions(img);
  if (w !== null && w > 48) return true;
  if (h !== null && h > 48) return true;
  return false;
}

function hasAssociatedLabel(el, doc) {
  const labels = el.labels ? [...el.labels] : [];
  if (!labels.length && el.id) {
    try {
      labels.push(...doc.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`));
    } catch {}
  }
  const wrap = el.closest('label');
  if (wrap && !labels.includes(wrap)) labels.push(wrap);
  const text = labels.map(l => (l.textContent || '').trim()).filter(Boolean).join(' ');
  return text.length > 0;
}

function hasAccessibleName(el, s) {
  if (!el || el.nodeType !== 1) return true;
  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();

  if (tag === 'IMG') {
    if (el.hasAttribute('alt')) return true;
    const role = (el.getAttribute('role') || '').toLowerCase().trim();
    if (role === 'presentation' || role === 'none') return true;
    const name = s.page.nameOf(el);
    return Boolean(name && name.trim());
  }

  if (tag === 'INPUT' && type === 'image') {
    const alt = el.getAttribute('alt');
    if (alt !== null && alt.trim()) return true;
    const name = s.page.nameOf(el);
    return Boolean(name && name.trim());
  }

  const isField = (tag === 'INPUT' && !/^(button|submit|reset|image)$/.test(type)) ||
                  tag === 'TEXTAREA' || tag === 'SELECT';
  if (isField) {
    if ((el.getAttribute('aria-label') || '').trim()) return true;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (text) return true;
    }
    if (hasAssociatedLabel(el, el.ownerDocument)) return true;
    if ((el.getAttribute('title') || '').trim()) return true;
    return false;
  }

  const name = s.page.nameOf(el);
  return Boolean(name && name.trim());
}

function extractWordsFromFileName(src) {
  if (!src || typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return null;

  let pathPart = trimmed;
  try {
    const url = new URL(trimmed, 'http://dummy.local');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    pathPart = url.pathname;
  } catch {
    pathPart = pathPart.split('?')[0].split('#')[0];
  }

  const segments = pathPart.split('/').filter(Boolean);
  if (!segments.length) return null;
  const lastPart = segments[segments.length - 1];
  if (!lastPart || lastPart.includes(':')) return null;

  const withoutExt = lastPart.replace(/\.[a-zA-Z0-9]+$/, '');
  if (!withoutExt) return null;

  const rawWords = withoutExt
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase().trim())
    .filter(Boolean);

  const filtered = rawWords.filter(w => !STYLE_WORDS.has(w) && !/^\d+$/.test(w));
  if (!filtered.length) return null;

  return sentenceCase(filtered);
}

function extractWordsFromClass(el) {
  const elements = [...el.querySelectorAll('*'), el];
  const allTokens = [];

  for (const node of elements) {
    const classAttr = node.getAttribute('class');
    if (!classAttr || typeof classAttr !== 'string') continue;
    const tokens = classAttr.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      allTokens.push(token);
    }
  }

  const ICON_TOKEN_RE = /^(?:fa|bi|glyphicon|feather|lucide|ion|material|icon)[-_]|[-_]icon(?:[-_]|$)/i;

  for (const token of allTokens) {
    if (ICON_TOKEN_RE.test(token)) {
      const parts = token
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .map(w => w.toLowerCase().trim())
        .filter(Boolean);

      const filtered = parts.filter(w => !STYLE_WORDS.has(w) && !/^\d+$/.test(w));
      if (filtered.length) {
        return sentenceCase(filtered);
      }
    }
  }

  return null;
}

function extractNameFromLinkPath(link) {
  const rawHref = link.getAttribute('href') || '';
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.charAt(0) === '#' || trimmed.charAt(0) === '?' || trimmed.startsWith('javascript:')) {
    return null;
  }

  let pathname = '';
  try {
    const url = new URL(trimmed, 'http://dummy.local');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    pathname = url.pathname;
  } catch {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  const lastPart = segments[segments.length - 1];
  if (!lastPart) return null;

  const base = lastPart.replace(/\.[a-zA-Z0-9]+$/, '');
  if (!base) return null;

  const rawWords = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase().trim())
    .filter(Boolean);

  const STOP_WORDS = new Set(['index', 'default', 'home', 'page']);
  const filtered = rawWords.filter(w => !STOP_WORDS.has(w) && !STYLE_WORDS.has(w) && !/^\d+$/.test(w));
  if (!filtered.length) return null;

  return sentenceCase(filtered);
}

function extractNearbyLabel(field) {
  const prev = field.previousElementSibling;
  if (!prev) return null;
  const prevTag = prev.tagName.toLowerCase();

  // Exclude elements that are controls, structural sections, headings, paragraphs, links, lists, tables, etc.
  const EXCLUDED_TAGS = /^(input|select|textarea|button|h[1-6]|p|a|ul|ol|li|table|tr|td|th|section|nav|header|footer|aside|article|form|fieldset|script|style|template|noscript)$/i;
  if (EXCLUDED_TAGS.test(prevTag)) return null;

  // Exclude error/validation elements or live alerts
  const role = (prev.getAttribute('role') || '').toLowerCase().trim();
  if (role === 'alert' || role === 'status') return null;
  const classAttr = prev.getAttribute('class') || '';
  if (/(?:error|invalid|feedback|errormsg|alert|danger|warning|validation)/i.test(classAttr)) return null;
  if (prev.hasAttribute('aria-live')) return null;

  // A label next to a field names it only when it labels nothing else
  if (prev.querySelector('input, select, textarea, button')) return null;

  if (prevTag === 'label') {
    const forId = prev.getAttribute('for');
    if (forId && (!field.id || forId !== field.id)) return null;
  } else {
    // Non-label elements must have explicit label intent via class or role
    if (!/(?:field-label|form-label|label|prompt|legend|caption|lbl)/i.test(classAttr) && role !== 'label' && role !== 'legend') {
      return null;
    }
  }

  const text = (prev.textContent || '').trim().replace(/[:*]+$/, '').trim();
  if (text && text.length < 60 && !/\n/.test(text) && !isJunkName(text)) {
    return text;
  }
  return null;
}

function getControlContext(el) {
  const parts = [];
  const tag = el.tagName.toLowerCase();
  parts.push(tag);
  if (el.getAttribute('type')) parts.push(`type="${el.getAttribute('type')}"`);
  const href = el.getAttribute('href');
  if (href && href !== '#') parts.push(`href="${href}"`);
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (text) parts.push(`text: "${text}"`);

  // Surrounding context: container heading or aria-label
  const container = el.closest('fieldset, form, section, article, nav, aside, main');
  if (container) {
    const containerLabel = container.getAttribute('aria-label');
    if (containerLabel) {
      parts.push(`in section: "${containerLabel.slice(0, 60)}"`);
    } else {
      const heading = container.querySelector('h1, h2, h3, h4, h5, h6, legend');
      if (heading) {
        const headingText = (heading.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (headingText) parts.push(`under heading: "${headingText}"`);
      }
    }
  }

  // Preceding sibling text if available
  const prev = el.previousElementSibling;
  if (prev && !/^(input|select|textarea|button|script|style)$/i.test(prev.tagName)) {
    const prevText = (prev.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (prevText) parts.push(`preceded by: "${prevText}"`);
  }

  return parts.join(', ');
}

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return true;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const doc = s.page?.doc || document;

    const maxAiCalls = this.options.limit ?? 10;
    let aiCallsMade = 0;
    const aiAsked = new WeakSet();
    let changesCount = 0;

    const markSmallImagesInNamedControl = (control) => {
      for (const img of control.querySelectorAll('img')) {
        if (!img.hasAttribute('alt')) {
          if (isSpacerImage(img) || isSmallIcon(img)) {
            s.setAttr(img, 'alt', '');
            changesCount++;
          }
        }
      }
    };

    const processElementPageFirst = (el) => {
      if (!s.alive()) return false;
      if (!s.page.isVisible(el)) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      if (s.page.isOurs(el) || el.closest('[data-ai4a11y-ui]')) return false;

      const tag = el.tagName;
      const type = (el.getAttribute('type') || '').toLowerCase();

      // Standalone image handling
      if (tag === 'IMG') {
        if (el.hasAttribute('alt')) return false;
        const role = (el.getAttribute('role') || '').toLowerCase().trim();
        if (role === 'presentation' || role === 'none') return false;

        // Tiny spacer
        if (isSpacerImage(el)) {
          s.setAttr(el, 'alt', '');
          changesCount++;
          return true;
        }

        // Small icon with file name words
        if (isSmallIcon(el)) {
          const name = extractWordsFromFileName(el.getAttribute('src'));
          if (name) {
            s.setAttr(el, 'alt', name);
            changesCount++;
            return true;
          }
        }
        return false;
      }

      // Check if control already has an accessible name.
      // Controls with their own non-empty title attribute already have an accessible name
      // computed via hasAccessibleName / s.page.nameOf and are left as-is.
      if (hasAccessibleName(el, s)) {
        if (/^(BUTTON|A)$/.test(tag) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') {
          markSmallImagesInNamedControl(el);
        }
        return false;
      }

      // 1. SVG title inside control
      const svgTitle = el.querySelector('svg title')?.textContent?.trim();
      if (svgTitle) {
        s.setAttr(el, 'aria-label', svgTitle);
        changesCount++;
        if (/^(BUTTON|A)$/.test(tag)) markSmallImagesInNamedControl(el);
        return true;
      }

      // 2. Button or control containing a small icon image with filename words, or input type=image
      if (tag === 'INPUT' && type === 'image') {
        if (isSmallIcon(el) && !isSpacerImage(el)) {
          const iconName = extractWordsFromFileName(el.getAttribute('src'));
          if (iconName) {
            s.setAttr(el, 'aria-label', iconName);
            changesCount++;
            return true;
          }
        }
      }

      for (const childImg of el.querySelectorAll('img')) {
        if (isSmallIcon(childImg) && !isSpacerImage(childImg)) {
          const iconName = extractWordsFromFileName(childImg.getAttribute('src'));
          if (iconName) {
            s.setAttr(el, 'aria-label', iconName);
            changesCount++;
            markSmallImagesInNamedControl(el);
            return true;
          }
        }
      }

      // 3. Class words on control or child icon
      const classWords = extractWordsFromClass(el);
      const isButtonOrLink = /^(BUTTON|A)$/.test(tag) ||
                             (tag === 'INPUT' && /^(button|submit|reset|image)$/.test(type)) ||
                             el.getAttribute('role') === 'button' ||
                             el.getAttribute('role') === 'link';
      if (classWords && isButtonOrLink) {
        s.setAttr(el, 'aria-label', classWords);
        changesCount++;
        markSmallImagesInNamedControl(el);
        return true;
      }

      // 4. Link last path part
      if (tag === 'A' || el.getAttribute('role') === 'link') {
        const pathName = extractNameFromLinkPath(el);
        if (pathName) {
          s.setAttr(el, 'aria-label', pathName);
          changesCount++;
          markSmallImagesInNamedControl(el);
          return true;
        }
      }

      // 5. Form fields: visible nearby label governs over placeholder and name attribute
      const isField = (tag === 'INPUT' && !/^(button|submit|reset|image)$/.test(type)) ||
                      tag === 'TEXTAREA' || tag === 'SELECT';
      if (isField) {
        const nearby = extractNearbyLabel(el);
        if (nearby) {
          s.setAttr(el, 'aria-label', nearby);
          changesCount++;
          return true;
        }

        const placeholder = el.getAttribute('placeholder')?.trim();
        if (placeholder) {
          s.setAttr(el, 'aria-label', placeholder);
          changesCount++;
          return true;
        }

        const nameAttr = el.getAttribute('name');
        if (nameAttr && !isJunkName(nameAttr)) {
          const words = nameAttr
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[-_\s]+/)
            .map(w => w.toLowerCase().trim())
            .filter(Boolean);
          const formatted = sentenceCase(words);
          if (formatted) {
            s.setAttr(el, 'aria-label', formatted);
            changesCount++;
            return true;
          }
        }
      }

      return false;
    };

    const processAiCandidates = async (candidates) => {
      for (const el of candidates) {
        if (!s.alive()) break;
        if (aiCallsMade >= maxAiCalls) break;
        if (!s.page.isVisible(el)) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        if (hasAccessibleName(el, s)) continue;
        if (aiAsked.has(el)) continue;

        const tag = el.tagName;
        if (tag === 'IMG') {
          const role = (el.getAttribute('role') || '').toLowerCase().trim();
          if (role === 'presentation' || role === 'none') continue;
          if (!isInformativeImage(el)) continue;

          aiAsked.add(el);
          aiCallsMade++;
          try {
            const alt = await s.ai.vision('describe', el, { purpose: 'alt' });
            if (alt && typeof alt === 'string' && alt.trim() && s.alive()) {
              s.setAttr(el, 'alt', alt.trim());
              changesCount++;
            }
          } catch {}
        } else {
          aiAsked.add(el);
          aiCallsMade++;
          try {
            const context = getControlContext(el);
            const label = await s.ai.text('label', context);
            if (label && typeof label === 'string' && label.trim() && s.alive()) {
              s.setAttr(el, 'aria-label', label.trim());
              changesCount++;
              if (/^(BUTTON|A)$/.test(tag) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') {
                markSmallImagesInNamedControl(el);
              }
            }
          } catch {}
        }
      }
    };

    const processBatch = async (elements) => {
      const stillNameless = [];
      for (const el of elements) {
        if (!processElementPageFirst(el)) {
          if (!hasAccessibleName(el, s) && s.page.isVisible(el) && !el.closest('[aria-hidden="true"]')) {
            stillNameless.push(el);
          }
        }
      }
      if (stillNameless.length) {
        await processAiCandidates(stillNameless);
      }
    };

    // Watch for newly added content
    if (s.watch?.added) {
      s.watch.added(doc.body, (addedNodes) => {
        if (!s.alive()) return;
        const batch = [];
        for (const node of addedNodes) {
          if (!node || node.nodeType !== 1) continue;
          if (node.matches && node.matches(CANDIDATE_SELECTOR)) batch.push(node);
          if (node.querySelectorAll) batch.push(...node.querySelectorAll(CANDIDATE_SELECTOR));
        }
        if (batch.length) {
          processBatch(batch);
        }
      }, { batch: true });
    }

    // Process initial elements on page
    const initialElements = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR));
    await processBatch(initialElements);

    if (!s.alive()) return false;

    // If nothing was done and session is still ours, disable and return false
    if (changesCount === 0) {
      if (this.s === s) {
        this.s = null;
      }
      s.end();
      return false;
    }

    return true;
  },

  disable() {
    if (this.s) {
      const s = this.s;
      this.s = null;
      s.end();
    }
  }
};
