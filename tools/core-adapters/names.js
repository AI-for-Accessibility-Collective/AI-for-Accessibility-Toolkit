// names.js — Gives accessible names to nameless controls and informative images.
// Barrier: People using screen readers cannot identify the purpose of buttons, links,
// or form inputs that have no accessible name, or understand images that lack alt text.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   limit: Maximum number of AI calls per page (default 10).
//
// Decisions:
//   • Measures first using s.page's accessible-name helper (s.page.nameOf) and
//     never renames any control or image that already has an accessible name.
//   • Leaves decorative images alone, or marks clearly decorative ones (tiny <=16px,
//     spacers, role presentation/none) alt="" without spending an AI call.
//   • Names elements from the page first without AI: element title, SVG title,
//     words from an icon's class or image file name, link's last path part, or nearby label.
//   • AI is used only for what remains nameless, visible ones first, at most the limit per page.
//   • Images are sent to AI vision only when informative (larger than 48 by 48 pixels and not decorative).
//   • Never asks AI for content the page hides (display:none, visibility:hidden, hidden attribute, aria-hidden).
//   • Answers are gated by the building blocks; on null, elements are left unchanged.
//   • Watches for elements added later (s.watch.added) without reprocessing seen elements.
//   • All changes go through s.setAttr so disable() cleanly restores original state.
//
// What it cannot do:
//   • Cannot generate names for controls when AI is unavailable and DOM context lacks signals.
//   • Does not describe complex charts (use explore-a-chart instead).

const SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, img, [role="button"], [role="link"]';

const ICON_PATTERNS = {
  'Close': ['close', 'dismiss', 'x-btn', 'btn-close', 'times', 'cross'],
  'Menu': ['menu', 'hamburger', 'nav-toggle', 'bars'],
  'Search': ['search', 'find', 'magnifier', 'magnifying'],
  'Settings': ['settings', 'config', 'gear', 'cog', 'preferences'],
  'Home': ['home', 'house'],
  'User': ['user', 'profile', 'account', 'avatar', 'person'],
  'Shopping cart': ['shopping-cart', 'cart', 'basket', 'bag'],
  'Delete': ['delete', 'remove', 'trash', 'trash-can', 'bin'],
  'Edit': ['edit', 'pencil', 'modify'],
  'Share': ['share', 'forward'],
  'Download': ['download'],
  'Upload': ['upload'],
  'Filter': ['filter'],
  'Print': ['print', 'printer'],
  'Refresh': ['refresh', 'reload', 'sync'],
  'Favorite': ['favorite', 'star', 'like', 'heart', 'bookmark'],
  'Play': ['play'],
  'Pause': ['pause'],
  'Stop': ['stop'],
  'Next': ['next', 'arrow-right', 'chevron-right', 'forward'],
  'Previous': ['prev', 'previous', 'arrow-left', 'chevron-left', 'back'],
  'Expand': ['expand', 'more', 'dropdown', 'chevron-down'],
  'Collapse': ['collapse', 'less', 'chevron-up'],
  'Help': ['help', 'question', 'faq', 'info', 'information'],
  'Notification': ['notification', 'bell', 'alert'],
  'Mail': ['mail', 'email', 'envelope'],
  'Phone': ['phone', 'telephone', 'call'],
  'Add': ['add', 'plus', 'create', 'new'],
  'Copy': ['copy', 'clipboard'],
  'Zoom in': ['zoom-in'],
  'Zoom out': ['zoom-out'],
};

