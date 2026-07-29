// Parse color string to RGB values
export function parseColor(color) {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return null;
  }

  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  }

  // Handle hex colors (#fff or #ffffff)
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  return null;
}

// Calculate relative luminance (WCAG formula)
export function getLuminance(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Calculate contrast ratio between two colors (returns null if colors unparseable)
export function getContrastRatio(color1, color2) {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Check if contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large)
export function meetsContrastAA(foreground, background, isLarge = false) {
  const ratio = getContrastRatio(foreground, background);
  if (ratio === null) return false;
  return ratio >= (isLarge ? 3 : 4.5);
}

// Convert RGB to hex
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

// Parse a color to { r, g, b, a } (alpha 0–1), including rgba()/hex. Returns
// null for unparseable or fully-transparent colors.
function parseRgba(color) {
  if (!color) return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  const rgb = parseColor(color);
  return rgb ? { ...rgb, a: 1 } : null;
}

// Get effective background color (walks up the DOM tree). Semi-transparent
// backgrounds are ALPHA-COMPOSITED onto what's behind them, so contrast math
// sees the actual rendered color — e.g. text over rgba(255,255,255,0.5) on a
// dark page resolves to a mid-gray, not pure white (which used to make the
// fixer pick black text that still failed WCAG against the real background).
export function getEffectiveBackground(element) {
  const layers = []; // element-first (topmost) → ancestor (bottom)
  let el = element;
  while (el) {
    const parsed = parseRgba(getComputedStyle(el).backgroundColor);
    if (parsed && parsed.a > 0) {
      layers.push(parsed);
      if (parsed.a >= 1) break; // opaque — nothing below shows through
    }
    if (el === document.documentElement) break;
    el = el.parentElement;
  }
  // Composite from the deepest layer up to the element over an opaque white
  // base (the page default), using the "source-over" operator.
  let base = { r: 255, g: 255, b: 255 };
  for (let i = layers.length - 1; i >= 0; i--) {
    const top = layers[i];
    base = {
      r: Math.round(top.r * top.a + base.r * (1 - top.a)),
      g: Math.round(top.g * top.a + base.g * (1 - top.a)),
      b: Math.round(top.b * top.a + base.b * (1 - top.a)),
    };
  }
  return `rgb(${base.r}, ${base.g}, ${base.b})`;
}
