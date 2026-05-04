# Contributing

Most contributions are adding new auditors, adapters, or profiles.

## Cheat Sheet

| I want to... | Do this |
|--------------|---------|
| **Find an issue** | Add auditor → `tools/auditors/` → export from `index.js` |
| **Fix an issue** | Add adapter → `tools/adapters/` → add to `axeHandlers` in `index.js` |
| **Add a profile** | Edit `tools/profiles/settings.json` |
| **Add AI feature** | `tools/utils/ai.js` + `extension/background.js` + `cli/ai4a11y.py` |
| **Test changes** | `npm run build` → load in Chrome → test on real sites |

## Quick Start

```bash
git clone https://github.com/chuanenlin/AI-for-Accessibility-Toolkit-Draft.git
cd AI-for-Accessibility-Toolkit-Draft && npm install && pip install -e .

ai4a11y create my-adapter --type adapter   # Scaffold
npm run build                               # Build
# Chrome: chrome://extensions → Load unpacked → extension/
```

## Adding an Auditor

Auditors find accessibility issues. Use **axe-core** for standard WCAG; custom auditors for issues axe misses.

```bash
ai4a11y create missing-landmarks --type auditor
```

```js
// tools/auditors/missing-landmarks.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then add to `tools/auditors/index.js`: `export * from './missing-landmarks.js';`

## Adding an Adapter

Adapters fix issues. They can handle specific [axe rule IDs](https://dequeuniversity.com/rules/axe/).

```bash
ai4a11y create fix-tables --type adapter --profiles blind
```

```js
// tools/adapters/fix-tables.js
import { markProcessed } from '../utils/dom.js';

export const name = 'fix-tables';
export const profiles = ['blind'];

export function fixTableHeaders(table) {
  if (table.dataset.ai4a11yProcessed) return;
  markProcessed(table, 'pending');
  // ... fix logic ...
  markProcessed(table, 'done');
}

export const axeHandlers = { 'td-has-header': fixTableHeaders };
```

Then in `tools/adapters/index.js`, import and spread into `axeHandlers`:

```js
import { axeHandlers as tableHandlers } from './fix-tables.js';
// In the axeHandlers export, add: ...tableHandlers,
```

## Adding a Profile

Edit `tools/profiles/settings.json`:

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

**Available tools:** `fontScale`, `lineHeight`, `letterSpacing`, `largeCursor`, `enhanceFocus`, `dyslexiaFont`, `darkMode`, `motionReducer`, `colorFilter`, `autoDescribe`, `autoFixLabels`, `autoSimplify`, `autoCaptions`, `focusMode`, `readerMode`, `keyboardNav`

## Adding an AI Tool

AI tools need implementations in three places:

1. **`tools/utils/ai.js`** — provider-agnostic interface
2. **`extension/background.js`** — Gemini handler (add to `handlers` object)
3. **`cli/ai4a11y.py`** — Claude handler (via `page.expose_function`)

## Testing

```bash
npm run build                                   # Build extension
ai4a11y session start                           # Launch test browser
ai4a11y session go https://example.com
ai4a11y session audit                           # Run accessibility audit
ai4a11y session describe                        # AI describes the page
ai4a11y session stop
```

Load extension in Chrome and test on real sites.

## PR Guidelines

- One feature per PR
- Test on real sites
- `npm run build` must pass
- Describe who benefits (which disability/profile)

## Code Style

- ES modules in `tools/`, bundled by esbuild
- Use the AI provider abstraction (`tools/utils/ai.js`) for AI features
- Document which profiles/disabilities the feature helps
- No large binaries — use Git LFS or link externally

## Ethics

- People with disabilities must be involved in design and evaluation
- Compensate participants
- Handle user profiles and personalization data carefully
- Don't simulate ability profiles without community input

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