function squash(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isClearlyDecorative(img, win) {
  const role = (img.getAttribute('role') || '').toLowerCase();
  if (role === 'presentation' || role === 'none') return true;
  if (img.getAttribute('aria-hidden') === 'true') return true;

  const src = img.getAttribute('src') || '';
  if (/(\b|_|-)(spacer|blank|pixel|transparent|clear|1x1|dot)(\b|_|-|\.)/i.test(src) || /data:image\/gif;base64,R0lGODlhAQABA/i.test(src)) {
    return true;
  }

  const cls = (typeof img.className === 'string' ? img.className : '') + ' ' + (img.id || '');
  if (/(\b|_|-)(spacer|decorative|tracking|separator)(\b|_|-)/i.test(cls)) {
    return true;
  }

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if ((w > 0 && w <= 16) || (h > 0 && h <= 16)) return true;

  if (img.isConnected && win) {
    try {
      const rect = img.getBoundingClientRect();
      if ((rect.width > 0 && rect.width <= 16) || (rect.height > 0 && rect.height <= 16)) return true;
    } catch {}
  }

  return false;
}

function isInformativeImage(img, win) {
  if (isClearlyDecorative(img, win)) return false;

  let w = img.naturalWidth || img.width || 0;
  let h = img.naturalHeight || img.height || 0;

  if (img.isConnected && win) {
    try {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0) w = Math.max(w, rect.width);
      if (rect.height > 0) h = Math.max(h, rect.height);
    } catch {}
  }

  return w > 48 && h > 48;
}

function getTitleFromElement(el) {
  const direct = (el.getAttribute('title') || '').trim();
  if (direct) return direct;
  const child = el.querySelector('[title]');
  if (child) {
    const t = (child.getAttribute('title') || '').trim();
    if (t) return t;
  }
  return null;
}

function getSvgTitle(el) {
  const svg = el.tagName?.toLowerCase() === 'svg' ? el : el.querySelector('svg');
  if (svg) {
    const titleEl = svg.querySelector('title');
    if (titleEl) {
      const t = (titleEl.textContent || '').trim();
      if (t) return t;
    }
  }
  return null;
}

function getWordsFromIconClass(el) {
  // Check child icon elements first (i, span, svg, em)
  const iconChildren = el.querySelectorAll('i, span, svg, em');
  for (const node of iconChildren) {
    const cls = typeof node.className === 'string' ? node.className.toLowerCase() : '';
    if (!cls) continue;

    for (const [label, keywords] of Object.entries(ICON_PATTERNS)) {
      if (keywords.some((kw) => new RegExp(`(^|[-_ ])${kw}([-_ ]|$)`, 'i').test(cls))) {
        return label;
      }
    }

    const matches = cls.match(/\b(?:icon|fa|bi|glyph|feather|ti)[-_]([a-z0-9-_]+)\b/i);
    if (matches && matches[1]) {
      const rawWords = matches[1].replace(/[-_]+/g, ' ').trim();
      const filtered = rawWords.split(/\s+/).filter((w) => !/^(icon|fa|bi|glyph|sm|md|lg|xl|2x|3x|solid|regular|outline|btn|button|style|custom)$/i.test(w));
      if (filtered.length > 0) {
        return capitalize(filtered.join(' '));
      }
    }
  }

  // Check the element itself for explicit icon patterns
  const elCls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  if (elCls) {
    for (const [label, keywords] of Object.entries(ICON_PATTERNS)) {
      if (keywords.some((kw) => new RegExp(`(^|[-_ ])${kw}([-_ ]|$)`, 'i').test(elCls))) {
        return label;
      }
    }
    const matches = elCls.match(/\b(?:icon|fa|bi|feather)[-_]([a-z0-9-_]+)\b/i);
    if (matches && matches[1]) {
      const rawWords = matches[1].replace(/[-_]+/g, ' ').trim();
      const filtered = rawWords.split(/\s+/).filter((w) => !/^(icon|fa|bi|glyph|sm|md|lg|xl|2x|3x|solid|regular|outline|btn|button|style|custom)$/i.test(w));
      if (filtered.length > 0) {
        return capitalize(filtered.join(' '));
      }
    }
  }

  return null;
}

