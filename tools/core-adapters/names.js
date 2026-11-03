// names.js — Gives buttons, links, form fields, and informative images accessible names and descriptions.
// Barrier: Screen reader users and speech-control users cannot navigate or interact with
// unnamed controls, or understand the purpose of informative images lacking text alternatives.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   limit: Maximum number of elements to query AI for per page. Defaults to 10.
//
// Decisions:
//   • Measures first with s.page.nameOf: never renames controls or images that already have names.
//   • Names from the page first without AI:
//     - Element's own title attribute
//     - SVG title elements inside the control
//     - Words extracted from icon CSS class names or icon image file names (<= 48x48)
//     - Link's last URL path segment (ignoring '#' or '?' links)
//     - Associated placeholder, name attribute, or nearby label text
//   • Matches whole word tokens from classes and file names; style words (btn, icon, primary, etc.) are excluded.
//   • File names only name small icons (<= 48x48); photos/illustrations (> 48px) are never named from file names.
//   • Clearly decorative images (tiny <= 1x1, spacers) are marked alt=""; role="presentation" images are left alone.
//   • Marks small or clearly decorative images inside named controls alt="".
//   • Queries AI (s.ai.text for controls, s.ai.vision for images) only for still-nameless, visible elements.
//   • Caps AI calls to options.limit (default 10) to respect the person's daily budget.
//   • On null from the AI or when AI is unavailable, elements are left exactly as they were.
//   • Undoes all attribute changes cleanly on disable() via session cleanup.
//
// What it cannot do:
//   • Cannot invent descriptions for images or controls when AI is unavailable and page signals are absent.
//   • Does not label hidden or off-screen controls.

const STYLE_WORDS = new Set([
  'btn', 'button', 'icon', 'fa', 'fas', 'far', 'fal', 'fad', 'fab',
  'glyphicon', 'material-icons', 'material-symbols', 'feather',
  'primary', 'secondary', 'tertiary', 'success', 'danger', 'warning', 'info',
  'default', 'light', 'dark', 'large', 'small', 'medium', 'sm', 'md', 'lg', 'xl', 'xs',
  'active', 'disabled', 'link', 'nav', 'item', 'wrap', 'wrapper', 'container',
  'group', 'box', 'bar', 'toggle', 'ui', 'action', 'widget', 'control', 'component',
  'element', 'clickable', 'pressable', 'touchable', 'view', 'svg', 'img', 'image',
  'pic', 'picture', 'photo', 'inline', 'block', 'flex', 'grid', 'row', 'col',
  'left', 'right', 'top', 'bottom', 'center', 'header', 'footer', 'sidebar',
]);

const JUNK_WORDS = new Set([
  'q', 's', 'utf8', 'token', 'id', 'csrf', '_csrf', 'authenticity_token',
  'requestverificationtoken', 'null', 'undefined', 'true', 'false', 'none',
  'empty', 'blank', 'test', 'temp', 'tmp',
]);

function wordsFrom(str) {
  if (!str || typeof str !== 'string') return [];
  const clean = str
    .replace(/[?#].*$/, '')
    .replace(/\.(png|jpe?g|svg|gif|webp|avif|ico|bmp|html?|php|aspx?|jsp)$/i, '');
  const tokens = clean
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return tokens.filter((t) => !STYLE_WORDS.has(t) && !JUNK_WORDS.has(t) && !/^\d+$/.test(t));
}

function formatWords(words) {
  if (!words || !words.length) return '';
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function getImageSize(img) {
  const attrW = parseInt(img.getAttribute('width') || '0', 10);
  const attrH = parseInt(img.getAttribute('height') || '0', 10);
  if (attrW > 0 && attrH > 0) return { width: attrW, height: attrH };

  const naturalW = img.naturalWidth || 0;
  const naturalH = img.naturalHeight || 0;
  if (naturalW > 0 && naturalH > 0) return { width: naturalW, height: naturalH };

  try {
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  } catch {}

  return { width: attrW || naturalW || 0, height: attrH || naturalH || 0 };
}

function isTinyOrSpacer(img) {
  const size = getImageSize(img);
  if (size.width > 0 && size.width <= 1 && size.height > 0 && size.height <= 1) return true;
  const src = img.getAttribute('src') || '';
  return /spacer|pixel|blank|clear|1x1/i.test(src);
}

function isExplicitlyDecorative(img) {
  const role = (img.getAttribute('role') || '').toLowerCase().trim();
  return role === 'presentation' || role === 'none';
}

function hasFieldAccessibleName(field) {
  if (field.getAttribute('aria-label')?.trim()) return true;
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.trim().split(/\s+/);
    for (const id of ids) {
      const el = field.ownerDocument.getElementById(id);
      if (el && (el.getAttribute('aria-label')?.trim() || el.textContent.trim())) return true;
    }
  }
  if (field.labels && field.labels.length > 0) {
    for (const l of field.labels) {
      if (l.textContent.trim()) return true;
    }
  }
  if (field.id) {
    const forLabels = field.ownerDocument.querySelectorAll(`label[for="${CSS.escape(field.id)}"]`);
    for (const l of forLabels) {
      if (l.textContent.trim()) return true;
    }
  }
  const wrapLabel = field.closest('label');
  if (wrapLabel) {
    const clone = wrapLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
    if (clone.textContent.trim()) return true;
  }
  if (field.getAttribute('title')?.trim()) return true;
  return false;
}

function getNearbyLabelText(field) {
  const extract = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName;
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag)) return '';
    if (tag === 'LABEL' && el.htmlFor && el.htmlFor !== field.id) return '';
    if (tag === 'LABEL' && el.querySelector('input, select, textarea') && !el.contains(field)) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, svg, input, select, textarea, button').forEach((n) => n.remove());
    const raw = (clone.textContent || '').trim().replace(/:\s*$/, '').trim();
    if (!raw || raw.length > 60 || /\n/.test(raw)) return '';
    if (JUNK_WORDS.has(raw.toLowerCase())) return '';
    return raw;
  };

  const prev = field.previousElementSibling;
  if (prev) {
    const text = extract(prev);
    if (text) return text;
  }
  const next = field.nextElementSibling;
  if (next) {
    const text = extract(next);
    if (text) return text;
  }
  const parent = field.parentElement;
  if (parent && parent.children.length <= 4) {
    for (const child of parent.children) {
      if (child !== field) {
        const text = extract(child);
        if (text) return text;
      }
    }
  }
  return '';
}

