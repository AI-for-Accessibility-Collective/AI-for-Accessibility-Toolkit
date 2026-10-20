# Quick start

This page shows how to run the demos and use the toolkit's core in your own
code. You don't need a browser, a build step or an API key.

## Run the demos

From a clone of the repository, with nothing installed:

```bash
node toolkit/hosts/xr-demo/demo.js      # a profile made on the web is shared with an XR app
node toolkit/hosts/skill-demo/demo.js   # finds, builds, checks and saves a skill
node examples/cross-surface.mjs         # one profile turned into web and XR settings
```

The skill demo uses a stand-in for the AI model, so it shows the steps without
calling a real model.

## Use the core

This example creates a profile, adds one need (larger text), and turns the
profile into settings for the web, mobile and XR. It assumes your file is at
the root of the repository. If it isn't, change the import paths, or see
[using-in-your-project.md](using-in-your-project.md) to use the packages
instead.

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

- `createToolkit` takes the storage, clock, scheduler and consent functions
  for your platform (here, the Node versions in `toolkit/platforms/node/`) and
  returns the datastore and the Librarian.
- The two `setProfileField` calls set a support area and one need, which
  onboarding would normally do.
- `getAbilityModel` returns the profile in the form the renderers use.
- Each `render*` function turns that model into one platform's settings.

## Enable the skill layer

The example above has no skills. Without the tools registry and the built-in
skills, `retrieveSkill` finds nothing and skills can't be checked. To add
them, pass both to `createToolkit`:

```javascript
import { asAATools } from './toolkit/registry/tools.js';
import { parseSkill } from './toolkit/core/skill.js';
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

`toolkit/hosts/skill-demo/demo.js` is a full example of this.

## Next

- Connect it to a real app:
  [COMPONENTS.md, "What a host implements"](COMPONENTS.md#what-a-host-implements)
- Every method in the core: [`toolkit/API.md`](../toolkit/API.md)
- A walkthrough for coding agents: the
  [`ai4a11y-toolkit` skill](../.claude/skills/ai4a11y-toolkit/SKILL.md)
- A browser extension, step by step:
  [web-extension-getting-started.md](web-extension-getting-started.md)
- A non-web app, step by step: [xr-getting-started.md](xr-getting-started.md)
- Using the packages in your own project:
  [using-in-your-project.md](using-in-your-project.md)
