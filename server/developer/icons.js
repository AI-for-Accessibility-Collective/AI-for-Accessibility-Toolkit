// The console's icons: symbols in icons.svg (Font Awesome Free, see there),
// drawn with <use>. Decorative: the text or aria-label beside one says what it means.

const SVG = 'http://www.w3.org/2000/svg';

/** @param {'profiles'|'memory'|'adapters'|'apps'|'listings'|'account'|'external'|'remove'|'smaller'|'larger'} name */
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `/developer/icons.svg#${name}`);
  svg.append(use);
  return svg;
}
