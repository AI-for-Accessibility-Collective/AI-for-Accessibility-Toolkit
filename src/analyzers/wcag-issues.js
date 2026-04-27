// Run axe-core and return violations
export async function runAxeAnalysis() {
  if (typeof axe === 'undefined') {
    console.warn('[AI4A11y] axe-core not loaded');
    return [];
  }

  try {
    const results = await axe.run();
    console.log(`[AI4A11y] axe-core found ${results.violations.length} violation types`);
    return results.violations;
  } catch (e) {
    console.warn('[AI4A11y] axe-core failed:', e);
    return [];
  }
}

// Group violations by category
export function groupViolationsByCategory(violations) {
  const groups = {
    images: [],
    labels: [],
    contrast: [],
    aria: [],
    forms: [],
    structure: [],
    media: [],
    other: []
  };

  const categoryMap = {
    'image-alt': 'images',
    'input-image-alt': 'images',
    'role-img-alt': 'images',
    'svg-img-alt': 'images',
    'object-alt': 'images',
    'area-alt': 'images',

    'link-name': 'labels',
    'button-name': 'labels',
    'aria-command-name': 'labels',
    'frame-title': 'labels',
    'empty-heading': 'labels',
    'empty-table-header': 'labels',

    'color-contrast': 'contrast',
    'color-contrast-enhanced': 'contrast',
    'link-in-text-block': 'contrast',

    'label': 'forms',
    'select-name': 'forms',
    'input-button-name': 'forms',
    'autocomplete-valid': 'forms',

    'video-caption': 'media',
    'audio-caption': 'media',
    'no-autoplay-audio': 'media',

    'duplicate-id': 'structure',
    'duplicate-id-aria': 'structure',
    'duplicate-id-active': 'structure',
    'heading-order': 'structure',
    'landmark-one-main': 'structure',
    'bypass': 'structure',
    'page-has-heading-one': 'structure',

    'aria-valid-attr': 'aria',
    'aria-valid-attr-value': 'aria',
    'aria-allowed-attr': 'aria',
    'aria-required-attr': 'aria',
    'aria-roles': 'aria',
    'aria-hidden-focus': 'aria'
  };

  for (const violation of violations) {
    const category = categoryMap[violation.id] || 'other';
    groups[category].push(violation);
  }

  return groups;
}

// Get element from axe node
export function getElementFromNode(node) {
  if (!node?.target?.[0]) return null;
  return document.querySelector(node.target[0]);
}
