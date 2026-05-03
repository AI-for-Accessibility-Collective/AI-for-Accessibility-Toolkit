# API Reference

Technical reference for the AI for Accessibility Toolkit.

## AI Provider Interface

The toolkit uses a provider abstraction (`tools/utils/ai.js`) that works across extension and CLI contexts.

### Setting the Provider

```javascript
import { setAIProvider } from './tools/utils/ai.js';

setAIProvider({
  describeImage: async (dataUrl) => { /* returns string */ },
  describeVideo: async (frames) => { /* returns string */ },
  simplifyText: async (text) => { /* returns string */ },
  summarizeText: async (text) => { /* returns string */ },
  generateLabels: async (context) => { /* returns string */ },
  inferLabel: async (context) => { /* returns string */ },
  fixContrast: async (fg, bg) => { /* returns string hex color */ },
  generateCaptions: async (data) => { /* returns transcript string */ },
});
```

### Provider Methods

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `describeImage` | `dataUrl: string` (base64 image) | `string` | Generate alt text for image |
| `describeVideo` | `frames: string[]` | `string` | Describe video from sampled frames |
| `simplifyText` | `text: string` | `string` | Rewrite text at lower reading level |
| `summarizeText` | `text: string` | `string` | Summarize long content (2-3 sentences) |
| `generateLabels` | `{ elementType, html, context }` | `string` | Generate accessible name for element |
| `inferLabel` | `{ elementType, html, context }` | `string` | Infer label for unlabeled form field |
| `fixContrast` | `fg: string`, `bg: string` | `string` | Return fixed color meeting WCAG AA |
| `generateCaptions` | `{ audioUrl }` | `string` | Transcribe audio/video |

## Auditors

Auditors find accessibility issues. Located in `tools/auditors/`.

### Built-in Auditors

```javascript
import {
  findEmptyAltImages,
  findCanvasElements,
  findEmptyLinks,
  findUnlabeledInputs,
  findPoorContrast,
  runAxeAnalysis
} from './tools/auditors/index.js';
```

| Function | Returns | Description |
|----------|---------|-------------|
| `findImagesWithoutAlt()` | `HTMLImageElement[]` | Images with no alt attribute |
| `findEmptyAltImages()` | `HTMLImageElement[]` | Images with empty alt that look like content |
| `findCanvasElements()` | `HTMLCanvasElement[]` | Canvas without aria-label |
| `findEmptyLinks()` | `HTMLAnchorElement[]` | Links with no accessible name |
| `findUnlabeledInputs()` | `HTMLInputElement[]` | Form inputs without labels |
| `findPoorContrast()` | `Element[]` | Text failing WCAG contrast |
| `runAxeAnalysis()` | `Promise<Violation[]>` | Full axe-core audit |

### axe-core Integration

```javascript
const violations = await runAxeAnalysis();
// Returns array of { id, description, nodes[] }
```

## Adapters

Adapters fix issues or apply visual presets. Located in `tools/adapters/`.

### AI-Powered Adapters

```javascript
import {
  generateImageAlt,
  generateCanvasDescription,
  generateSvgDescription,
  simplifyText,
  summarizeContent,
  fixContrastForElement
} from './tools/adapters/index.js';

// Generate alt text
await generateImageAlt(imgElement);

// Simplify text content
await simplifyText(paragraphElement);
```

### Visual Adapters

```javascript
import {
  VisualAssist,
  DarkMode,
  MotionReducer,
  FocusMode,
  ReaderMode,
  ColorBlindMode,
  KeyboardNavigator,
  VoiceCommands,
  ReadAloud,
  AutoTranscriber
} from './tools/adapters/index.js';

// Enable with options
VisualAssist.enable({
  fontScale: 1.5,
  lineHeight: 1.8,
  largeCursor: true,
  enhanceFocus: true,
  dyslexiaFont: true
});

DarkMode.enable();
MotionReducer.enable();
FocusMode.enable({ hideDistractions: true, showProgress: true });
ColorBlindMode.enable('protanopia');  // or 'deuteranopia', 'tritanopia'

// Disable
VisualAssist.disable();
DarkMode.disable();
```

### axeHandlers Mapping

Adapters can register handlers for specific axe-core rule IDs:

```javascript
// In your adapter file
export const axeHandlers = {
  'image-alt': generateImageAlt,
  'color-contrast': fixContrastForElement,
  'label': generateLabelForInput
};
```

The main content script automatically routes violations to registered handlers.

## Profiles

