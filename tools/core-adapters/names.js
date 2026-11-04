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
//   • A file name or a link's last path part names something only when every part
//     of it is a word: one with a digit or a symbol (icon-24px, trash@2x, top-10-tips,
//     IMG_2034) names nothing. Style words (primary, secondary, btn, icon, large) are
//     left out, and a file name that only says what kind of file it is (image.png,
//     photo, logo, placeholder) names nothing.
//   • An svg's own <title> is its name (s.page.nameOf): an svg role="img" with one is
//     named and left alone.
//   • An icon's class names it only when it is the icon library's name class (fa-print,
//     bi-trash, icon-star, search-icon) made of words, on the icon the control shows
//     (its shown children, or itself when it has none). Modifier classes (fa-2x, fa-fw,
//     fa-solid) name nothing; when the classes or the icons disagree, nothing is named
//     from them (the AI is asked instead). A role="img" element is named this way too,
//     and otherwise treated as an image: described by vision only when informative.
//   • A link to '#...', '?...', or non-http(s) schemes (mailto:, tel:) is never named from the path.
//   • A nearby label (a <label>, or a span or div with a form-label class) names a field
//     only when it sits right before it and labels nothing else: no for, no control in
//     it, no element pointing to it by aria-labelledby or aria-describedby, not right
//     after a checkbox or radio button (whose label it is).
//   • A field's name attribute names it only when it is made of words (customer_email),
//     never a framework key (ctl00$MainContent$txtEmail).
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

