// Part of block 4, page: the landmarks the browser gives the page. Read-only.
//
//   page.landmark(el)                 its landmark role ('banner', 'main', ...), or null
//   page.landmarks(role, { root })    the elements the browser exposes with that role
//
// As HTML-AAM maps them, the way Chrome computes it: an explicit role (its
// first valid token; none or presentation is ignored on an element with a
// global ARIA attribute or a tabindex), else the element's own. A header or
// footer inside article, aside, main, nav or section (with no role of its own)
// or an element with role article, complementary, main or navigation is not
// a banner or contentinfo (Chrome does not scope by role region);
// an aside inside article, aside, nav or section (or role article,
// complementary or navigation) is complementary only with a name; a section
// or form, or role region or form, is a landmark only with a name (aria-label,
// title, or aria-labelledby naming an element), else its own role stands. Hidden
// elements (hidden, aria-hidden, display none, visibility hidden) are none.
// Decided from elements, roles and the tree, never from names or classes.

import { isOurs } from './shared.js';

export const LANDMARK_ROLES = ['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search'];
const LANDMARK = new Set(LANDMARK_ROLES);
const NEEDS_NAME = new Set(['form', 'region']);

// The ARIA 1.2 roles, so that an unknown token is passed over as the browser does.
const ROLES = new Set(('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader '
  + 'combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid '
  + 'gridcell group heading img image insertion link list listbox listitem log main mark marquee math menu menubar menuitem '
  + 'menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup '
  + 'region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript '
  + 'superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem').split(' '));
const GLOBAL_ARIA = ['aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-details',
  'aria-dropeffect', 'aria-errormessage', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-invalid',
  'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant', 'aria-roledescription'];

// Where a header or footer is scoped, and where an aside needs a name.
const HEADER_SCOPE_TAGS = new Set(['article', 'aside', 'main', 'nav', 'section']);
const HEADER_SCOPE_ROLES = new Set(['article', 'complementary', 'main', 'navigation']);
const ASIDE_SCOPE_TAGS = new Set(['article', 'aside', 'nav', 'section']);
const ASIDE_SCOPE_ROLES = new Set(['article', 'complementary', 'navigation']);

const CANDIDATES = 'header, footer, main, nav, aside, section, form, search, [role]';

/** The first role token the browser knows, lower-cased, or ''. */
function explicitRole(el) {
  const tokens = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/);
  const role = tokens.find((t) => ROLES.has(t) || /^(doc|graphics)-[a-z]+$/.test(t)) || '';
  if (role !== 'none' && role !== 'presentation') return role;
  // A presentational role conflicts with a global ARIA attribute or focus: then it is ignored.
  if (el.hasAttribute('tabindex') || GLOBAL_ARIA.some((a) => el.hasAttribute(a))) return '';
  return role;
}

function hasName(el) {
  const doc = el.ownerDocument;
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (ids.some((id) => doc.getElementById(id))) return true;
  return Boolean((el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim());
}

function hidden(el) {
  if (el.closest('[hidden], [aria-hidden="true" i]')) return true;
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  if (win.getComputedStyle(el).visibility === 'hidden') return true;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (win.getComputedStyle(n).display === 'none') return true;
  }
  return false;
}

// Whether an ancestor is one of tags (with no role of its own) or has one of roles.
function inside(el, tags, roles) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const role = n.hasAttribute('role') ? explicitRole(n) : '';
    if (role ? roles.has(role) : tags.has(n.localName)) return true;
  }
  return false;
}

/** The landmark role the browser gives el, or null. */
export function landmark(el) {
  if (!el || el.nodeType !== 1 || isOurs(el) || hidden(el)) return null;
  const role = el.hasAttribute('role') ? explicitRole(el) : '';
  // A region or form with no name is not one: the element's own role stands.
  if (role && !(NEEDS_NAME.has(role) && !hasName(el))) return LANDMARK.has(role) ? role : null;
  switch (el.localName) {
    case 'header': return inside(el, HEADER_SCOPE_TAGS, HEADER_SCOPE_ROLES) ? null : 'banner';
    case 'footer': return inside(el, HEADER_SCOPE_TAGS, HEADER_SCOPE_ROLES) ? null : 'contentinfo';
    case 'main': return 'main';
    case 'nav': return 'navigation';
    case 'search': return 'search';
    case 'aside': return inside(el, ASIDE_SCOPE_TAGS, ASIDE_SCOPE_ROLES) && !hasName(el) ? null : 'complementary';
    case 'section': return hasName(el) ? 'region' : null;
    case 'form': return hasName(el) ? 'form' : null;
    default: return null;
  }
}

/** The elements under root (the document's body by default) the browser
 *  exposes with that landmark role, in document order; every landmark when
 *  role is omitted. Never the toolkit's own. */
export function landmarks(doc, role, { root } = {}) {
  const from = root || doc.body || doc.documentElement;
  if (!from) return [];
  const all = [from, ...from.querySelectorAll(CANDIDATES)];
  return all.filter((el) => el.matches(CANDIDATES) && (role ? landmark(el) === role : landmark(el) !== null));
}