Profiles configure tool combinations for specific needs. Located in `tools/profiles/`.

### Loading Profiles

```javascript
import { profiles, getProfile, loadSettings } from './tools/profiles/settings.js';

// Get all profiles
console.log(profiles);  // { blind: {...}, lowVision: {...}, ... }

// Get specific profile
const blindProfile = getProfile('blind');
// { name: 'Blind', tools: { autoDescribe: true, ... } }

// Load user settings (async, from storage)
const settings = await loadSettings(storageGetter);
```

### Profile Schema

```json
{
  "profileId": {
    "name": "Display Name",
    "description": "Who this helps",
    "tools": {
      "autoDescribe": true,
      "fontScale": 150,
      "darkMode": false
    }
  }
}
```

### Multi-Profile Merging

When multiple profiles are selected, tools merge:
- Booleans: OR (any profile enables → enabled)
- Numbers: MAX (largest value wins)

## CLI Commands

### Session Management

```bash
ai4a11y session start              # Launch browser
ai4a11y session stop               # Close browser
ai4a11y session go <url>           # Navigate
```

### Auditing

```bash
ai4a11y session audit              # Run accessibility audit
ai4a11y session audit --json       # JSON output
ai4a11y session describe           # AI describes the page
ai4a11y session describe --json    # JSON output
```

### Tools

```bash
ai4a11y session enable <tool> [options]
ai4a11y session disable <tool>
ai4a11y session tools              # List tool states
ai4a11y session profile <name>     # Apply profile
```

### Scaffolding

```bash
ai4a11y list tools                 # List all tools
ai4a11y list profiles              # List all profiles
ai4a11y create <name> --type <auditor|adapter>
```

## Message Protocol (Extension)

Content script ↔ Background communication:

```javascript
// Content script → Background
chrome.runtime.sendMessage({ type: 'describeImage', imageData: dataUrl }, response => {
  console.log(response.result);  // Alt text string
});

// Message types
'describeImage'      // { imageData } → { result: string }
'describeElement'    // { imageData, elementType, context } → { result: string }
'simplifyText'       // { text } → { result: string }
'summarizeText'      // { text } → { result: string }
'transcribeAudio'    // { audioUrl } → { result: { type, text } }
'inferLabel'         // { elementType, html, context } → { result: string }
'fixContrast'        // { foreground, background } → { result: string }
'getSettings'        // {} → { result: settings }
```

## DOM Utilities

```javascript
import { markProcessed, wasProcessed, isVisible, clearAllMarks } from './tools/utils/dom.js';

// Mark element as processed
markProcessed(element, 'done');  // or 'pending', 'failed'

// Check if already processed
if (wasProcessed(element)) return;

// Check visibility
if (!isVisible(element)) return;

// Reset all marks (for rescan)
clearAllMarks();
```

## Color Utilities

```javascript
import { parseColor, rgbToHex, getContrastRatio } from './tools/utils/color.js';

const rgb = parseColor('#ff0000');  // { r: 255, g: 0, b: 0 }
const hex = rgbToHex(255, 0, 0);    // '#ff0000'
const ratio = getContrastRatio(color1, color2);  // 4.5
```

## Image Utilities

```javascript
import { imageToDataUrl, captureVideoFrames } from './tools/utils/image.js';

// Convert image element to data URL
const dataUrl = await imageToDataUrl(imgElement);

// Capture frames from video
const frames = await captureVideoFrames(videoElement, 6);  // 6 frames
```

## Extending the Toolkit

### Adding an Auditor

```javascript
// tools/auditors/my-auditor.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findMyIssues() {
  return Array.from(document.querySelectorAll('.problematic'))
    .filter(el => isVisible(el) && !wasProcessed(el));
}
```

### Adding an Adapter

```javascript
// tools/adapters/my-adapter.js
import { markProcessed } from '../utils/dom.js';

export function fixMyIssue(element) {
  if (element.dataset.ai4a11yProcessed) return;
  markProcessed(element, 'pending');
  
  // Fix the issue
  element.setAttribute('aria-label', 'Fixed');
  
  markProcessed(element, 'done');
}

export const axeHandlers = {
  'my-rule-id': fixMyIssue
};
```

### Adding an AI Tool

1. Add to `tools/utils/ai.js`:
   ```javascript
   export async function myTool(data) {
     if (!provider?.myTool) throw new Error('AI provider not set');
     return provider.myTool(data);
   }
   ```

2. Add handler in `extension/background.js`

3. Register in content script's `setAIProvider()`

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.
