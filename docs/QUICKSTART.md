# Quick Start

The core is plain ES modules. Wire it to the reference Node platform
bindings and go: no browser, no build, no API key. What you are doing below
is the loop from the [README](../README.md): a need becomes a profile, and
the profile renders to whatever surface you are building.

## Run the demos first

From a clone, with nothing installed:

```bash
node toolkit/hosts/xr-demo/demo.js      # onboard on web -> grant -> XR renders -> insight flows back -> accept
node toolkit/hosts/skill-demo/demo.js   # retrieve -> resolve -> build -> validate -> save a skill
node examples/cross-surface.mjs         # one profile -> web + XR, side by side
```

The skill demo installs a stub in place of a model; it shows the plumbing,
not a model authoring a skill.

## Embed the core

The snippet's relative imports assume your file sits at the repository
root; adjust the specifiers if it lives elsewhere (or when consuming the
packages — see [using-in-your-project.md](using-in-your-project.md)).

<!-- QUICKSTART:START -->

```javascript
import { createToolkit } from './toolkit/index.js';
import { memoryKV } from './toolkit/platforms/node/kv.js';
import { nodeClock, nodeScheduler, consoleConsent } from './toolkit/platforms/node/ports.js';

const { datastore, librarian } = createToolkit({
  kv: memoryKV(),
  clock: nodeClock(),
  scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
});

await datastore.runMigrations();
await librarian.setProfileField('supportAreas', ['vision']);
await librarian.setProfileField('fields.needs', [
  { dimension: 'textSize', value: 1.4, strength: 'preference', source: 'onboarding' },
]);

// One device-independent understanding of the person...
const model = await librarian.getAbilityModel();

// ...rendered for whatever surface you are building:
import { renderWebSettings } from './toolkit/surfaces/web.js';
import { renderMobileSettings } from './toolkit/surfaces/mobile.js';
import { renderXRSettings } from './toolkit/surfaces/xr.js';
renderWebSettings(model);                        // { fontScale: 140, ... }
renderMobileSettings(model);                     // { text: { scalePercent: 140, ... }, ... }
renderXRSettings(model, { fovDegrees: 100 });    // { text: { angularSizeDeg, ... }, ... }
```

<!-- QUICKSTART:END -->
What each line does: `createToolkit` takes the ports your platform provides
and returns the datastore and the Librarian; the two `setProfileField` calls
stand in for onboarding; `getAbilityModel` is the profile as the surfaces
see it; each `render*` call is a pure function from that model to one
surface's settings.

## Enable the skill layer

The snippet above leaves the skill layer empty: without a tools registry
and the builtin skills, `retrieveSkill` finds nothing and skill validation
has no vocabulary to check against. To wire them in, pass both to
`createToolkit`:

```javascript
import { asAATools } from './toolkit/registry/tools.js';
import { parseSkill } from './toolkit/index.js';
import { readdirSync, readFileSync } from 'node:fs';

const builtinSkills = readdirSync('./toolkit/skills/builtin')
  .filter((f) => f.endsWith('.md'))
  .map((f) => parseSkill(readFileSync(`./toolkit/skills/builtin/${f}`, 'utf8')));

const { datastore, librarian } = createToolkit({
  kv: memoryKV(), clock: nodeClock(), scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
  toolsRegistry: asAATools(),
  builtinSkills,
});
```

`toolkit/hosts/skill-demo/demo.js` is the full worked example of this
wiring (retrieve → resolve → build → validate → save).

## Next

- Wire it into a real host: [COMPONENTS.md, "What a host implements"](COMPONENTS.md#what-a-host-implements).
- Method reference: [`toolkit/API.md`](../toolkit/API.md).
- Embedding walkthrough for coding agents: the [`ai4a11y-toolkit` skill](../.claude/skills/ai4a11y-toolkit/SKILL.md).
- A browser-extension host, step by step: [web-extension-getting-started.md](web-extension-getting-started.md).
- A non-web host, step by step: [xr-getting-started.md](xr-getting-started.md).
- Consuming the packages in your own project: [using-in-your-project.md](using-in-your-project.md).