function extractIconClassWords(el) {
  const classNames = [];
  if (el.className && typeof el.className === 'string') classNames.push(el.className);
  for (const child of el.querySelectorAll('[class]')) {
    if (child.className && typeof child.className === 'string') classNames.push(child.className);
  }
  for (const cls of classNames) {
    const words = wordsFrom(cls);
    if (words.length > 0) return words;
  }
  return [];
}

function getSvgTitle(el) {
  return el.querySelector('svg title')?.textContent?.trim() || '';
}

function getLinkPathWords(link) {
  const rawHref = (link.getAttribute('href') || '').trim();
  if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('?') || rawHref.startsWith('javascript:')) {
    return '';
  }
  try {
    const url = new URL(rawHref, link.ownerDocument.baseURI);
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments.pop();
    if (last) {
      const words = wordsFrom(last);
      return formatWords(words);
    }
  } catch {}
  return '';
}

function markDecorativeImagesInside(control, s) {
  for (const img of control.querySelectorAll('img')) {
    if (img.hasAttribute('alt') && img.getAttribute('alt') !== '') continue;
    const size = getImageSize(img);
    const isSmall = size.width > 0 && size.width <= 48 && size.height > 0 && size.height <= 48;
    if (isSmall || isTinyOrSpacer(img) || isExplicitlyDecorative(img)) {
      s.setAttr(img, 'alt', '');
    }
  }
}

