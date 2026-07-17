---
name: reading-aid
description: Makes long text easier to read on content-heavy pages. Use for low-vision, dyslexic, or cognitively-fatigued readers on articles, news, docs, and blogs.
supportAreas: [vision, reading, cognitive]
siteRelevance: [news, education, reference]
---

# Reading Aid

Makes dense, long-form text comfortable to read: larger type, generous spacing, a reading guide, and fewer distractions around the main content.

## What it does
1. **visual-assist** — scales text to 130%, widens line height, strengthens focus indicators, and shows a horizontal reading guide that tracks the current line.
2. **focus-mode** — dims ads and side content and keeps a scroll-progress cue, so the reader stays with the article.

## When to use
Long-form reading — articles, documentation, blog posts. Skip on dashboards, web apps, or pages where layout carries meaning, since larger text can reflow controls.

## Notes
- Stacks safely with `dark-mode` for readers who also prefer a dark page.
- If the reader also needs simpler language, add the `simplify-text` adapter.

## Recipe
```json
{
  "adapters": [
    { "id": "visual-assist", "settings": { "fontScale": 130, "lineHeight": 1.8, "enhanceFocus": true, "readingGuide": true } },
    { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true, "showProgress": true } }
  ]
}
```
