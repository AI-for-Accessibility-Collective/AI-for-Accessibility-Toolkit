// Names for controls and images: gives buttons, links, form fields, and
// informative images an accessible name or alt text when they have none.
//
// Barrier: interactive elements without an accessible name (preventing screen
// reader users and voice control users from identifying or activating them)
// and informative images without alternative text.
//
// Suggested in onboarding for: vision (a suggestion only, never a gate).
// The person's settings it reads: none.
// What the person can adjust: nothing (on or off).
//
// Options:
//   limit: number of AI calls allowed per page (default 20).
//
// Decisions:
//   - Measures first with s.page.nameOf(): never renames any control or
//     image that already has an accessible name.
//   - Never describes decorative images: tiny/spacer images (<= 2px or
//     matching spacer patterns), images with role="presentation" or "none",
//     and images with alt="" are left alone or marked alt="" only when certain.
//   - Never queries AI for content the page hides (hidden attribute,
//     aria-hidden="true", display:none, visibility:hidden, or zero size).
//   - Gathers contextual hints (type, role, placeholder, id, name, class,
//     and surrounding text) to guide s.ai.text('label', ...).
//   - Uses s.ai.vision('describe', img, { purpose: 'alt' }) for informative images.
//   - Asks the AI once per element, up to the configured limit.
//   - Leaves elements unchanged when the AI returns null or unavailable.
//   - Undoes all changes on disable() through the session.
//
// What it cannot do:
//   - It cannot invent meaning for ambiguous controls where no context exists.
//   - It cannot describe images without visual content or when AI is unavailable.

const SELECTOR = [
  'img',
  'input[type="image"]',
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'a[href]',
  '[role="link"]',
  'area[href]',
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
  'textarea',
  'select',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
].join(', ');

function hasAccessibleName(el, page) {
  try {
    const name = page.nameOf(el);
    return typeof name === 'string' && name.trim().length > 0;
  } catch {
    return false;
  }
}

function isDecorativeImage(img) {
  const role = (img.getAttribute('role') || '').toLowerCase().trim();
  if (role === 'presentation' || role === 'none') return true;
  if (img.getAttribute('aria-hidden') === 'true') return true;

  const wAttr = img.getAttribute('width');
  const hAttr = img.getAttribute('height');
  if ((wAttr === '0' || wAttr === '1') && (hAttr === '0' || hAttr === '1')) return true;

  const rect = img.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0 && rect.width <= 2 && rect.height <= 2) return true;

  if (img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth <= 2 && img.naturalHeight <= 2) return true;

  const src = (img.getAttribute('src') || '').toLowerCase();
  if (/(spacer|blank|clear|pixel|dot|1x1|transparent|shim)\.(gif|png|webp|jpe?g)/i.test(src)) return true;
  if (src.includes('/spacer') || src.includes('/pixel.') || src.includes('cleardot')) return true;

  const cls = (typeof img.className === 'string' ? img.className : '').toLowerCase();
  if (/(spacer|tracking-pixel)/i.test(cls)) return true;

  return false;
}

function getControlContext(el) {
  const parts = [];
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase().trim();
  const type = (el.getAttribute('type') || '').toLowerCase().trim();

  let desc = tag;
  if (role) desc += ` role=${role}`;
  if (type) desc += ` type=${type}`;
  parts.push(`Control: ${desc}`);

  if (el.id) parts.push(`id: ${el.id}`);
  if (el.name) parts.push(`name: ${el.name}`);
  if (tag === 'a' && el.href) parts.push(`href: ${el.href}`);
  if (el.title) parts.push(`title: ${el.title}`);

  const cls = (typeof el.className === 'string' ? el.className : '').trim();
  if (cls) parts.push(`class: ${cls.slice(0, 100)}`);

  const icon = el.querySelector('svg, img, i, span');
  if (icon) {
    const iconCls = (typeof icon.className === 'string' ? icon.className : '').trim();
    if (iconCls) parts.push(`icon: ${iconCls.slice(0, 80)}`);
    const dataIcon = icon.getAttribute('data-icon') || icon.getAttribute('aria-roledescription');
    if (dataIcon) parts.push(`icon name: ${dataIcon}`);
  }

  const parent = el.parentElement;
  if (parent) {
    try {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, template, input, select, textarea').forEach((n) => n.remove());
      const nearby = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (nearby) parts.push(`nearby text: ${nearby.slice(0, 200)}`);
    } catch {
      // ignore
    }
  }

  return parts.join(', ');
}

