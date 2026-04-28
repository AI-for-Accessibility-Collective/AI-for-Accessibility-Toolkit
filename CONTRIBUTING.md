# Contributing

The toolkit is designed to be easy to extend. Most contributions are adding new auditors, adapters, or profiles.

## Quick Start

```bash
git clone https://github.com/chuanenlin/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit
npm install
pip install -e .

ai4a11y list tools                              # See what exists
ai4a11y create my-adapter --type adapter        # Create component
npm run build                                   # Build extension

# Load in Chrome: chrome://extensions → Load unpacked → select extension/ folder

git checkout -b add/my-adapter
git add .
git commit -m "Add my-adapter"
git push
```

## What to Contribute

| Type | Purpose | When to use |
|------|---------|-------------|
| **Auditor** | Find issues | Detect accessibility problems axe-core misses |
| **Adapter** | Fix issues | Auto-fix detected issues, optionally with AI |
| **Profile** | User preset | Configure tools for a specific disability |
| **AI Tool** | Backend capability | Add new AI-powered features |

## Project Structure

```
tools/                    # Shared JS code (used by both extension and CLI)
├── auditors/            # Find issues
├── adapters/            # Fix issues
├── profiles/            # User presets
└── utils/               # Shared utilities (ai.js, dom.js, color.js)

extension/               # Chrome extension
├── src/content.js      # Entry point (imports from tools/)
├── background.js       # Service worker (Gemini API)
└── popup.*             # Extension UI

cli/                     # Python CLI
├── ai4a11y.py          # Playwright + Claude vision
└── cli.py              # Command wrapper
```

## Adding an Auditor

Auditors find accessibility issues on the page.

```bash
ai4a11y create missing-landmarks --type auditor
```

Edit `tools/auditors/missing-landmarks.js`:

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

Add to `tools/auditors/index.js`:
```js
export * from './missing-landmarks.js';
```

**When to use custom auditors vs axe-core:**
- Use **axe-core** for standard WCAG violations (already comprehensive)
- Use **custom auditors** for issues axe misses, custom rules, or finding elements for AI enhancement

## Adding an Adapter

Adapters fix issues. They can handle specific axe rule IDs.

```bash
ai4a11y create fix-tables --type adapter --profiles blind
```

Edit `tools/adapters/fix-tables.js`:

```js
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

export const name = 'fix-tables';
export const description = 'Add headers to data tables';
export const profiles = ['blind'];

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

Add to `tools/adapters/index.js`:
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

Edit `tools/profiles/settings.json`:

```json
"elderly": {
  "name": "Elderly",
  "description": "Large text, high contrast, simplified UI",
  "tools": {
    "fontScale": 130,
    "lineHeight": 1.8,
    "largeCursor": true,
    "enhanceFocus": true,
    "fixContrast": true,
    "autoSimplify": true
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

AI tools use the provider abstraction so they work in both extension and CLI.

1. Add function in `tools/utils/ai.js`:

```js
export async function myTool(data) {
  if (!provider?.myTool) throw new Error('AI provider not set or missing myTool');
  return provider.myTool(data);
}
```

2. Add handler in `extension/background.js` (for Chrome/Gemini):

```js
case 'myTool':
  const result = await callGeminiAPI(request.data);
  sendResponse({ success: true, result });
  break;
```

3. Set provider in `extension/src/content.js`:

```js
setAIProvider({
  myTool: (data) => sendMessage({ type: 'myTool', data }).then(r => r?.result),
  // ... other methods
});
```

4. For CLI support, add to `cli/ai4a11y.py` via `page.expose_function`.

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
