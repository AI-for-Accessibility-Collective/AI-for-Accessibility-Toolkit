// Check if element is visible
export function isVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Accessible name of an element, in the order of the Accessible Name and
// Description Computation 1.2: aria-labelledby (step 2B), aria-label (2C),
// the name HTML gives the element itself (2D: alt on an image, value on an
// input button), name from content (2F), title (2I), and last the default
// name HTML-AAM gives a submit or reset input. Every auditor and adapter
// that asks "is this thing labeled?" goes through here, so SVGs, links,
// buttons, iframes and form controls all apply the same rule. This is a
// close reading of the spec, not a full implementation: it does not follow
// aria-labelledby chains, and it does not look up <label> elements for form
// controls (findUnlabeledInputs does that itself).
export function getAccessibleName(el) {
  return getLabelledByText(el)
    || (el.getAttribute('aria-label') || '').trim()
    || getNativeName(el)
    || getNameFromContent(el)
    || (el.getAttribute('title') || '').trim()
    || getDefaultName(el);
}

// Check if element has accessible name
export function hasAccessibleName(el) {
  return !!getAccessibleName(el);
}

// Text an element gets from aria-labelledby, or '' when it gets none. The
// attribute is a whitespace-separated id list and the name is the referenced
// elements' names joined in order (step 2B), so an id that points nowhere or
// at an element with no name adds nothing, and one id that resolves is
// enough. A referenced element is named the way the spec names it during the
// traversal: its own aria-label, its alt or button value, the value of a text
// control or the chosen option of a select (2E), else its content, else its
// title. It counts even when it is hidden, which is why there is no
// isVisible check here. A referenced element's own aria-labelledby is not
// followed (2B applies once), so an element that names itself, or two that
// name each other, resolve to their content and nothing loops.
// FLAG(review): before this helper, hasAccessibleName, getAccessibleName and
// the SVG auditor passed the raw attribute to getElementById and read only
// textContent, and findUnlabeledInputs accepted any aria-labelledby at all.
// Now an id list or a padded id resolves, a target named by alt, aria-label
// or value resolves, and a target that resolves to nothing is not a label.
// Each of those follows the ARIA rule; the first two mean fewer elements are
// reported and the last means more.
export function getLabelledByText(el) {
  const attr = el.getAttribute('aria-labelledby');
  if (!attr) return '';
  return attr.split(/\s+/)
    .map(id => {
      const target = document.getElementById(id);
      return target ? nameOfReferenced(target) : '';
    })
    .filter(Boolean)
    .join(' ');
}

// Name of an element reached through aria-labelledby (steps 2C to 2I of the
// traversal, without following a further aria-labelledby).
function nameOfReferenced(el) {
  return (el.getAttribute('aria-label') || '').trim()
    || getNativeName(el)
    || getEmbeddedValue(el)
    || getNameFromContent(el)
    || (el.getAttribute('title') || '').trim()
    || getDefaultName(el);
}

// The name HTML gives an element on its own (step 2D): alt for images, image
// maps and image buttons, value for submit, reset and button inputs.
export function getNativeName(el) {
  const tag = el.localName;
  if (tag === 'img' || tag === 'area') return (el.getAttribute('alt') || '').trim();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'image') return (el.getAttribute('alt') || '').trim();
    if (type === 'submit' || type === 'reset' || type === 'button') return (el.value || '').trim();
  }
  return '';
}

// The name a submit or reset input has when nothing else names it: HTML-AAM
// falls back to a localized "Submit" or "Reset" after the title, so a bare
// <input type="submit"> is announced and is not an unlabeled field. An image
// input without alt also gets "Submit Query" there, but that name says
// nothing about the image, so it is left out and the input stays reported.
// Limitation: the browser localizes that default, and this helper does not.
// It returns the two English words on every page. The auditors only ask
// whether a name exists, so they give the same answer in any language; a
// caller that shows the name to a person gets English.
function getDefaultName(el) {
  if (el.localName !== 'input') return '';
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'submit') return 'Submit';
  if (type === 'reset') return 'Reset';
  return '';
}

// What a form control contributes when something else's aria-labelledby
// points at it (step 2E): a text control gives its value, a select the text
// of its chosen option.
function getEmbeddedValue(el) {
  const tag = el.localName;
  if (tag === 'textarea') return (el.value || '').trim();
  if (tag === 'select') return Array.from(el.selectedOptions || []).map(o => o.textContent.trim()).join(' ').trim();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['submit', 'reset', 'button', 'image', 'hidden', 'checkbox', 'radio'].includes(type)) return (el.value || '').trim();
  }
  return '';
}

// Elements whose role does not take a name from its content: a select's
// options, a textarea's draft, an iframe's fallback text are not names.
const NO_NAME_FROM_CONTENT = new Set(['input', 'select', 'textarea', 'iframe']);

// Name from content (step 2F), which is what textContent stood in for
// before: text nodes count, an aria-hidden="true" descendant does not (2A),
// a descendant with its own aria-label contributes that (2C), and an <img>
// or <area> contributes its alt (2D). A descendant hidden with CSS alone is
// still read, as textContent read it; 2A would drop it too, and the check
// is not made here because it needs layout. The element itself is read even
// when it is aria-hidden, because a hidden element that aria-labelledby
// points at still names its referrer.
export function getNameFromContent(el) {
  if (NO_NAME_FROM_CONTENT.has(el.localName)) return '';
  const parts = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { parts.push(child.nodeValue); continue; }
      if (child.nodeType !== 1) continue;
      if (child.getAttribute('aria-hidden') === 'true') continue;
      const label = child.getAttribute('aria-label');
      if (label && label.trim()) { parts.push(label); continue; }
      if (child.localName === 'img' || child.localName === 'area') { parts.push(child.getAttribute('alt') || ''); continue; }
      walk(child);
    }
  };
  walk(el);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Does an element's class list actually name it as navigation? Guards against
// the naive `[class*="nav" i]` substring match, which also hits words like
// "unavailable" (u-nav-ailable). Matches nav / navbar / navigation as a token
// unit — including suffix forms like "topnav" and "main-nav" — but not "nav"
// buried mid-word.
export function looksLikeNavClass(el) {
  return Array.from(el.classList || []).some(c => /nav(bar|igation)?([-_]|$)/i.test(c));
}

// Mark element as processed by AI4A11y
export function markProcessed(el, status = 'done') {
  el.dataset.ai4a11yProcessed = status;
}

// Check if element was already processed
export function wasProcessed(el) {
  return !!el.dataset.ai4a11yProcessed;
}

// Clear all AI4A11y processing marks
export function clearAllMarks() {
  document.querySelectorAll('[data-ai4a11y-processed]').forEach(el => {
    delete el.dataset.ai4a11yProcessed;
  });
  document.querySelectorAll('[data-ai4a11y-described]').forEach(el => {
    delete el.dataset.ai4a11yDescribed;
  });
  document.querySelectorAll('[data-ai4a11y-simplified]').forEach(el => {
    delete el.dataset.ai4a11ySimplified;
  });
  document.querySelectorAll('[data-ai4a11y-summarize]').forEach(el => {
    delete el.dataset.ai4a11ySummarize;
  });
}

// Sleep utility
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Escape CSS selector
export function escapeSelector(str) {
  return CSS.escape(str);
}
