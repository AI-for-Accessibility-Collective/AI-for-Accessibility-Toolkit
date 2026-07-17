> Internal design document — describes a proposal/point-in-time snapshot, not necessarily current behavior. Notably: custom adapters now run as chrome.userScripts (USER_SCRIPT world), not new Function in the content script, and activeSkills is not part of the save flow.

# Skill Builder — Hand-off Document

## What this component does

The Skill Builder is a full-tab page where users create **custom accessibility skills** powered by Gemini AI. It is opened in two ways:

1. **From onboarding** — when the AI recommender identifies needs that no built-in skill covers, the onboarding flow redirects here with a `?pending=` query parameter containing a JSON array of proposed skills.
2. **From the popup** — via the "Add Skills" button, which sends an `openSkillBuilder` message to the background service worker.

## Entry point

`extension/skill-builder/builder.html` (must be a standalone HTML page — no bundler needed, runs as a Chrome extension page).

## Pending skills format (query parameter)

When opened from onboarding, the URL looks like:

```
chrome-extension://<id>/skill-builder/builder.html?pending=<encoded JSON>
```

Parse it with:

```javascript
const params = new URLSearchParams(location.search);
const pending = JSON.parse(decodeURIComponent(params.get('pending') || '[]'));
```

Each item in the array has this shape:

```typescript
interface PendingSkill {
  name: string;          // e.g. "Recipe Step Highlighter"
  description: string;   // what the skill should do
  supportAreas: string[]; // e.g. ["cognitive", "vision"]
}
```

## Background message API

All messages go through `chrome.runtime.sendMessage(msg, callback)`. The background service worker (`extension/background.js`) already handles these message types:

| Message type          | Payload                                    | Response                      | Purpose                                    |
|-----------------------|--------------------------------------------|-------------------------------|--------------------------------------------|
| `gemini`              | `{ prompt: string, apiKey?: string }`      | `{ result: string }` or `{ error }` | Call Gemini API with any prompt            |
| `saveCustomSkill`     | `{ skill: CustomSkill }`                   | `{ success: true }`          | Upsert a custom skill to chrome.storage    |
| `deleteCustomSkill`   | `{ skillId: string }`                      | `{ success: true }`          | Remove a custom skill                      |
| `getActiveSkills`     | `{}`                                       | `{ activeSkills: string[], customSkills: CustomSkill[] }` | Fetch all active + custom skills |
| `setActiveSkills`     | `{ skills: string[] }`                     | `{ success: true }`          | Replace the active built-in skill list     |
| `executeCustomSkill`  | `{ tabId: number, code: string }`          | `{ success: true }` or `{ error }` | Inject and run a custom skill on a tab  |
| `getApiKey`           | `{}`                                       | `{ apiKey: string }`         | Get stored Gemini API key                  |

## Custom skill data shape

When saving a custom skill via `saveCustomSkill`, use this structure:

```typescript
interface CustomSkill {
  id: string;            // unique ID, e.g. "custom-recipe-highlighter"
  name: string;          // display name
  description: string;   // what it does
  supportAreas: string[];
  code: string;          // the generated JavaScript content script code
  createdAt: string;     // ISO timestamp
  updatedAt: string;     // ISO timestamp
}
```

The `code` field contains a plain JavaScript string (no ES modules — it runs via `new Function(code)` in the content script context). It has access to the full DOM.

## Suggested UX flow

1. Show the list of pending skills (from query param) or an empty state with a "New Skill" button.
2. For each skill, show a card with name + description and a "Build" button.
3. On "Build": send a prompt to Gemini (via `gemini` message) asking it to generate a content script for the described skill. Suggested prompt structure:

```javascript
const prompt = `Generate a JavaScript content script that does the following:
${skill.description}

Requirements:
- The code runs in a webpage context via new Function(code), so it has access to document, window, etc.
- Do NOT use ES module syntax (no import/export).
- The code should be self-contained.
- Add/remove CSS by injecting <style> elements with a unique ID.
- Use a unique prefix like "agentic-a11y-custom-" for any IDs or classes.
- Return ONLY the JavaScript code, no markdown fences.`;
```

4. Display the generated code in a code editor (a `<textarea>` is fine, or use a lightweight library like CodeMirror).
5. Provide a "Test on current tab" button that sends `executeCustomSkill` to the background.
6. Let the user iterate — a chat-like input where they can say "make the highlight brighter" and the code is regenerated.
7. On "Save": send `saveCustomSkill` to persist it, then also add its ID to `activeSkills`.

## Files to create

- `extension/skill-builder/builder.html` — page shell, link to builder.css and builder.js
- `extension/skill-builder/builder.css` — styles (use the same design variables as onboarding for consistency, see `extension/onboarding/onboarding.css`)
- `extension/skill-builder/builder.js` — all logic (no bundler, runs as a Chrome extension page)

## Design system reference

Reuse the CSS variables from `extension/onboarding/onboarding.css`:

```css
--blue: #1a73e8;
--blue-hover: #1557b0;
--blue-light: #e8f0fe;
--green: #34a853;
--green-light: #e6f4ea;
--orange: #ea8600;
--orange-light: #fef7e0;
--grey-50: #f8f9fa;
--grey-100: #f1f3f4;
--grey-200: #e8eaed;
--grey-300: #dadce0;
--grey-500: #9aa0a6;
--grey-700: #5f6368;
--grey-900: #202124;
--radius: 12px;
```