function getWordsFromImageFileName(el) {
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (!img) return null;
  const src = img.getAttribute('src') || '';
  if (!src || src.startsWith('data:')) return null;

  try {
    const pathname = src.split(/[?#]/)[0];
    const filename = pathname.split('/').filter(Boolean).pop();
    if (!filename) return null;
    const nameWithoutExt = filename.replace(/\.[a-zA-Z0-9]+$/, '');
    if (!nameWithoutExt || nameWithoutExt.length < 2) return null;

    if (/^(img|dsc|photo|picture|image|asset|upload|file)[-_]?[0-9]+$/i.test(nameWithoutExt)) return null;
    if (/^[0-9]+$/.test(nameWithoutExt)) return null;
    if (/^[a-f0-9]{16,}$/i.test(nameWithoutExt)) return null;

    const words = nameWithoutExt
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => !/^(icon|btn|button|img|image|pic|photo|asset|thumb|thumbnail|small|medium|large|banner|header)$/i.test(w));

    if (words.length > 0) {
      const text = words.join(' ').toLowerCase();
      if (text.length >= 2 && !/^(untitled|undefined|null|logo)$/i.test(text)) {
        return capitalize(text);
      }
    }
  } catch {}
  return null;
}

function getLinkPathPart(el) {
  if (el.tagName !== 'A' && el.getAttribute('role') !== 'link') return null;
  const href = el.getAttribute('href');
  if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return null;
  }

  try {
    const cleanHref = href.split(/[?#]/)[0];
    const parts = cleanHref.split('/').filter(Boolean);
    if (!parts.length) {
      const hash = (href.split('#')[1] || '').trim();
      if (hash && hash.length > 2) {
        const hashWords = hash.replace(/[-_]+/g, ' ').trim();
        if (hashWords && !/^(top|content|main)$/i.test(hashWords)) {
          return capitalize(hashWords);
        }
      }
      return null;
    }
    const lastPart = parts[parts.length - 1].replace(/\.[a-zA-Z0-9]+$/, '');
    if (!lastPart || /^(index|default|home|main|view|page)$/i.test(lastPart)) return null;

    const words = lastPart
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim();

    if (words.length >= 2) {
      return capitalize(words);
    }
  } catch {}
  return null;
}

function getNearbyLabel(el) {
  const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  if (isField) {
    if (el.name) {
      const rawName = el.name.trim();
      if (!/^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken)$/i.test(rawName)) {
        const words = rawName
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/[-_]+/g, ' ')
          .trim();
        if (words.length >= 2) {
          return capitalize(words);
        }
      }
    }

    const prev = el.previousElementSibling;
    if (prev && /^(label|span|p|div|b|strong)$/i.test(prev.tagName)) {
      const text = squash(prev.textContent).replace(/[:?]$/, '').trim();
      if (text && text.length >= 2 && text.length < 60 && !/\n/.test(text)) {
        return text;
      }
    }

    const next = el.nextElementSibling;
    if (next && /^(label|span|p|div|b|strong)$/i.test(next.tagName)) {
      const text = squash(next.textContent).replace(/[:?]$/, '').trim();
      if (text && text.length >= 2 && text.length < 60 && !/\n/.test(text)) {
        return text;
      }
    }

    if (el.previousSibling && el.previousSibling.nodeType === 3) {
      const text = squash(el.previousSibling.nodeValue).replace(/[:?]$/, '').trim();
      if (text && text.length >= 2 && text.length < 60 && !/\n/.test(text)) {
        return text;
      }
    }
  }

  if (el.tagName === 'IMG') {
    const figure = el.closest('figure');
    if (figure) {
      const caption = figure.querySelector('figcaption');
      if (caption) {
        const text = squash(caption.textContent);
        if (text && text.length < 100) return text;
      }
    }
  }

  return null;
}

function inferPageFirstName(el) {
  const title = getTitleFromElement(el);
  if (title) return title;

  const svgTitle = getSvgTitle(el);
  if (svgTitle) return svgTitle;

  const nearby = getNearbyLabel(el);
  if (nearby) return nearby;

  const iconWords = getWordsFromIconClass(el);
  if (iconWords) return iconWords;

  const fileWords = getWordsFromImageFileName(el);
  if (fileWords) return fileWords;

  const linkPath = getLinkPathPart(el);
  if (linkPath) return linkPath;

  return null;
}

