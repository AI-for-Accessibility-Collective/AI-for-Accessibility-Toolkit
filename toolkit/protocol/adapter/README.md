# Adapter MCP wire contract (profile `0.1.0`)

The checked shapes behind [Adapter MCP](../../../docs/design/adapter-mcp.md):
what an adapter descriptor and an application record must contain, how a
target rule matches an app or a web address, the input and output schemas of
the gateway tools, how a descriptor's digest is computed, the `web-module@1`
package format apps share adapters in, and the registry tools' schemas. The provider in
[`../../adapter-mcp/`](../../adapter-mcp/README.md), the toolkit service, and
the marketplace all use these same checks, so a descriptor accepted by one is
accepted by the others.

Pre-alpha and not stable: the shapes may change before `1.0`, and only two
integrations have used them so far. Code written against `0.1.0` should expect
to change.

Pure ES modules with no dependencies, no DOM and no Node APIs. The only host
facility is Web Crypto, for the SHA-256 digest, so it runs the same in a
browser, Node 18+ or Deno.

| File | What it holds |
|---|---|
| `descriptor.js` | The constants (modes, reach, surfaces, operations, statuses, reason codes, support areas), `checkApplication`, `checkDescriptor`, `defineDescriptor` (defaults), `adapterRefOf`, `summarizeDescriptor`. |
| `match.js` | Target rules: a rule names platforms and either native app ids or URL patterns; rules are OR'd; a concrete target names exactly one app or URL. `matchUrlPattern` (a pattern without a port matches any port), `matchTarget`, `platformCompatibility`. |
| `schema.js` | A JSON Schema 2020-12 validator for the subset descriptors use. `checkSchema` **rejects** a schema that uses an assertion keyword it does not implement (`if`/`then`, `patternProperties`, `contains`, …), so a constraint is never silently ignored. |
| `canonical.js` | RFC 8785 canonical JSON and `descriptorDigest`: `sha256:` over the canonical form of `{descriptor, executionArtifactDigest}`, where `descriptor` keeps only the contract fields listed in `DIGEST_FIELDS` (so display-only additions do not change it). |
| `wire.js` | `TOOL_SCHEMAS` and `TOOL_DESCRIPTIONS` for `adapter_list`, `adapter_describe`, `adapter_targets`, `adapter_query`, `adapter_check`, `adapter_apply`, `adapter_revert`; `ADAPTER_REF_SCHEMA`; `TARGET_SCHEMA`. |
| `package.js` | `web-module@1`: `rewriteExports` / `moduleFactorySource` (a module's exports as a returned object, for runtimes without ES modules), `pickAdapter`, `instantiateWebModule`, `lintWebModule` (a lint, not a sandbox), `checkPackage`, `artifactDigest`, and URL patterns for a browser runtime (`chromeMatchPatterns`, `urlPatternRegExpSource` with `normalizedUrl`, equal to `matchUrlPattern`). |
| `registry.js` | `REGISTRY_TOOL_SCHEMAS` and `REGISTRY_TOOL_DESCRIPTIONS` for the toolkit's adapter registry (`adapter_search`, `adapter_get`, `adapter_publish`, `adapter_share`, `adapter_delete`, `adapter_install`, `adapter_uninstall`, `adapter_installed`, `adapter_report`, `adapter_status`), `REGISTRY_KEY_SCHEMA`, `BROWSER_RUNTIME_APP`. |
| `fixtures/` | `descriptor.valid.json`, `url-patterns.json` (pattern, address, expected match) and `digest-vectors.json` (input, expected digest), for an implementation in another language to check itself against. |

Every check returns a list of `{path, message}` errors (empty when valid)
rather than throwing, so a caller can show all the problems at once.

Tests: `node test/adapter-mcp.test.mjs` (which also runs the fixtures) and
`node test/adapter-package.test.mjs` from `toolkit/`.
