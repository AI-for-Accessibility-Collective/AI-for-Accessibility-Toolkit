# Analyzers

Analyzers find accessibility issues on the page.

## Adding a new analyzer

1. Create a file in this folder (e.g., `my-analyzer.js`)
2. Export functions that return arrays of elements with issues
3. Import in `index.js`

## Example

```js
// src/analyzers/missing-landmarks.js

import { isVisible, wasProcessed } from '../utils/dom.js';

// Find pages without main landmark
export function findMissingMain() {
  const hasMain = document.querySelector('main, [role="main"]');
  if (hasMain) return [];
  
  // Return the body as the element to fix
  return [document.body];
}

// Find sections without headings
export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(section => {
      if (wasProcessed(section)) return false;
      if (!isVisible(section)) return false;
      
      // Check for heading inside
      const heading = section.querySelector('h1, h2, h3, h4, h5, h6');
      return !heading;
    });
}
```

Then in `index.js`:

```js
export * from './missing-landmarks.js';
```

## Available utilities

- `isVisible(el)` - Check if element is visible
- `wasProcessed(el)` - Check if already processed
- `hasAccessibleName(el)` - Check for aria-label, title, text
- `getAccessibleName(el)` - Get the accessible name

## Analyzer vs Axe-core

- Use **axe-core** for standard WCAG violations (it's comprehensive)
- Use **custom analyzers** for:
  - Issues axe doesn't catch
  - Custom business rules
  - Finding elements for AI enhancement (empty alt, complex text)