// The words of the last part of an address's path (a file name, a page), or
// null. Every part must be a word: a part with a digit or a symbol (24px, 2x,
// @2x, top-10, IMG_2034, a hash) is the file's size, version or copy, and
// what is left is not the name the page gave it, so nothing is named from it.
// Never from a data: or blob: URI, another scheme, or a host.
function lastPathWords(src) {
  if (!src || typeof src !== 'string') return null;
  let url;
  try { url = new URL(src.trim(), 'http://dummy.local'); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (!last) return null;
  let base = last.replace(/\.[a-zA-Z0-9]+$/, '');
  try { base = decodeURIComponent(base); } catch { return null; }
  return wordsOf(base);
}

// What a file is (an image, a photo, a logo, a placeholder) is not what it
// shows (F30): a file name made only of such words names nothing.
const FILE_KIND_WORDS = new Set([
  'image', 'images', 'photo', 'photos', 'picture', 'pictures', 'pic', 'pics',
  'graphic', 'graphics', 'logo', 'thumb', 'thumbnail', 'avatar', 'placeholder',
  'untitled', 'blank', 'spacer', 'pixel', 'transparent', 'sprite', 'file', 'asset', 'assets'
]);

// A small icon's name from its file name (trash-can.png is "Trash can"); style
// words (icon, btn, large) are left out.
function extractWordsFromFileName(src) {
  const words = lastPathWords(src)?.filter(w => !STYLE_WORDS.has(w));
  if (!words?.length || words.every(w => FILE_KIND_WORDS.has(w))) return null;
  return sentenceCase(words);
}

// An icon font names its icon in one class: fa-print, bi-trash, glyphicon-search,
// ion-md-search, icon-star, search-icon. The library's other classes on the same
// element are its modifiers (fa-2x, fa-fw, fa-solid, fa-stack). A class with a digit
// or a symbol in it is a modifier or an id, never a name, and a class made only of
// modifier words names nothing. When the classes, or the icons, disagree, nothing is
// named from them: a missing name goes to the AI, a wrong one misleads.
const ICON_CLASS_RE = /^(?:fa|bi|glyphicon|feather|lucide|ion(?:[-_](?:ios|md|logo))?|icon)[-_](.+)$|^(.+)[-_]icon$/i;
const ICON_MODIFIERS = new Set([
  'solid', 'regular', 'light', 'thin', 'duotone', 'sharp', 'brands', 'classic',
  'fw', 'spin', 'pulse', 'beat', 'fade', 'bounce', 'shake', 'flip', 'inverse', 'border',
  'stack', 'ul', 'li', 'rotate', 'by', 'reverse', 'horizontal', 'vertical', 'both',
  'xs', 'sm', 'lg', 'xl', 'xxl', 'xxs', 'tiny', 'small', 'medium', 'large', 'huge', 'mini', 'micro',
  'fill', 'filled', 'outline', 'outlined', 'round', 'rounded', 'twotone',
  'icon', 'icons', 'btn', 'button', 'nav', 'ui', 'svg', 'img', 'glyph',
  'primary', 'secondary', 'tertiary', 'default', 'custom', 'active', 'disabled', 'dark'
]);

// The words of an identifier (customer_email, fa-print, searchIcon), or null when
// any part of it is not a word (2x, ctl00$txtEmail, data[user]).
function wordsOf(str) {
  const words = String(str || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean);
  return words.length && words.every(w => /^[a-z]+$/.test(w)) ? words : null;
}

const AMBIGUOUS = Symbol('ambiguous');

// The one name a list of things gives (each gives a name, nothing, or AMBIGUOUS),
// or null when none gives one or they disagree.
function oneName(items, nameOfItem) {
  const names = new Set();
  for (const item of items) {
    const name = nameOfItem(item);
    if (name === AMBIGUOUS) return null;
    if (name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

function iconNameOfElement(node) {
  const names = new Set();
  for (const token of (node.getAttribute('class') || '').split(/\s+/)) {
    const m = ICON_CLASS_RE.exec(token);
    if (!m) continue;
    const words = wordsOf(m[1] || m[2]);
    if (!words || words.every(w => ICON_MODIFIERS.has(w))) continue;
    names.add(sentenceCase(words));
  }
  if (names.size > 1) return AMBIGUOUS;
  return names.size ? [...names][0] : null;
}

// The icon is drawn by the control's shown children (not the parts inside an svg),
// or, when it has no children, by the control itself (<input type=button>, a
// role=img span). A control's own classes beside children describe the control
// (icon-only, has-icon), not its icon. isShown: the page does not hide it,
// whatever its size (an icon font draws in a pseudo-element; the icon for a
// toggle's other state is hidden).
function extractWordsFromClass(el, isShown) {
  const nodes = el.children.length
    ? [...el.querySelectorAll('*')].filter(n => !n.parentElement?.closest('svg') && isShown(n))
    : [el];
  return oneName(nodes, iconNameOfElement);
}

// A link's name from the last part of its path (/user/shopping-cart is
// "Shopping cart"); never for '#...' or '?...', which stay on this page.
const LINK_STOP_WORDS = new Set(['index', 'default', 'home', 'page']);

function extractNameFromLinkPath(link) {
  const href = (link.getAttribute('href') || '').trim();
  if (!href || href.charAt(0) === '#' || href.charAt(0) === '?') return null;
  const words = lastPathWords(href)?.filter(w => !LINK_STOP_WORDS.has(w) && !STYLE_WORDS.has(w));
  return words?.length ? sentenceCase(words) : null;
}

// A <label>, or a span or div the page's form styles call a label (field-label,
// form-label: the whole class, so Bootstrap's label badge is not one), right
// before the field.
const FORM_LABEL_CLASS_RE = /^(?:field|form|input|control)[-_]?label$/i;

function extractNearbyLabel(field) {
  const prev = field.previousElementSibling;
  if (!prev) return null;
  const doc = field.ownerDocument;
  const classAttr = prev.getAttribute('class') || '';
  const isLabel = prev.tagName === 'LABEL' ||
    (/^(SPAN|DIV)$/.test(prev.tagName) && classAttr.split(/\s+/).some(c => FORM_LABEL_CLASS_RE.test(c)));
  if (!isLabel) return null;

  // It labels nothing else: a for names the field it points to, a control inside
  // it is its own, and what points to it by aria-labelledby or aria-describedby is
  // what it is for.
  if (prev.hasAttribute('for')) return null;
  if (prev.querySelector('input, select, textarea, button')) return null;
  if (prev.id) {
    try {
      const id = CSS.escape(prev.id);
      if (doc.querySelector(`[aria-labelledby~="${id}"], [aria-describedby~="${id}"]`)) return null;
    } catch { return null; }
  }
  // A label right after a checkbox or radio button is that box's: theirs follow them.
  const before = prev.previousElementSibling;
  if (before?.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(before.getAttribute('type') || '')) return null;

  // Error and status messages are not names.
  const role = (prev.getAttribute('role') || '').toLowerCase().trim();
  if (role === 'alert' || role === 'status' || prev.hasAttribute('aria-live')) return null;
  if (/(?:error|invalid|feedback|alert|danger|warning|validation)/i.test(classAttr)) return null;

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

    const isShown = (el) => s.page.isVisible(el, { size: false });
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

      const role = (el.getAttribute('role') || '').toLowerCase().trim();
      const isControl = /^(BUTTON|A)$/.test(tag) ||
                        (tag === 'INPUT' && /^(button|submit|reset|image)$/.test(type)) ||
                        role === 'button' || role === 'link';

      // 1. SVG title inside control (of the svgs it shows; they must agree)
      const svgTitle = oneName([...el.querySelectorAll('svg')].filter(isShown),
        svg => svg.querySelector('title')?.textContent?.trim());
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

      // (the small icon images it shows; they must agree)
      const childIcons = [...el.querySelectorAll('img')]
        .filter(img => isShown(img) && isSmallIcon(img) && !isSpacerImage(img));
      const childIconName = oneName(childIcons, img => extractWordsFromFileName(img.getAttribute('src')));
      if (childIconName) {
        s.setAttr(el, 'aria-label', childIconName);
        changesCount++;
        markSmallImagesInNamedControl(el);
        return true;
      }

      // 3. Class words of the icon a control or a role=img element shows
      const classWords = (isControl || role === 'img') ? extractWordsFromClass(el, isShown) : null;
      if (classWords) {
        s.setAttr(el, 'aria-label', classWords);
        changesCount++;
        markSmallImagesInNamedControl(el);
        return true;
      }

      // 4. Link last path part
      if (tag === 'A' || role === 'link') {
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
        // Only a name made of words (customer_email), not a framework's key
        // (ctl00$MainContent$txtEmail, user[email], field_17).
        const nameWords = nameAttr && !isJunkName(nameAttr) ? wordsOf(nameAttr) : null;
        if (nameWords) {
          s.setAttr(el, 'aria-label', sentenceCase(nameWords));
          changesCount++;
          return true;
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
        const role = (el.getAttribute('role') || '').toLowerCase().trim();
        // An image, by its tag or its role, is described from how it looks, and
        // only when it is informative; a small one is left as it was.
        if (tag === 'IMG' || role === 'img') {
          if (role === 'presentation' || role === 'none') continue;
          if (!isInformativeImage(el)) continue;

          aiAsked.add(el);
          aiCallsMade++;
          try {
            const alt = await s.ai.vision('describe', el, { purpose: 'alt' });
            if (alt && typeof alt === 'string' && alt.trim() && s.alive()) {
              s.setAttr(el, tag === 'IMG' ? 'alt' : 'aria-label', alt.trim());
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
