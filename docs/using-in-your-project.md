# Using the toolkit in your own project

The core and the catalog are consumable as two packages:

| Package | Directory | What it is |
|---|---|---|
| `@ai4a11y/toolkit` | [`../toolkit/`](../toolkit/) | The core: Librarian, datastore, ability model, skill engine, ports, surfaces, registry |
| `@ai4a11y/tools` | [`../tools/`](../tools/) | The catalog: adapters, auditors, validators, profiles, utils |

Both have proper `exports` maps and committed type declarations, so
à-la-carte imports (`import { asAATools } from '@ai4a11y/toolkit/registry'`)
resolve with editor support.

**They are not on npm yet.** Publishing to a package registry is a
maintainer decision that has not been made (see [ROADMAP.md](../ROADMAP.md),
"Public release"). Until then, consume them as packed tarballs:

```bash
# from a clone of this repository
(cd toolkit && npm pack)   # -> ai4a11y-toolkit-<version>.tgz
(cd tools   && npm pack)   # -> ai4a11y-tools-<version>.tgz
```

Commit the tarballs into your project (a `vendor/` directory is the
convention) and depend on them by path:

```json
{
  "dependencies": {
    "@ai4a11y/toolkit": "file:vendor/ai4a11y-toolkit.tgz",
    "@ai4a11y/tools": "file:vendor/ai4a11y-tools.tgz"
  }
}
```

The **reference implementation** of this pattern is the extension
repository's
[`scripts/update-vendor.mjs`](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension/blob/main/scripts/update-vendor.mjs)
with its `vendor/PIN.json`: it pins the tarballs to one toolkit commit,
rebuilds them reproducibly from that commit, and keeps the consumer's
lockfile integrity hashes in step. Copy it if you want the same
upgrade-by-deliberate-pin-bump discipline; for a first integration, the
two `npm pack` commands above are enough.

Two alternatives, depending on what you are building:

- **Any language, no JS runtime**: run the hosted HTTP service
  ([`../server/`](../server/)) and call the same Librarian methods over
  HTTP. See [../server/README.md](../server/README.md).
- **Just a few files**: everything is Apache 2.0; copying the modules you
  need into your tree is a legitimate path (record where they came from).

If the packages are published to a registry later, this page collapses to
`npm install` and your `file:` dependencies swap to version ranges.
