---
name: screen-reader-boost
description: Fills in the semantics screen readers rely on — image descriptions, form labels, WCAG fixes, and keyboard navigation. Use for blind and low-vision users on any site.
supportAreas: [vision, motor]
siteRelevance: [all]
---

# Screen Reader Boost

Makes a page announce correctly for screen-reader users by generating the descriptions, labels, and structure that are missing.

## What it does
1. **auto-alt-text** — generates alt text for images that have none, so they're announced instead of skipped.
2. **generate-labels** — names unlabeled buttons, links, and form fields.
3. **wcag-fixes** — repairs common structural violations (landmarks, headings, tabindex, language).
4. **keyboard-nav** — adds skip links and a clear tab order for non-pointer navigation.

## When to use
Any site, for anyone navigating by screen reader or keyboard. Visual settings are intentionally omitted — they don't help a screen-reader user.

## Notes
- The description and label steps call the AI provider; the WCAG and keyboard steps are deterministic and run offline.

## Recipe
```json
{
  "adapters": [
    { "id": "auto-alt-text", "settings": { "autoDescribe": true } },
    { "id": "generate-labels", "settings": { "autoFixLabels": true } },
    { "id": "wcag-fixes", "settings": { "autoWcagFix": true } },
    { "id": "keyboard-nav", "settings": { "keyboardNav": true } }
  ]
}
```
