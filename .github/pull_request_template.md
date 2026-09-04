## What does this PR do?

## Which part(s) does it affect?

- [ ] Core (`toolkit/core/` — Librarian, datastore, ability model, broker, skill engine)
- [ ] Ports / surfaces (`toolkit/ports/`, `toolkit/surfaces/`)
- [ ] Platform bindings / host port impls (`toolkit/platforms/`)
- [ ] Catalog: auditors (`tools/auditors/`)
- [ ] Catalog: adapters (`tools/adapters/`)
- [ ] Catalog: profiles (`tools/profiles/`)
- [ ] Registry / built-in skills (`toolkit/registry/`, `toolkit/skills/builtin/`)
- [ ] Hosted service (`server/`)
- [ ] Docs

## Who benefits?

Which needs/profiles/disabilities does this help?

## How to test

1. `npm install`
2. `npm test` (tools, toolkit, controller, and onboarding suites)
3. Relevant demos: `node toolkit/hosts/xr-demo/demo.js`, `node toolkit/hosts/skill-demo/demo.js`, `node server/test/server-test.mjs`
4. If you touched `onboarding/`, `controller/`, `tools/`, `toolkit/`, or `server/src/`: `npx playwright install chromium` once, then `npm run validate:browser` and `npm run test:e2e` (see Testing in CONTRIBUTING.md)
5. If you changed the core API, regenerate `toolkit/API.md` + the skill and commit the result.
