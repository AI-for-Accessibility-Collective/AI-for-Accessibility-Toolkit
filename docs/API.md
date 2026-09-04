# API Reference

Technical reference for the AI for Accessibility Toolkit.

## AI Provider Interface

The catalog adapters reach the model through a provider abstraction (`tools/utils/ai.js`), decoupled from any concrete model or SDK. The host supplies the provider.

### Setting the Provider

```javascript
import { setAIProvider } from './tools/utils/ai.js';

setAIProvider({
  describeImage: async (dataUrl) => { /* returns string */ },
  describeVideo: async (frames, metadata) => { /* returns string */ },
  describeElement: async (dataUrl, elementType, context) => { /* returns string */ },
  simplifyText: async (text) => { /* returns string */ },
  summarizeText: async (text) => { /* returns string */ },
  translateText: async (text, targetLang) => { /* returns string */ },
  defineWord: async (word, context) => { /* returns string */ },
  extractChartData: async (imageDataUrl, context) => { /* returns { caption, headers, rows } */ },
  generateLabels: async (context) => { /* returns string */ },
  inferLabel: async (context) => { /* returns string */ },
  fixContrast: async (fg, bg) => { /* returns string hex color */ },
  improveLinkText: async (linkText, href, context) => { /* returns string */ },
  inferColumnHeader: async (sampleData) => { /* returns string */ },
  transcribeVideo: async (url) => { /* returns { type, text } */ },
  transcribeAudio: async (url) => { /* returns { type, text } */ },
  getYouTubeTranscript: async (videoId) => { /* returns string */ },
  announce: (message) => { /* screen reader announcement, optional */ },
});
```

Methods you don't provide degrade gracefully: required ones (`describeImage`, `simplifyText`, …) throw a clear error; optional ones (`fixContrast`, `improveLinkText`, `inferColumnHeader`, `translateText`, `defineWord`, `extractChartData`, `transcribe*`, `describeElement`) return `null` so adapters skip that enhancement.

### Provider Methods

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `describeImage` | `dataUrl: string` (base64 image) | `string` | Generate alt text for image |
| `describeVideo` | `frames: string[]`, `metadata?: { duration, title }` | `string` | Describe video from sampled frames |
| `describeElement` | `dataUrl`, `elementType` ('canvas'\|'svg'\|'chart'…), `context` | `string` | Type-specific rich description |
| `simplifyText` | `text: string` | `string` | Rewrite text at lower reading level |
| `summarizeText` | `text: string` | `string` | Summarize long content (2-3 sentences) |
| `translateText` | `text: string`, `targetLang: string` | `string` | Translate text into the target language |
| `defineWord` | `word: string`, `context: string` | `string` | Plain-language definition of a word in context |
| `extractChartData` | `imageDataUrl: string`, `context: string` | `{ caption, headers: string[], rows: string[][] }` | Read a chart image back as a data table (the `explore-a-chart` adapter) |
| `generateLabels` | `{ elementType, html, context }` | `string` | Generate accessible name for element |
| `inferLabel` | `{ elementType, html, context }` | `string` | Infer label for unlabeled form field |
| `fixContrast` | `fg: string`, `bg: string` | `string` | Return fixed color meeting WCAG AA |
| `improveLinkText` | `linkText`, `href`, `context` | `string` | Descriptive replacement for "click here" |
| `inferColumnHeader` | `sampleData: string[]` | `string` | Header name for a table column |
| `transcribeVideo` / `transcribeAudio` | `url: string` | `{ type, text }` | Transcript, audio description, or silence marker |
| `getYouTubeTranscript` | `videoId: string` | `string` | Fetch YouTube's own captions |

This table is the shape of each call. The contract a host implements from, meaning what each function is for, what a good result looks like, what to return when the model cannot answer, and which adapter consumes the result and how it is checked before it reaches the page, is in the doc comments in `tools/utils/ai.js`. The shared checks are in `tools/utils/ai-output.js`.

## Auditors

Auditors find accessibility issues. Located in `tools/auditors/`.

### Built-in Auditors

```javascript
import {
  findEmptyAltImages,
  findCanvasElements,
  findEmptyLinks,
  findUnlabeledInputs,
  findLowContrastText,
  runAxeAnalysis
} from './tools/auditors/index.js';
```

| Function | Returns | Description |
|----------|---------|-------------|
| `findImagesWithoutAlt()` | `HTMLImageElement[]` | Images with no alt attribute |
| `findEmptyAltImages()` | `HTMLImageElement[]` | Images with empty alt that look like content |
| `findBadAltImages()` | `HTMLImageElement[]` | Images with useless alt ("image", filename…) |
| `findCanvasElements()` | `HTMLCanvasElement[]` | Canvas without aria-label |
| `findSvgWithoutAlt()` | `SVGElement[]` | Content SVGs without accessible names |
| `findEmptyLinks()` | `HTMLAnchorElement[]` | Links with no accessible name |
| `findAmbiguousLinks()` | `HTMLAnchorElement[]` | "click here" / "read more" links |
| `findEmptyButtons()` | `HTMLButtonElement[]` | Buttons with no accessible name |
| `findUnlabeledInputs()` | `HTMLInputElement[]` | Form inputs without labels |
| `findUntitledIframes()` | `HTMLIFrameElement[]` | Iframes without titles |
| `findLowContrastText()` | `Element[]` | Text failing WCAG contrast |
| `findVideosWithoutCaptions()` | `HTMLVideoElement[]` | Videos lacking caption tracks |
| `pageMissingMainLandmark()` | `boolean` | Page has no main landmark |
| `auditLandmarks()` | `object` | Landmark coverage summary |
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
  generateVideoDescription,
  simplifyText,
  summarizeContent,
  fixLowContrast,
  improveAmbiguousLinks,   // "click here" → descriptive aria-label
  fixAllTables,            // headerless tables → column headers
  fixLandmarks             // add missing main/navigation landmarks
} from './tools/adapters/index.js';

