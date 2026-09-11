# Extension developer: getting started with this repo

A short path from clone to a browser extension that adapts to a person's
toolkit profile. The counterpart for non-web hosts:
[xr-getting-started.md](xr-getting-started.md). Deeper background:
[COMPONENTS.md](COMPONENTS.md) · generated API reference:
[../toolkit/API.md](../toolkit/API.md).

- **See it work first.** Two working extensions built on this toolkit live
  in the
  [extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension),
  loadable as-is with no build. They are the richest worked example of
  everything below — but they are one team's architecture, not the only
  way to wire a host.
- **Embed the core in a service worker.** The Chrome port implementations
  are exported as plain factories from
  [`../toolkit/platforms/chrome/ports.js`](../toolkit/platforms/chrome/ports.js):
  `createToolkit({ kv: chromeKV(), clock: chromeClock(), scheduler:
  chromeScheduler(), consent: chromeConsent() })` in your MV3 background
  service worker gives you `{ datastore, librarian }` over
  `chrome.storage`. **Note:** the `*.entry.js` files in that directory are
  the reference extensions' own classic-script bundle entries (they attach
  globals for a specific build setup) — copy the factories, not the
  entries.
- **Wire the skill layer.** Pass `toolsRegistry: asAATools()` (from
  [`../toolkit/registry/tools.js`](../toolkit/registry/tools.js)) and the
  parsed builtin skills to `createToolkit`, or `retrieveSkill` and skill
  validation have nothing to work with. The snippet is in
  [QUICKSTART.md](QUICKSTART.md#enable-the-skill-layer);
  `toolkit/hosts/skill-demo/demo.js` is the worked example.
- **Render and apply.** In your content script, render
  `librarian.getAbilityModel()` with `renderWebSettings(model)`
  (`toolkit/surfaces/web.js`) and apply the resulting settings through the
  catalog adapters in `@ai4a11y/tools` — the `adaptersForTools` map in
  [`../tools/profiles/settings.js`](../tools/profiles/settings.js) is the
  settings-key → adapter wiring the reference extensions use. Use
  `deriveWebSettings()` instead when you also want the `unmet` list (needs
  the web surface cannot render). The valid need dimensions are tabulated
  in [GLOSSARY.md](GLOSSARY.md#the-needs-vocabulary-dimensions).
- **The AI lane is optional, and there are two seams.**
  `setAIProvider(provider)` from `../tools/utils/ai.js` powers the
  AI-backed catalog adapters; `librarian.setGeminiCaller(fn)` powers the
  core's generative features. Wire both through your background worker so
  keys never live in content scripts; everything structural works with
  neither ([COMPONENTS.md](COMPONENTS.md#when-no-ai-provider-is-configured)).
- **Consuming the code**: the packages are not on npm yet — see
  [using-in-your-project.md](using-in-your-project.md) for the pack-and-
  vendor recipe (the extension repository's `scripts/update-vendor.mjs` is
  the reference implementation).
- **Before you rely on it**: this is a pre-alpha research probe; the
  adapters are demonstrations whose effectiveness is not yet validated.
  Carry that framing into anything you ship on top of it (see "Forks and
  spin-offs" in [../CONTRIBUTING.md](../CONTRIBUTING.md)).
