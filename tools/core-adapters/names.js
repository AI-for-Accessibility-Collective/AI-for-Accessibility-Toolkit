// names.js — Gives buttons, links, form fields, and images accessible names or descriptions.
// Barrier: Interactive elements (buttons, links, form fields) without accessible names
// and informative images without alternative text are inaccessible to people using screen
// readers, speech navigation, or braille displays (WCAG 4.1.2, 1.1.1, 2.4.4, 2.5.3).
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
// Prior work to learn from: tools/adapters/generate-labels.js, tools/adapters/generate-alt.js, tools/adapters/wcag-fixes.js.
//
// Options:
//   limit: Maximum number of AI calls per page (default: 10, option allows up to 20).
//
// Decisions:
//   • Measures first with toolkit.page.nameOf(el): never renames any control that already has a name.
//   • Inspects page-first signals without AI before spending any AI budget:
//       1) title attributes on the element or child elements;
//       2) <title> element inside SVG icons;
//       3) keywords or words extracted from an icon's class name (e.g. btn-search -> "Search");
//       4) words extracted from an image file name, BUT only for small icons (<= 48 by 48 pixels);
//       5) the last meaningful path part of a link's destination (e.g. /account/settings -> "Settings");
//       6) nearby label, placeholder, name attribute, or sibling/parent text for form fields.
//   • Never names a photo or illustration (> 48x48 pixels) from its file name; on null from AI, it is left as it was.
//   • Never sends decorative images (tiny <= 1x1, spacers, tracking pixels, role="presentation" or role="none") to AI.
//     Marks clearly decorative images with alt="" only when certain.
//   • Only sends images to AI vision (s.ai.vision('describe', img, { purpose: 'alt' })) when informative (> 48x48 pixels and not decorative).
//   • Never calls AI for hidden content (!toolkit.page.isVisible(el)) or toolkit UI.
//   • Prioritizes visible nameless elements first, asking AI once per element, up to the configured limit per page.
//   • On null or unavailable AI answer, leaves the element exactly as it was.
//   • Applies names via s.setAttr(el, 'aria-label', name) for controls, and s.setAttr(img, 'alt', description) for images.
//   • Listens for dynamic content with s.watch.added(..., { batch: true }) to name added controls within remaining budget.
//   • Cleanly restores original attributes on disable() through session cleanup.
//   • Returns false when nothing on the page was changed.
//
// What it cannot do:
//   • Cannot generate descriptions for complex charts or diagrams without specialized vision models.
//   • Cannot infer names for custom div controls that lack text, attributes, semantic roles, or visual context.

const JUNK_RE = /^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken|null|undefined|nan|unknown|none|true|false|img|image|icon|button|btn|pic|picture|untitled|default)$/i;

