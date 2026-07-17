---
name: quiet-video
description: Makes video watchable without sound and without motion stress — auto-captions plus reduced motion. Use for deaf/hard-of-hearing users, or anyone in a sound-off setting, on video sites.
supportAreas: [hearing, sensory]
siteRelevance: [video]
---

# Quiet Video

Adds a visual track to video and calms the surrounding page.

## What it does
1. **auto-captions** — generates captions for videos that lack them, so speech is readable.
2. **motion-reducer** — stops autoplay and background animation on the page around the player, so nothing competes with the captions.

## When to use
Video and streaming pages. Also useful for anyone watching with sound off (public spaces, shared rooms), not only deaf/HoH users.

## Notes
- Caption generation calls the AI provider on the video's audio; it may take a few seconds on first play.

## Recipe
```json
{
  "adapters": [
    { "id": "auto-captions", "settings": { "autoCaptions": true } },
    { "id": "motion-reducer", "settings": { "motionReducer": true } }
  ]
}
```
