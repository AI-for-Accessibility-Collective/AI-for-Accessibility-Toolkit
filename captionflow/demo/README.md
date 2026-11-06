# CaptionFlow — 2-hour local player prototype

This deliberately small prototype unblocks Role 4 (currently unassigned) without waiting for a full frontend framework. It uses **the existing CaptionFlow pipeline**, the existing **fixture caption processor** and **Role 5's real toolkit-backed text-size persistence**.

## Run from the fork's repository root

```bash
node captionflow/demo/server.mjs
# Open http://127.0.0.1:8787
```

Use Chrome/Firefox. Select a video stored on your device. It never leaves your browser. The demo includes three **fictional manually-timed captions** that do not automatically match the video you choose. Alternatively, select a matching CaptionFlow JSON output containing a `captions` array to show captions from the team. No ASR, translation, streaming or AI calls occur here.

Try changing language to Swahili, switching original/plain modes, playback speed, replaying the current caption, automatic pause-at-each-caption, contrast, and font size. A font-size change is saved to the toolkit's local demo profile and can be undone, including across server restarts.

### Verify before committing

```bash
node --test captionflow/demo/server.test.mjs captionflow/tests/*.test.mjs
node --check captionflow/demo/server.mjs
node --check captionflow/demo/app.js
```

The API test confirms the server serves the existing pipeline result and that the actual toolkit preference provider saves and restores text size. **It does not automate browser interaction**: do the interactive checks manually.

## For team integration

- **Joan:** supply a complete timed transcript with language tags, then Role 1 can use it in the existing `transcriber` seam. The player can also load pipeline output as a local JSON file.
- **Kenn:** Role 5's text-size `getPreferences`/`setTextSize`/undo are wired to the UI; review the host's profile and consent assumptions. Other CaptionFlow-specific preferences currently stay in browser UI state.
- **Caption processing:** still uses the manually authored `notice.variants.json` examples. The original text remains accessible and every alternate phrase is tagged unreviewed.
- **Role 1:** swap the fixture transcriber and caption processor through `createCaptionFlowPipeline` as teammates deliver tested modules. Consider this a fallback integration player if the assigned player developer becomes available with something stronger.

## Safety and limitations

- The server binds **only to `127.0.0.1`**. Do not expose it publicly or send this localhost link to your co-designer; there is no authentication. Use a consented live demonstration or deploy a separate properly secured version.
- The video remains in the user's browser. Prototype preferences persist to `captionflow/.captionflow-storage/` (gitignored). Do not use real co-designer profiles or private recordings here.
- Caption timestamps are merely reproduced from the fixture or user-provided JSON; there is no evidence of their correspondence to the chosen video. A matching clip/transcript is required to evaluate synchronization.
- Written Swahili alternatives are unverified samples and should be reviewed by a competent speaker and co-designer. No claim of translation accuracy.
- One-screen-accessibility and co-designer usability have **not yet been tested**. Manual testing with keyboard, screen widths, and the actual co-designer's chosen preferences is required.
- Browser code uses captions via `textContent` rather than HTML insertion; custom caption JSON is parsed locally, not uploaded.
