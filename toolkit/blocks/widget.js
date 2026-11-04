// Part of block 4, page: what a composite widget (a carousel, a set of tabs,
// a player) says about itself, its parts and its own controls. Read-only.
//
//   page.widgetParts(widget)              its slides or tab panels, as the page marks them
//   page.ownControls(widget, { parts })   the buttons that work the widget, not its content
//
// From roles and relationships only (aria-roledescription="slide",
// role="tabpanel", aria-controls, where a control sits in the tree), never
// from names, classes or words: a "Play trailer" button inside a slide is
// the slide's, whatever it says.

import { isOurs } from './shared.js';

// A part of a widget, as ARIA marks one: a carousel's slide (APG: a group
// with aria-roledescription "slide") or a tab panel.
const PART = '[aria-roledescription="slide" i], [role="tabpanel" i]';
const CONTROL = 'button, [role="button" i], [role="tab" i], [role="switch" i], input[type="button" i], input[type="submit" i], input[type="reset" i], input[type="image" i]';

/** The widget's parts as the page marks them, outermost only (a slide
 *  inside a slide is the inner widget's). [] when the page does not say. */
export function widgetParts(widget) {
  if (!widget || widget.nodeType !== 1) return [];
  const all = [...widget.querySelectorAll(PART)].filter((el) => !isOurs(el));
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

/** The elements a control names in aria-controls that exist. */
function controlled(el) {
  const doc = el.ownerDocument;
  return (el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean)
    .map((id) => doc.getElementById(id)).filter(Boolean);
}

/**
 * The widget's own controls: the buttons inside it that work the widget
 * itself (rotate, pause, pick a slide), not those of what it shows.
 * A control that names what it controls (aria-controls) is the widget's when
 * it controls the widget, an element around it, one of its parts, or an
 * element holding its parts; one that controls anything else (a video, a
 * part's own content) is not. A control that does not say is the widget's
 * when it is not inside one of the parts.
 * @param {Element} widget
 * @param {{parts?: Element[], selector?: string}} [opts]  parts: the widget's
 *   parts when the caller knows them another way; by default widgetParts().
 */
export function ownControls(widget, { parts, selector = CONTROL } = {}) {
  if (!widget || widget.nodeType !== 1) return [];
  const ps = Array.isArray(parts) ? parts.filter((p) => p && p.nodeType === 1) : widgetParts(widget);
  const inPart = (el) => ps.some((p) => p.contains(el));
  const forWidget = (t) => t === widget || t.contains(widget) || ps.includes(t) || ps.some((p) => t.contains(p) && widget.contains(t));
  const out = [];
  for (const el of widget.querySelectorAll(selector)) {
    if (isOurs(el)) continue;
    const targets = controlled(el);
    if (targets.length ? targets.some(forWidget) : !inPart(el)) out.push(el);
  }
  return out;
}
