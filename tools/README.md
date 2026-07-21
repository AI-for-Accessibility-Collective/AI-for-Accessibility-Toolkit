# tools/

Shared JavaScript modules used by both the Chrome extension and CLI.

## Structure

```
tools/
├── auditors/       # Find accessibility issues
│   ├── index.js
│   ├── missing-alt.js
│   ├── missing-captions.js
│   ├── missing-labels.js
│   ├── missing-landmarks.js
│   ├── poor-contrast.js
│   └── wcag-issues.js    # axe-core wrapper
├── adapters/       # Fix issues or apply visual presets
│   ├── index.js
│   ├── _primitives.js   # Shared building blocks (text-node transform, style injection, DOM observers)
│   ├── generate-alt.js
│   ├── generate-labels.js
│   ├── fix-contrast.js
│   ├── fix-landmarks.js
│   ├── fix-links.js
│   ├── fix-tables.js
│   ├── visual-assist.js
│   ├── dark-mode.js
│   ├── reader-mode.js
│   └── ...
├── profiles/       # User presets (blind, lowVision, etc.)
│   └── settings.json
├── insights/       # Model-facing knowledge modules distilled from applications
│   └── artinsight/ # e.g. ArtInsight — accessible artwork descriptions
├── utils/          # Shared utilities
│   ├── ai.js       # AI provider abstraction
│   ├── dom.js      # DOM manipulation helpers
│   ├── color.js    # Color parsing and contrast
│   └── image.js    # Image capture utilities
├── constants.js    # Shared constants
└── index.js        # Re-exports all modules
```

## AI Provider Abstraction

`tools/utils/ai.js` provides a unified interface for AI operations that works across contexts:

- **Extension:** Routes through `chrome.runtime.sendMessage` to background.js → Gemini API
- **CLI:** Routes through `page.expose_function` to Claude

```javascript
import { setAIProvider, describeImage, simplifyText } from './utils/ai.js';

// Provider is set by the host (extension/CLI)
// Then all tools can use the same API:
const alt = await describeImage(dataUrl);
const simple = await simplifyText(complexText);
```

## Adding Tools

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details on adding auditors, adapters, and profiles.
