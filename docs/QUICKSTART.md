# Quick start

## Get the code

You'll need git and [Node.js](https://nodejs.org/) 20.19 or later. You don't
need `npm install`, a build step or an API key for anything on this page.

```bash
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit
```

## Run the demos

Each demo prints what happens at each step.

```bash
node toolkit/hosts/xr-demo/demo.js
```

A profile made in a web app is shared with an XR app. The XR app then suggests
a change, and the person accepts it. The end of the output looks like this:

```
━━━ 5. THE PERSON ACCEPTS → both surfaces update ━━━
  AbilityModel now: textSize=1.5
  Web renders: fontScale=150
  XR renders:  0.525° text
```

```bash
node toolkit/hosts/skill-demo/demo.js
```

The toolkit finds a built-in skill for a news article, writes a new skill for
"Make text bigger and hide clutter when I shop online", and saves it. It uses a
stand-in for the AI model, so you don't need an API key.

```bash
node examples/cross-surface.mjs
```

One profile is turned into settings for a web browser and an XR headset, side
by side.

## Use the toolkit in your own code

1. Create a file called `quickstart.mjs` in the root of the repository (next to
   `README.md`) and paste in this code:

<!-- QUICKSTART:START -->

```javascript
import { createToolkit } from './toolkit/index.js';
import { memoryKV } from './toolkit/platforms/node/kv.js';
import { nodeClock, nodeScheduler, consoleConsent } from './toolkit/platforms/node/ports.js';
import { renderWebSettings } from './toolkit/surfaces/web.js';
import { renderMobileSettings } from './toolkit/surfaces/mobile.js';
import { renderXRSettings } from './toolkit/surfaces/xr.js';

// Start the toolkit with in-memory storage.
const { datastore, librarian } = createToolkit({
  kv: memoryKV(),
  clock: nodeClock(),
  scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
});
await datastore.runMigrations();

// Save one need in the profile: text 1.4 times larger.
await librarian.setProfileField('supportAreas', ['vision']);
await librarian.setProfileField('fields.needs', [
  { dimension: 'textSize', value: 1.4, strength: 'preference', source: 'onboarding' },
]);

// Read the profile back and turn it into settings for each platform.
const model = await librarian.getAbilityModel();
const web = renderWebSettings(model);
const mobile = renderMobileSettings(model);
const xr = renderXRSettings(model, { fovDegrees: 100 });

console.log('Web:', web);
console.log('Mobile text:', mobile.text);
console.log('XR text:', xr.text);
```

<!-- QUICKSTART:END -->

2. Run it.

```bash
node quickstart.mjs
```

3. You should see:

```
Web: { fontScale: 140 }
Mobile text: { scalePercent: 140, lineSpacing: 1, boldText: false }
XR text: {
  angularSizeDeg: 0.49,
  worldHeightM: 0.013,
  lineSpacing: 1,
  font: 'standard'
}
```

The same profile gives each platform its own kind of setting: a font size
percentage for the web, the iOS and Android setting names for mobile, and for
XR, a text size in degrees (how big the text looks from where the person
stands).

`createToolkit` takes storage, a clock, a scheduler and a consent function for
your platform. The ones above are the Node versions from
`toolkit/platforms/node/`, and `memoryKV()` keeps everything in memory, so
nothing is saved after the script ends.

To use the toolkit from your own project instead of from this repository, see
[using-in-your-project.md](using-in-your-project.md).

## Add skills

To find skills for a page, give `createToolkit` the tools registry and the
built-in skills.

1. Add these lines to `quickstart.mjs`, after the other imports:

```javascript
import { asAATools } from './toolkit/registry/tools.js';
import { parseSkill } from './toolkit/index.js';
import { readdirSync, readFileSync } from 'node:fs';

const builtinSkills = readdirSync('./toolkit/skills/builtin')
  .filter((f) => f.endsWith('.md'))
  .map((f) => parseSkill(readFileSync(`./toolkit/skills/builtin/${f}`, 'utf8')));
```

2. Add two lines to the `createToolkit` call:

```javascript
const { datastore, librarian } = createToolkit({
  kv: memoryKV(),
  clock: nodeClock(),
  scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
  toolsRegistry: asAATools(),
  builtinSkills,
});
```

3. Add this to the end of the file:

```javascript
const skill = await librarian.retrieveSkill('https://www.nytimes.com/2026/article');
console.log('Skill:', skill?.name);
```

4. Run `node quickstart.mjs` again. The last line is now `Skill: reading-aid`,
   the built-in skill that fits a news article for someone who needs larger
   text.

[`toolkit/hosts/skill-demo/demo.js`](../toolkit/hosts/skill-demo/demo.js) shows
the rest: turning the skill into settings, and having the toolkit write a new
skill from a request like "Make text bigger and hide clutter when I shop
online".

## Next steps

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