export default {
  async enable(options = {}, toolkit) {
    if (this.running || (this.s && !this.s.ended)) return;
    this.running = true;

    try {
      const s = (this.s = toolkit.session());
      const page = toolkit.page;
      const doc = document;
      const limit = typeof options?.limit === 'number' && options.limit >= 0 ? options.limit : 20;

      const asked = new WeakSet();
      let aiCalls = 0;

      const elements = [...doc.querySelectorAll(SELECTOR)];
      const candidates = [];

      for (const el of elements) {
        if (!page.isVisible(el) || el.closest('[aria-hidden="true"]') || el.closest('[hidden]')) continue;
        if (page.isOurs(el)) continue;

        const tag = el.tagName;
        const isImg = tag === 'IMG' || (tag === 'INPUT' && el.type === 'image');

        if (isImg) {
          if (el.hasAttribute('alt')) continue;
          if (hasAccessibleName(el, page)) continue;
          candidates.push(el);
        } else {
          if (hasAccessibleName(el, page)) continue;
          candidates.push(el);
        }
      }

      if (candidates.length === 0) {
        this.s.end();
        return false;
      }

      async function process(el) {
        if (!el || el.nodeType !== 1 || !s.alive()) return;
        if (asked.has(el)) return;
        if (!page.isVisible(el) || el.closest('[aria-hidden="true"]') || el.closest('[hidden]')) return;
        if (page.isOurs(el)) return;

        const tag = el.tagName;
        const isImg = tag === 'IMG' || (tag === 'INPUT' && el.type === 'image');

        if (isImg) {
          if (el.hasAttribute('alt')) return;
          if (hasAccessibleName(el, page)) return;

          if (isDecorativeImage(el)) {
            s.setAttr(el, 'alt', '');
            return;
          }

          if (aiCalls >= limit) return;
          asked.add(el);
          aiCalls++;

          let desc = null;
          try {
            desc = await s.ai.vision('describe', el, { purpose: 'alt' });
          } catch {
            desc = null;
          }

          if (desc && typeof desc === 'string' && desc.trim() && s.alive()) {
            s.setAttr(el, 'alt', desc.trim());
          }
          return;
        }

        // Interactive control
        if (hasAccessibleName(el, page)) return;

        if (aiCalls >= limit) return;
        asked.add(el);
        aiCalls++;

        const context = getControlContext(el);
        let label = null;
        try {
          label = await s.ai.text('label', context);
        } catch {
          label = null;
        }

        if (label && typeof label === 'string' && label.trim() && s.alive()) {
          const clean = label.trim().replace(/^["'`]|["'`]$/g, '').trim();
          if (clean) {
            s.setAttr(el, 'aria-label', clean);
            for (const img of el.querySelectorAll('img')) {
              if (!img.hasAttribute('alt') && !img.hasAttribute('aria-label')) {
                s.setAttr(img, 'alt', '');
              }
            }
          }
        }
      }

      const imgCandidates = candidates.filter((el) => el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.type === 'image'));
      const controlCandidates = candidates.filter((el) => !(el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.type === 'image')));

      for (const img of imgCandidates) {
        if (!s.alive()) break;
        await process(img);
      }

      for (const ctrl of controlCandidates) {
        if (!s.alive()) break;
        await process(ctrl);
      }

      s.watch.added(doc.body, async (node) => {
        if (aiCalls >= limit || !s.alive()) return;
        const addedList = node.matches?.(SELECTOR) ? [node] : [];
        if (node.querySelectorAll) addedList.push(...node.querySelectorAll(SELECTOR));
        for (const el of addedList) {
          if (aiCalls >= limit || !s.alive()) break;
          await process(el);
        }
      });

      return true;
    } finally {
      this.running = false;
    }
  },

  disable() {
    this.s?.end();
  },
};