// Generate alt text
await generateImageAlt(imgElement);

// Simplify text content
await simplifyText(paragraphElement);

// Improve ambiguous links found by the auditor (caps AI calls at 10/page)
import { findAmbiguousLinks } from './tools/auditors/index.js';
await improveAmbiguousLinks(findAmbiguousLinks());
```

### Visual Adapters

A sample — `tools/adapters/index.js` exports the full set (magnifier, reading
ruler, bionic reading, big targets, page outline, flash guard, and more). Run
`ai4a11y list tools` for the current list with descriptions.

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
  'color-contrast': fixLowContrast,
  'label': generateFormLabel
};
```

The main content script automatically routes violations to registered handlers.

## Profiles

Profiles configure tool combinations for specific needs. Profile **data** lives in `tools/profiles/settings.json` (single source of truth, read by every host); merge/apply **logic** lives in `tools/profiles/settings.js`.

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

## Skills

A **skill** is a `SKILL.md` playbook that **composes adapters** — it names which adapters to apply, with what settings, for a need and page. Adapters are the executable code; a skill is the recipe over them. The skill layer lives in the platform-agnostic core, `toolkit/core/`.

### SKILL.md format

```markdown
---
name: reading-aid
description: When to use it — what an agent matches on
supportAreas: [vision, reading, cognitive]
siteRelevance: [news, education, reference]
---

# Reading Aid
Plain-language instructions (what it does, when to use it).

## Recipe
```json
{
  "adapters": [
    { "id": "visual-assist", "settings": { "fontScale": 130, "readingGuide": true } },
    { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true } }
  ]
}
```
```

The frontmatter + body are **model-facing** (an agent reads them); the fenced JSON **recipe** is **machine-runnable** — it resolves deterministically to the same settings the adapter layer applies, so running a skill needs no LLM. A recipe can compose **adapters** (page-fixing settings, above) and **actions** (plain-language tasks the browser agent runs: `"actions": [{ "name": "...", "prompt": "..." }]`) — the latter is how a reusable task saved from the Assistant becomes a skill. Built-in skills ship in `toolkit/skills/builtin/`.

### Skill functions (`toolkit/core/skill.js`)

```javascript
import { parseSkill, validateSkill, resolveSkill, matchSkill, matchSkillToNeed } from './toolkit/core/skill.js';

const skill = parseSkill(markdown);              // → { name, description, supportAreas, siteRelevance, recipe, body }
validateSkill(skill, { tools });                 // → { valid, errors[] } (checks adapter ids + setting keys vs the registry)
resolveSkill(skill);                             // → { settings: {...}, adapterIds: [...], actions: [...] } — the apply-plan
matchSkill(skill, { supportAreas, category });   // → score, for page-based retrieval
matchSkillToNeed(skill, need);                   // → score, for "does this need already have a skill?"
```

### The Engineer (`toolkit/core/skill-builder.js`)

```javascript
import { buildSkill } from './toolkit/core/skill-builder.js';

// Prompts the injected LLM to author a skill grounded in the real adapter catalog.
const { skill, valid, errors } = await buildSkill(need, { llm, tools, taxonomy, profile });

// Evaluation loop: the person rejected an attempt — pass it back with their feedback.
await buildSkill(need, { llm, tools, taxonomy, profile, previous: skill, feedback: 'text still too small' });
```

### Librarian skill API (`toolkit/core/librarian.js`)

| Method | Returns | Description |
|--------|---------|-------------|
| `listSkills()` | `Skill[]` | Built-in + the user's own (`source: 'builtin'\|'mine'`) |
| `findSkillForNeed(need)` | `Skill\|null` | Existing skill covering a plain-language need (the reuse check before building) |
| `retrieveSkill(url, contexts?)` | `Skill\|null` | Best fit for the page + this person |
| `resolveSkill(skill)` | `{ settings, adapterIds, actions }` | Compile to the apply-plan |
| `buildSkill(need, opts?)` | `{ skill, valid, errors }` | Run the Engineer (does not save); `opts.previous` + `opts.feedback` revise a rejected attempt |
| `saveSkill(skill)` | `{ saved, errors }` | Persist a user-validated skill (records its supportAreas + siteRelevance in memory) |
| `deleteSkill(name)` | `boolean` | Remove one of the user's skills |

When embedding, these are called directly on the Librarian; over HTTP they map to `/v1/librarian/{method}` routes. A resolved plan's `actions` run through the host's actuation port. Run `node toolkit/hosts/skill-demo/demo.js` to see the whole flow.

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

2. Implement it in the host's provider (bridging to whatever LLM the host uses)

3. Register it via `setAIProvider()` where the host wires up the toolkit

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.
