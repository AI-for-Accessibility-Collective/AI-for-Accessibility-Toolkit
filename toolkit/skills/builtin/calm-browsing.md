---
name: calm-browsing
description: Reduces sensory load on any page — stops motion, dims the display, and removes clutter. Use for sensory-processing sensitivity, migraine, anxiety, or vestibular discomfort.
supportAreas: [sensory, cognitive, vision]
siteRelevance: [all]
---

# Calm Browsing

Turns a busy, animated page into a still, low-stimulation one.

## What it does
1. **motion-reducer** — stops animations, autoplaying video, GIFs, and parallax, which are common triggers for vestibular discomfort and migraine.
2. **dark-mode** — lowers overall brightness to reduce glare.
3. **focus-mode** — hides ads and popups to cut visual clutter (no progress spinner, which can itself cause stress).

## When to use
Any page that feels overwhelming — heavy social feeds, news sites, ad-dense pages. Safe everywhere; nothing here removes content, only movement and clutter.

## Notes
- Deliberately leaves progress indicators OFF — for sensory-sensitive users, spinners add stress rather than reassurance.

## Recipe
```json
{
  "adapters": [
    { "id": "motion-reducer", "settings": { "motionReducer": true } },
    { "id": "dark-mode", "settings": { "darkMode": true } },
    { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true, "showProgress": false } }
  ]
}
```
