---
name: unhurried-voice
description: Makes a page easier to operate by voice and with limited hand control, where speech or movement is slower or less predictable. Use when standard voice control or small, fast controls are hard to use (common with cerebral palsy, dysarthria, or other speech and motor differences).
supportAreas: [motor]
siteRelevance: [all]
---

# Unhurried Voice

Lets a person drive a page by voice, with a safety check before anything important happens and large controls as a backup.

## What it does
1. **voice-commands** — turns on voice control of the page, so everyday actions can be spoken instead of clicked.
2. **confirm-actions** — asks the person to confirm before an action takes effect, so a misheard command is never acted on silently.
3. **big-targets** — enlarges buttons and links, so the same actions stay reachable by hand, switch or pointer when speaking is tiring.
4. **dismiss-overlays** — clears pop-ups and banners that interrupt a voice or pointer flow and are hard to close with limited hand control.

## When to use
Any page a person wants to operate hands-free or with limited hand control, especially when standard speech recognition does not reliably understand them. Safe everywhere: nothing here removes content.

## Notes
- Built with a co-designer with a speech impairment during the AI for Accessibility Design and Hackathon, Nairobi (November 2026), team Sauti Adapt.
- Pairs with a personal speech recogniser (for example one trained on the person's own recordings) that feeds commands to the Controller; this skill covers the page side.
- Principle: an unclear command is never acted on. Confirmation and a non-voice fallback are part of the recipe, not optional extras.

## Recipe
```json
{
  "adapters": [
    { "id": "voice-commands", "settings": { "voiceCommands": true } },
    { "id": "confirm-actions", "settings": { "confirmActions": true } },
    { "id": "big-targets", "settings": { "bigTargets": true } },
    { "id": "dismiss-overlays", "settings": { "dismissOverlays": true } }
  ]
}
```
