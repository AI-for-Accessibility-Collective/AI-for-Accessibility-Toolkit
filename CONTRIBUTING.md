# Contributing

The extension is designed to be easy to extend. Most contributions are adding new analyzers, adapters, or profiles.

## Quick Start

```bash
git clone https://github.com/chuanenlin/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit
npm install

npx ai4a11y tools                              # See what exists
npx ai4a11y create my-analyzer --type analyzer # Create component
npx ai4a11y build                              # Build
# Load in Chrome: chrome://extensions → Load unpacked → select this folder

git checkout -b add/my-analyzer
git add .
git commit -m "Add my-analyzer"
git push
```

## What to Contribute

| Type | Purpose | When to use |
|------|---------|-------------|
| **Analyzer** | Find issues | Detect accessibility problems axe-core misses |
| **Adapter** | Fix issues | Auto-fix detected issues, optionally with AI |
| **Profile** | User preset | Configure tools for a specific disability |
| **AI Tool** | Backend capability | Add new AI-powered features |

## Adding an Analyzer

Analyzers find accessibility issues on the page.

```bash
npx ai4a11y create missing-landmarks --type analyzer
```

Edit `src/analyzers/missing-landmarks.js`:

```js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findMissingMain() {
  if (document.querySelector('main, [role="main"]')) return [];
  return [document.body];
}

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(section => {
      if (wasProcessed(section)) return false;
      if (!isVisible(section)) return false;
      return !section.querySelector('h1, h2, h3, h4, h5, h6');
    });
}
```

Add to `src/analyzers/index.js`:
```js
export * from './missing-landmarks.js';
```

**When to use custom analyzers vs axe-core:**
- Use **axe-core** for standard WCAG violations (already comprehensive)
- Use **custom analyzers** for issues axe misses, custom rules, or finding elements for AI enhancement

## Adding an Adapter

Adapters fix issues. Map axe rule IDs to fix functions.

```bash
npx ai4a11y create fix-tables --type adapter
```

Edit `src/adapters/fix-tables.js`:

```js
import { markProcessed } from '../utils/dom.js';
import { logFix, incrementStat } from '../stats.js';

export function fixTableHeaders(table) {
  if (table.dataset.ai4a11yProcessed) return;
  markProcessed(table, 'pending');

  const firstRow = table.querySelector('tr');
  firstRow?.querySelectorAll('td').forEach(td => {
    const th = document.createElement('th');
    th.innerHTML = td.innerHTML;
    th.scope = 'col';
    td.replaceWith(th);
  });

  markProcessed(table, 'done');
  incrementStat('wcag');
  logFix('table-headers', table, '(none)', '(added)');
}

export const axeHandlers = {
  'td-has-header': fixTableHeaders
};
```

Add to `src/adapters/index.js`:
```js
import { axeHandlers as tableHandlers } from './fix-tables.js';

export const axeHandlers = {
  ...existingHandlers,
  ...tableHandlers
};
```

**Rule IDs:** https://dequeuniversity.com/rules/axe/

## Adding a Profile

Profiles configure which tools are enabled for a specific user need.

```bash
npx ai4a11y create elderly --type profile
```

Edit the generated entry in `src/settings.js`:

```js
elderly: {
  name: 'Elderly',
  description: 'Large text, high contrast, simplified UI',
  tools: {
    fontScale: 130,
    lineHeight: 1.8,
    largeCursor: true,
    enhanceFocus: true,
    fixContrast: true,
    autoSimplify: true
  }
}
```

**Available tools:**
- `fontScale`, `lineHeight`, `letterSpacing` — text sizing
- `largeCursor`, `enhanceFocus`, `dyslexiaFont` — visual aids
- `darkMode`, `motionReducer`, `colorFilter` — display modes
- `autoDescribe`, `autoFixLabels`, `autoSimplify`, `autoCaptions` — AI features
- `focusMode`, `readerMode`, `keyboardNav` — navigation

## Adding an AI Tool

1. Add handler in `background.js`:

```js
case 'myTool':
  const result = await callGeminiAPI(request.data);
  sendResponse({ success: true, result });
  break;
```

2. Call from adapter:

```js
const response = await sendMessage({ type: 'myTool', data: {...} });
```

## Testing

```bash
npx ai4a11y build
npx ai4a11y check https://example.com
```

Load in Chrome and test on real sites.

## PR Guidelines

- One feature per PR
- Test on real sites
- `npx ai4a11y build` must pass
- Describe who benefits (which disability/profile)

## Code Style

- ES modules in `src/`, bundled by esbuild
- Document which profiles/disabilities the feature helps
- No large binaries — use Git LFS or link externally

## Ethics

- People with disabilities must be involved in design and evaluation
- Compensate participants
- Handle user profiles and personalization data carefully
- Don't simulate ability profiles without community input

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