function getControlContext(el) {
  const parts = [];
  if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
    parts.push('button');
  } else if (el.tagName === 'A' || el.getAttribute('role') === 'link') {
    parts.push('link');
    if (el.getAttribute('href')) parts.push(`destination "${el.getAttribute('href')}"`);
  } else if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
    const type = el.getAttribute('type') || el.tagName.toLowerCase();
    parts.push(`${type} field`);
    if (el.name) parts.push(`name "${el.name}"`);
    if (el.placeholder) parts.push(`placeholder "${el.placeholder}"`);
  }

  const container = el.closest('form, section, article, nav, header, footer, dialog, [role="region"], [role="dialog"], [role="form"]');
  if (container) {
    const heading = container.querySelector('h1, h2, h3, h4, h5, h6, legend, [role="heading"]');
    if (heading && heading.textContent) {
      parts.push(`in section "${squash(heading.textContent).slice(0, 60)}"`);
    } else if (container.tagName === 'FORM') {
      parts.push('in form');
    }
  }

  const parent = el.parentElement;
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
    const nearby = squash(clone.textContent).slice(0, 120);
    if (nearby) parts.push(`nearby text "${nearby}"`);
  }

  return parts.join(', ');
}

export default {
  async enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return false;

    const limit = typeof this.options.limit === 'number'
      ? this.options.limit
      : (typeof this.options.maxAiCalls === 'number' ? this.options.maxAiCalls : 10);

    const seen = new WeakSet();
    let aiCalls = 0;

    const isElementHidden = (el) => {
      if (!el || !el.isConnected) return true;
      if (el.closest('[hidden]')) return true;
      if (el.closest('[aria-hidden="true"]')) return true;
      if (s.page && typeof s.page.isVisible === 'function') {
        return !s.page.isVisible(el);
      }
      return false;
    };

    const processSingleElement = async (el) => {
      if (!el || el.nodeType !== 1 || seen.has(el) || !s.alive()) return;
      seen.add(el);

      if (el.tagName === 'IMG') {
        if (el.hasAttribute('alt')) return;
        if (s.page?.nameOf && s.page.nameOf(el)) return;

        if (isClearlyDecorative(el, win)) {
          s.setAttr(el, 'alt', '');
          return;
        }

        const pageName = inferPageFirstName(el);
        if (pageName) {
          s.setAttr(el, 'alt', pageName);
          return;
        }

        if (isElementHidden(el)) return;
        if (!isInformativeImage(el, win)) return;

        if (aiCalls < limit) {
          aiCalls++;
          let alt = null;
          try {
            alt = await s.ai.vision('describe', el, { purpose: 'alt' });
          } catch {
            alt = null;
          }
          if (s.alive() && alt && typeof alt === 'string' && alt.trim()) {
            s.setAttr(el, 'alt', alt.trim());
          }
        }
        return;
      }

      if (s.page?.nameOf && s.page.nameOf(el)) return;

      const pageName = inferPageFirstName(el);
      if (pageName) {
        s.setAttr(el, 'aria-label', pageName);
        return;
      }

      if (isElementHidden(el)) return;

      if (aiCalls < limit) {
        aiCalls++;
        const context = getControlContext(el);
        let label = null;
        try {
          label = await s.ai.text('label', context, { context: doc.title || '' });
        } catch {
          label = null;
        }
        if (s.alive() && label && typeof label === 'string' && label.trim()) {
          s.setAttr(el, 'aria-label', label.trim());
        }
      }
    };

    const root = doc.body || doc.documentElement;
    if (root) {
      const initialElements = [...root.querySelectorAll(SELECTOR)];
      for (const el of initialElements) {
        if (!s.alive()) break;
        await processSingleElement(el);
      }

      s.watch.added(
        root,
        async (el) => {
          if (!s.alive()) return;
          await processSingleElement(el);
        },
        { selector: SELECTOR }
      );
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
