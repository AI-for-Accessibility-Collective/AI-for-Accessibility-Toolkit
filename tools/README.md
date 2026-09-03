# tools/

The developer **catalog**: browser-native accessibility building blocks — auditors, adapters, profiles, and utils — that any host can draw from, on their own or alongside the `toolkit/` personalization core.

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

`tools/utils/ai.js` provides a unified interface for AI operations, decoupled from any concrete model or SDK. The **host** supplies a provider (bridging to whatever LLM it uses — e.g. a browser extension routing through its background worker to Gemini, or a server calling an API directly); the adapters call the same abstraction regardless.

```javascript
import { setAIProvider, describeImage, simplifyText } from './utils/ai.js';

// The host sets the provider once…
// …then all tools use the same API:
const alt = await describeImage(dataUrl);
const simple = await simplifyText(complexText);
```

## Adding Tools

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details on adding auditors, adapters, and profiles.
