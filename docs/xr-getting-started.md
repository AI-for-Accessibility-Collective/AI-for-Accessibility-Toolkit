# XR developer — getting started with this repo

A short path from clone to an XR app that adapts to a person's toolkit profile. Deeper background: [design/cross-surface-analysis.md](design/cross-surface-analysis.md) · generated API reference: [../toolkit/API.md](../toolkit/API.md).

- **See it work first** (Node 24+, no build step): `cd toolkit && npm install && npm test`, then run `node toolkit/hosts/xr-demo/demo.js` — the whole loop (onboard → grant → XR render → insight back → consent) on in-memory ports.
- **The one model you consume**: `librarian.getAbilityModel()` returns the needs-based `AbilityModel`; `renderXRSettings(model, sensors)` (`toolkit/surfaces/xr.js`) turns it into XR parameters — angular text size (FOV + viewing-distance aware), world-locked captions, motion-comfort, UI eccentricity. You never parse web settings.
- **Executable cross-surface proof**: `node toolkit/test/cross-surface-translation-test.js` shows a web-side change rendering into XR and an XR-originated update rendering into mobile — copy its patterns for reads and writes.
- **Two integration styles**:
  - *JS runtime (WebXR, Electron, RN)*: embed the core — implement 4 small ports (`KVStore`, `Clock`, `Scheduler`, `Consent`; contracts in `toolkit/ports/index.js`) and call `createToolkit(...)`. Copy `toolkit/adapters/node/` as your template host.
  - *Any language / thin client*: call the hosted HTTP service — `POST /v1/librarian/{method}` with a bearer token (see [../server/CONTRACT.md](../server/CONTRACT.md) and [../server/INTERNAL-USE.md](../server/INTERNAL-USE.md) for a token). Native (C#/Swift) apps that only need profile transfer can implement the JSON protocol in `toolkit/protocol/` instead (schemas + fixtures; ArtInsight's Swift conformer is the worked example).
- **Writing back from XR**: never write the profile directly — request a grant (`requestGrant`), then send observations as consent-gated insights (`importInsight`); the person accepts/declines on any surface. Cross-app insights are automatically capped to `preference` strength.
- **Sensors**: FOV / viewing distance / lighting come from your host via the optional `Sensors` port and flow into `renderXRSettings` — see the xr-demo for the shape.
- **Working with Claude Code?** The repo ships a generated skill (`.claude/skills/ai4a11y-toolkit/`) that gives the agent the full method tables, port contracts, and service mapping — auto-loaded when you open this repo.
