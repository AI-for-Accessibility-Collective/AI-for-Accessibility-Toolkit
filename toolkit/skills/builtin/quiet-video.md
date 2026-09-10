---
name: quiet-video
description: Makes video watchable without sound and without motion stress — captions plus reduced motion. Use for deaf and hard-of-hearing users, or anyone in a sound-off setting, on video sites.
supportAreas: [hearing, sensory]
siteRelevance: [video]
---

# Quiet Video

Adds a visual track to video and calms the surrounding page.

## What it does
1. **captions** — generates captions for videos that lack them, so speech becomes readable text. Captions are machine-generated; they may be wrong or incomplete.
2. **motion-reducer** — stops autoplay and background animation on the page around the player, so nothing competes with the captions.

## When to use
Video and streaming pages. Also useful for anyone watching with sound off (public spaces, shared rooms), not only deaf and hard-of-hearing users.

## Notes
- Caption generation calls the AI provider on the video's audio; it may take a few seconds on first play.
- Generated captions are unvalidated and can mishear or omit speech — a person who cannot hear the audio cannot spot the errors. They are not a substitute for professionally produced captions where those exist.

## Recipe
```json
{
  "adapters": [
    { "id": "captions", "settings": { "autoCaptions": true } },
    { "id": "motion-reducer", "settings": { "motionReducer": true } }
  ]
}
```