function getControlContext(el) {
  const parent = el.parentElement;
  if (!parent) return '';
  const clone = parent.cloneNode(true);
  clone.querySelectorAll('script, style, svg').forEach((n) => n.remove());
  const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 100);
}

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const limit = typeof this.options.limit === 'number' ? this.options.limit : 10;
    const doc = document;
    const root = doc.body || doc.documentElement;
    if (!root) {
      this.disable();
      return false;
    }

    let appliedCount = 0;
    const aiQueue = [];
    const processed = new WeakSet();

    const processElement = (el) => {
      if (!s.page.isVisible(el)) return;

      const tag = el.tagName;
      const role = (el.getAttribute('role') || '').toLowerCase().trim();

      // 1. Images
      if (tag === 'IMG') {
        if (el.hasAttribute('alt')) return;
        if (isExplicitlyDecorative(el)) return;

        if (isTinyOrSpacer(el)) {
          s.setAttr(el, 'alt', '');
          appliedCount++;
          return;
        }

        const size = getImageSize(el);
        const isSmall = size.width > 0 && size.width <= 48 && size.height > 0 && size.height <= 48;
        const isInformative = size.width > 48 || size.height > 48;

        const parentControl = el.closest('button, [role="button"], a[href], [role="link"]');
        if (parentControl && s.page.nameOf(parentControl)) {
          if (isSmall || isTinyOrSpacer(el)) {
            s.setAttr(el, 'alt', '');
            appliedCount++;
            return;
          }
        }

        if (isSmall) {
          const fileWords = wordsFrom(el.getAttribute('src') || el.src);
          if (fileWords.length > 0) {
            s.setAttr(el, 'alt', formatWords(fileWords));
            appliedCount++;
          }
          return;
        }

        if (isInformative) {
          aiQueue.push(el);
        }
        return;
      }

      // 2. Buttons and Links
      const isButton = tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type));
      const isLink = (tag === 'A' && el.hasAttribute('href')) || role === 'link';

      if (isButton || isLink) {
        const currentName = s.page.nameOf(el);
        if (currentName) {
          markDecorativeImagesInside(el, s);
          return;
        }

        let name = el.getAttribute('title')?.trim() || '';

        if (!name) {
          const svgTitle = getSvgTitle(el);
          if (svgTitle) name = svgTitle;
        }

        if (!name) {
          const classWords = extractIconClassWords(el);
          if (classWords.length > 0) name = formatWords(classWords);
        }

        if (!name) {
          const childImg = el.querySelector('img');
          if (childImg) {
            const size = getImageSize(childImg);
            if (size.width > 0 && size.width <= 48 && size.height > 0 && size.height <= 48) {
              const fileWords = wordsFrom(childImg.getAttribute('src') || childImg.src);
              if (fileWords.length > 0) name = formatWords(fileWords);
            }
          }
        }

        if (!name && isLink) {
          const pathName = getLinkPathWords(el);
          if (pathName) name = pathName;
        }

        if (name) {
          s.setAttr(el, 'aria-label', name);
          appliedCount++;
          markDecorativeImagesInside(el, s);
        } else {
          aiQueue.push(el);
        }
        return;
      }

      // 3. Form fields
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'image') {
          if (el.hasAttribute('alt') && el.getAttribute('alt').trim()) return;
        } else if (hasFieldAccessibleName(el)) {
          return;
        }

        let name = el.getAttribute('title')?.trim() || '';

        if (!name && el.placeholder && !JUNK_WORDS.has(el.placeholder.toLowerCase().trim())) {
          name = el.placeholder.trim();
        }

        if (!name && el.name) {
          const nameWords = wordsFrom(el.name);
          if (nameWords.length > 0) name = formatWords(nameWords);
        }

        if (!name) {
          const nearby = getNearbyLabelText(el);
          if (nearby) name = nearby;
        }

        if (name) {
          s.setAttr(el, 'aria-label', name);
          appliedCount++;
        } else {
          aiQueue.push(el);
        }
      }
    };

    const elements = root.querySelectorAll(
      'button, [role="button"], a[href], [role="link"], input:not([type="hidden"]), textarea, select, img'
    );
    for (const el of elements) {
      processElement(el);
    }

    // 4. AI for remaining nameless visible elements
    let aiCalls = 0;
    for (const el of aiQueue) {
      if (!s.alive()) break;
      if (aiCalls >= limit) break;
      if (processed.has(el)) continue;
      if (!s.page.isVisible(el)) continue;

      processed.add(el);

      if (el.tagName === 'IMG') {
        if (el.hasAttribute('alt')) continue;
        aiCalls++;
        const desc = await s.ai.vision('describe', el, { purpose: 'alt' });
        if (desc && s.alive()) {
          s.setAttr(el, 'alt', desc.trim());
          appliedCount++;
        }
      } else {
        if (s.page.nameOf(el)) continue;
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const ctx = getControlContext(el);
        const input = [role, ctx].filter(Boolean).join(': ');
        aiCalls++;
        const label = await s.ai.text('label', input, {
          context: doc.title || undefined,
        });
        if (label && s.alive()) {
          s.setAttr(el, 'aria-label', label.trim());
          appliedCount++;
          markDecorativeImagesInside(el, s);
        }
      }
    }

    if (appliedCount === 0) {
      this.disable();
      return false;
    }

    // Watch for dynamically added elements and apply page-first fixes
    s.watch.added(
      root,
      (added) => {
        if (!s.alive() || !added || added.nodeType !== 1) return;
        if (!s.page.isVisible(added)) return;

        if (added.tagName === 'IMG') {
          if (added.hasAttribute('alt') || isExplicitlyDecorative(added)) return;
          if (isTinyOrSpacer(added)) {
            s.setAttr(added, 'alt', '');
            return;
          }
          const size = getImageSize(added);
          if (size.width > 0 && size.width <= 48 && size.height > 0 && size.height <= 48) {
            const fileWords = wordsFrom(added.getAttribute('src') || added.src);
            if (fileWords.length > 0) {
              s.setAttr(added, 'alt', formatWords(fileWords));
            }
          }
          return;
        }

        const tag = added.tagName;
        if (tag === 'BUTTON' || added.getAttribute('role') === 'button' || tag === 'A' || added.getAttribute('role') === 'link') {
          if (s.page.nameOf(added)) return;
          let name = added.getAttribute('title')?.trim() || getSvgTitle(added);
          if (!name) {
            const classWords = extractIconClassWords(added);
            if (classWords.length > 0) name = formatWords(classWords);
          }
          if (!name && (tag === 'A' || added.getAttribute('role') === 'link')) {
            name = getLinkPathWords(added);
          }
          if (name) {
            s.setAttr(added, 'aria-label', name);
            markDecorativeImagesInside(added, s);
          }
        } else if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
          if (hasFieldAccessibleName(added)) return;
          let name = added.getAttribute('title')?.trim();
          if (!name && added.placeholder && !JUNK_WORDS.has(added.placeholder.toLowerCase().trim())) {
            name = added.placeholder.trim();
          }
          if (!name && added.name) {
            const nameWords = wordsFrom(added.name);
            if (nameWords.length > 0) name = formatWords(nameWords);
          }
          if (!name) {
            const nearby = getNearbyLabelText(added);
            if (nearby) name = nearby;
          }
          if (name) {
            s.setAttr(added, 'aria-label', name);
          }
        }
      },
      { batch: true }
    );

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