function isJunkName(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim();
  if (t.length < 2 || t.length > 80) return true;
  if (/^[\d_\-.:;/#?&=+*^%$@!~`]+$/.test(t)) return true;
  if (/^[a-f0-9]{16,}$/i.test(t)) return true;
  return JUNK_RE.test(t);
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ICON_PATTERNS = {
  close: ['close', 'dismiss', 'x-btn', 'btn-close', 'cancel', 'clear-btn'],
  menu: ['menu', 'hamburger', 'nav-toggle', 'navigation-toggle', 'drawer-toggle'],
  search: ['search', 'find', 'magnifier', 'lookup'],
  submit: ['submit', 'send', 'paper-plane'],
  play: ['play', 'start'],
  pause: ['pause', 'hold'],
  next: ['next', 'forward', 'arrow-right', 'chevron-right', 'caret-right'],
  previous: ['prev', 'previous', 'back', 'arrow-left', 'chevron-left', 'caret-left'],
  expand: ['expand', 'dropdown', 'chevron-down', 'caret-down', 'angle-down'],
  collapse: ['collapse', 'chevron-up', 'caret-up', 'angle-up'],
  settings: ['settings', 'config', 'gear', 'cog', 'preferences'],
  delete: ['delete', 'remove', 'trash', 'bin'],
  edit: ['edit', 'pencil', 'modify', 'write'],
  share: ['share', 'social'],
  like: ['like', 'heart', 'favorite', 'thumbs-up'],
  copy: ['copy', 'clipboard', 'duplicate'],
  home: ['home', 'house'],
  cart: ['cart', 'shopping-cart', 'basket', 'bag'],
  user: ['user', 'account', 'profile', 'avatar', 'person'],
  help: ['help', 'question', 'faq', 'support'],
  info: ['info', 'information'],
  mail: ['mail', 'email', 'envelope', 'inbox'],
  phone: ['phone', 'telephone', 'call'],
  filter: ['filter', 'funnel'],
  download: ['download'],
  upload: ['upload'],
  print: ['print', 'printer'],
  refresh: ['refresh', 'reload', 'sync', 'rotate'],
  notifications: ['bell', 'notification', 'alarm'],
  star: ['star'],
  calendar: ['calendar', 'date'],
  messages: ['chat', 'message', 'comment'],
};

function wordsFromIconClass(className) {
  if (!className || typeof className !== 'string') return null;
  const lower = className.toLowerCase();

  for (const [label, keywords] of Object.entries(ICON_PATTERNS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return capitalize(label.replace(/[-_]/g, ' '));
    }
  }

  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    const stripped = token
      .replace(/^(fa[srlbd]?|bi|glyphicon|icon|btn|ui-icon|feather|material-icons)[-_:]/i, '')
      .replace(/[-_](icon|btn|button)$/i, '');
    if (stripped.length >= 3 && !isJunkName(stripped)) {
      const words = stripped.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (words && !isJunkName(words)) {
        return capitalize(words);
      }
    }
  }
  return null;
}

function wordsFromFilename(src) {
  if (!src || typeof src !== 'string') return null;
  if (src.startsWith('data:')) return null;
  try {
    const url = src.split('?')[0].split('#')[0];
    const filename = url.substring(url.lastIndexOf('/') + 1);
    const basename = filename.substring(0, filename.lastIndexOf('.')) || filename;
    if (!basename || basename.length < 2) return null;
    if (/^[0-9a-f]{8,}$/i.test(basename)) return null;
    if (/^\d+$/.test(basename)) return null;

    const parts = basename
      .replace(/^(icon|btn|img|pic|asset)[-_]/i, '')
      .replace(/[-_](icon|btn|button|small|tiny|thumb|thumbnail|16x16|24x24|32x32|48x48)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    if (parts && parts.length >= 3 && !isJunkName(parts)) {
      return capitalize(parts);
    }
  } catch {}
  return null;
}

function getImageDimensions(img) {
  const rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : { width: 0, height: 0 };
  const attrW = parseInt(img.getAttribute('width') || '0', 10);
  const attrH = parseInt(img.getAttribute('height') || '0', 10);
  const w = rect.width || img.naturalWidth || attrW;
  const h = rect.height || img.naturalHeight || attrH;
  return { w, h };
}

function isSmallIcon(img) {
  if (!img || img.tagName !== 'IMG') return false;
  const { w, h } = getImageDimensions(img);
  return w > 0 && h > 0 && w <= 48 && h <= 48;
}

function isClearlyDecorative(img) {
  if (!img || img.tagName !== 'IMG') return false;
  const role = (img.getAttribute('role') || '').toLowerCase();
  if (role === 'presentation' || role === 'none') return true;
  if (img.getAttribute('aria-hidden') === 'true') return true;

  const { w, h } = getImageDimensions(img);
  if ((w > 0 && w <= 1) || (h > 0 && h <= 1)) return true;

  const src = (img.getAttribute('src') || img.src || '').toLowerCase();
  if (/(?:^|[_\-/])(spacer|blank|pixel|1x1|dot|tracker|transparent|clear)\.(gif|png|jpe?g|webp|svg)/i.test(src)) return true;
  if (src.startsWith('data:image/gif;base64,R0lGODlhAQAB')) return true;

  return false;
}

function isInformativeImage(img) {
  if (!img || img.tagName !== 'IMG') return false;
  if (isClearlyDecorative(img)) return false;
  const { w, h } = getImageDimensions(img);
  return w > 48 && h > 48;
}

function wordsFromLinkPath(link) {
  if (!link) return null;
  const rawHref = link.getAttribute('href');
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href === '#' || href.startsWith('javascript:')) return null;

  if (href.startsWith('mailto:')) {
    const email = href.slice(7).split('?')[0].trim();
    return email ? `Email ${email}` : 'Email';
  }
  if (href.startsWith('tel:')) {
    const phone = href.slice(4).split('?')[0].trim();
    return phone ? `Call ${phone}` : 'Call';
  }

  let pathname = '';
  try {
    pathname = new URL(href, window.location.href).pathname;
  } catch {
    pathname = href.split(/[?#]/)[0];
  }

  pathname = pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return null;

  let last = segments[segments.length - 1];
  last = last.replace(/\.[a-zA-Z0-9]+$/, '');
  if (/^(index|home|default|main)$/i.test(last) && segments.length > 1) {
    last = segments[segments.length - 2];
  }

  if (last && !isJunkName(last)) {
    const words = last.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (words && words.length >= 3 && !isJunkName(words)) {
      return capitalize(words);
    }
  }
  return null;
}

function wordsFromNearbyLabel(input, doc) {
  if (!input) return null;

  if (input.placeholder && !isJunkName(input.placeholder)) {
    return input.placeholder.trim();
  }

  if (input.name && !isJunkName(input.name)) {
    const formatted = input.name
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
    if (formatted && formatted.length >= 3 && !isJunkName(formatted)) {
      return capitalize(formatted);
    }
  }

  if (input.labels && input.labels.length) {
    const text = input.labels[0].textContent?.trim();
    if (text && text.length >= 2 && text.length <= 60 && !/\n/.test(text) && !isJunkName(text)) {
      return text.replace(/:$/, '');
    }
  }

  if (input.id) {
    try {
      const lbl = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const text = lbl?.textContent?.trim();
      if (text && text.length >= 2 && text.length <= 60 && !/\n/.test(text) && !isJunkName(text)) {
        return text.replace(/:$/, '');
      }
    } catch {}
  }

  const prev = input.previousElementSibling;
  if (prev && !/^(SCRIPT|STYLE|TEMPLATE|INPUT|SELECT|TEXTAREA|BUTTON|H[1-6])$/i.test(prev.tagName)) {
    const text = prev.textContent?.trim().replace(/:$/, '');
    if (text && text.length >= 2 && text.length <= 60 && !/\n/.test(text) && !isJunkName(text)) {
      return text;
    }
  }

  const next = input.nextElementSibling;
  if (next && !/^(SCRIPT|STYLE|TEMPLATE|INPUT|SELECT|TEXTAREA|BUTTON|H[1-6])$/i.test(next.tagName)) {
    const text = next.textContent?.trim().replace(/:$/, '');
    if (text && text.length >= 2 && text.length <= 60 && !/\n/.test(text) && !isJunkName(text)) {
      return text;
    }
  }

  const parent = input.parentElement;
  if (parent && !/^(BODY|HTML|MAIN|FORM|SECTION|ARTICLE|NAV|ASIDE|HEADER|FOOTER)$/i.test(parent.tagName)) {
    if (!parent.querySelector('h1, h2, h3, h4, h5, h6')) {
      const clone = parent.cloneNode(true);
      for (const el of clone.querySelectorAll('script, style, template, input, select, textarea, button')) {
        el.remove();
      }
      const text = clone.textContent?.trim().replace(/:$/, '');
      if (text && text.length >= 2 && text.length <= 60 && !/\n/.test(text) && !isJunkName(text)) {
        return text;
      }
    }
  }

  return null;
}

function wordsFromChildTitle(el) {
  if (!el) return null;
  const svgTitle = el.querySelector('svg title')?.textContent?.trim();
  if (svgTitle && !isJunkName(svgTitle)) return svgTitle;

  const child = el.querySelector('[title]');
  if (child) {
    const title = child.getAttribute('title')?.trim();
    if (title && !isJunkName(title)) return title;
  }

  return null;
}

function hasProperName(el, page, doc) {
  if (!el) return true;
  const tag = el.tagName;
  const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (isField) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (/^(button|submit|reset)$/.test(type)) {
      return Boolean(el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'));
    }
    if (el.getAttribute('aria-label')?.trim()) return true;
    if (el.getAttribute('aria-labelledby')?.trim()) return true;
    if (el.getAttribute('title')?.trim()) return true;
    if (el.labels && el.labels.length > 0) return true;
    if (el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
    if (el.closest('label')) return true;
    return false;
  }

  const name = page.nameOf(el);
  return Boolean(name && name.trim());
}

function findPageFirstName(el, page, doc) {
  const tag = el.tagName;
  const isButton = tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.getAttribute('type') || ''));
  const isLink = tag === 'A' || el.getAttribute('role') === 'link';
  const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || /^(textbox|searchbox|combobox|listbox|slider|spinbutton|checkbox|radio|switch)$/i.test(el.getAttribute('role') || '');
  const isImg = tag === 'IMG';

  if (isImg && !isSmallIcon(el)) {
    return null;
  }

  const titleName = wordsFromChildTitle(el);
  if (titleName) return titleName;

  const classCandidate = [
    typeof el.className === 'string' ? el.className : '',
    ...Array.from(el.querySelectorAll('i, span, svg, em')).map((c) => (typeof c.className === 'string' ? c.className : '')),
  ].filter(Boolean);
  for (const cls of classCandidate) {
    const w = wordsFromIconClass(cls);
    if (w) return w;
  }

  if (isButton || isLink) {
    const innerImg = el.querySelector('img');
    if (innerImg && isSmallIcon(innerImg)) {
      const w = wordsFromFilename(innerImg.getAttribute('src') || innerImg.src);
      if (w) return w;
    }
  }

  if (isImg && isSmallIcon(el)) {
    const w = wordsFromFilename(el.getAttribute('src') || el.src);
    if (w) return w;
  }

  if (isLink) {
    const pathName = wordsFromLinkPath(el);
    if (pathName) return pathName;
  }

  if (isField) {
    const nearby = wordsFromNearbyLabel(el, doc);
    if (nearby) return nearby;
  }

  return null;
}

function getContextForElement(el) {
  const parent = el.parentElement;
  if (!parent) return '';
  const clone = parent.cloneNode(true);
  for (const s of clone.querySelectorAll('script, style, template, noscript')) {
    s.remove();
  }
  return (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function findHeadingFor(el, doc) {
  let prev = el;
  while (prev) {
    let sibling = prev.previousElementSibling;
    while (sibling) {
      const h = sibling.matches?.('h1, h2, h3, h4, h5, h6, [role="heading"]')
        ? sibling
        : sibling.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (h) return (h.textContent || '').replace(/\s+/g, ' ').trim();
      sibling = sibling.previousElementSibling;
    }
    prev = prev.parentElement;
  }
  const mainHeading = doc.querySelector('h1, h2, [role="heading"]');
  return mainHeading?.textContent?.trim() || doc.title || '';
}

function buildLabelInput(el) {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type') || '';
  const role = el.getAttribute('role') || '';
  const kind = role || (tag === 'input' ? `${type} field` : tag);
  const context = getContextForElement(el);
  const href = el.getAttribute('href') || '';
  const name = el.getAttribute('name') || '';
  const placeholder = el.getAttribute('placeholder') || '';
  const cls = (typeof el.className === 'string' ? el.className : '') || '';

  const parts = [`Control type: ${kind}`];
  if (name) parts.push(`name: ${name}`);
  if (placeholder) parts.push(`placeholder: ${placeholder}`);
  if (href) parts.push(`href: ${href}`);
  if (cls) parts.push(`class: ${cls}`);
  if (context) parts.push(`context: ${context}`);
  return parts.join('; ').slice(0, 500);
}

const CONTROL_SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="radio"], [role="switch"]';

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const doc = document;
    const page = this.toolkit.page;

    const limit = Math.max(0, Math.min(20, Number(this.options.limit ?? this.options.maxAiCalls ?? 10)));
    let aiCallsCount = 0;
    let fixesCount = 0;
    const askedAi = new WeakSet();

    const processElement = async (el) => {
      if (!el || !el.isConnected || page.isOurs(el) || !page.isVisible(el)) return false;

      const tag = el.tagName;
      const isImg = tag === 'IMG';

      if (isImg) {
        if (el.hasAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) {
          return false;
        }

        if (isClearlyDecorative(el)) {
          const role = (el.getAttribute('role') || '').toLowerCase();
          if (role !== 'presentation' && role !== 'none') {
            s.setAttr(el, 'alt', '');
            fixesCount++;
            return true;
          }
          return false;
        }

        const parentControl = el.closest('button, a[href], [role="button"], [role="link"]');
        if (parentControl && (hasProperName(parentControl, page, doc) || parentControl.getAttribute('aria-label'))) {
          s.setAttr(el, 'alt', '');
          fixesCount++;
          return true;
        }

        if (isSmallIcon(el)) {
          const pageFirstName = findPageFirstName(el, page, doc);
          if (pageFirstName) {
            s.setAttr(el, 'alt', pageFirstName);
            fixesCount++;
            return true;
          }
          return false;
        }

        if (isInformativeImage(el)) {
          if (aiCallsCount >= limit || askedAi.has(el)) return false;
          askedAi.add(el);
          aiCallsCount++;
          try {
            const alt = await s.ai.vision('describe', el, { purpose: 'alt' });
            if (!s.alive()) return false;
            if (alt && typeof alt === 'string' && alt.trim()) {
              s.setAttr(el, 'alt', alt.trim());
              fixesCount++;
              return true;
            }
          } catch {}
        }
        return false;
      }

      if (hasProperName(el, page, doc)) {
        const innerImg = el.querySelector('img:not([alt])');
        if (innerImg) {
          s.setAttr(innerImg, 'alt', '');
          fixesCount++;
        }
        return false;
      }

      const pageFirstName = findPageFirstName(el, page, doc);
      if (pageFirstName) {
        s.setAttr(el, 'aria-label', pageFirstName);
        fixesCount++;
        const innerImg = el.querySelector('img:not([alt])');
        if (innerImg) {
          s.setAttr(innerImg, 'alt', '');
          fixesCount++;
        }
        return true;
      }

      if (aiCallsCount >= limit || askedAi.has(el)) return false;
      askedAi.add(el);
      aiCallsCount++;

      try {
        const context = findHeadingFor(el, doc);
        const label = await s.ai.text('label', buildLabelInput(el), { context });
        if (!s.alive()) return false;
        if (label && typeof label === 'string' && label.trim()) {
          s.setAttr(el, 'aria-label', label.trim());
          fixesCount++;
          const innerImg = el.querySelector('img:not([alt])');
          if (innerImg) {
            s.setAttr(innerImg, 'alt', '');
            fixesCount++;
          }
          return true;
        }
      } catch {}

      return false;
    };

    const root = doc.body || doc.documentElement;
    if (!root) return false;

    // First collect all controls and images
    const controls = Array.from(root.querySelectorAll(CONTROL_SELECTOR)).filter((el) => page.isVisible(el) && !page.isOurs(el));
    const images = Array.from(root.querySelectorAll('img')).filter((el) => page.isVisible(el) && !page.isOurs(el));

    // Page-first pass for all controls and non-AI images
    const aiCandidates = [];

    for (const ctrl of controls) {
      if (hasProperName(ctrl, page, doc)) {
        const innerImg = ctrl.querySelector('img:not([alt])');
        if (innerImg) {
          s.setAttr(innerImg, 'alt', '');
          fixesCount++;
        }
        continue;
      }

      const pageFirstName = findPageFirstName(ctrl, page, doc);
      if (pageFirstName) {
        s.setAttr(ctrl, 'aria-label', pageFirstName);
        fixesCount++;
        const innerImg = ctrl.querySelector('img:not([alt])');
        if (innerImg) {
          s.setAttr(innerImg, 'alt', '');
          fixesCount++;
        }
      } else {
        aiCandidates.push(ctrl);
      }
    }

    for (const img of images) {
      if (img.hasAttribute('alt') || img.getAttribute('aria-label') || img.getAttribute('aria-labelledby')) {
        continue;
      }

      if (isClearlyDecorative(img)) {
        const role = (img.getAttribute('role') || '').toLowerCase();
        if (role !== 'presentation' && role !== 'none') {
          s.setAttr(img, 'alt', '');
          fixesCount++;
        }
        continue;
      }

      const parentControl = img.closest('button, a[href], [role="button"], [role="link"]');
      if (parentControl && (hasProperName(parentControl, page, doc) || parentControl.getAttribute('aria-label'))) {
        s.setAttr(img, 'alt', '');
        fixesCount++;
        continue;
      }

      if (isSmallIcon(img)) {
        const pageFirstName = findPageFirstName(img, page, doc);
        if (pageFirstName) {
          s.setAttr(img, 'alt', pageFirstName);
          fixesCount++;
        }
        continue;
      }

      if (isInformativeImage(img)) {
        aiCandidates.push(img);
      }
    }

    // Sort AI candidates: in-viewport first
    aiCandidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const aInView = ra.top >= 0 && ra.top <= window.innerHeight;
      const bInView = rb.top >= 0 && rb.top <= window.innerHeight;
      if (aInView && !bInView) return -1;
      if (!aInView && bInView) return 1;
      return 0;
    });

    // Run AI pass up to limit
    for (const el of aiCandidates) {
      if (aiCallsCount >= limit || !s.alive()) break;
      await processElement(el);
    }

    // Watch for dynamically added nodes
    s.watch.added(
      root,
      async (addedElements) => {
        if (!s.alive()) return;
        for (const el of addedElements) {
          if (!s.alive()) break;
          if (el.matches?.(CONTROL_SELECTOR) || el.matches?.('img')) {
            await processElement(el);
          }
          if (typeof el.querySelectorAll === 'function') {
            for (const child of el.querySelectorAll(`${CONTROL_SELECTOR}, img`)) {
              if (!s.alive()) break;
              await processElement(child);
            }
          }
        }
      },
      { batch: true }
    );

    if (fixesCount === 0) {
      this.disable();
      return false;
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
