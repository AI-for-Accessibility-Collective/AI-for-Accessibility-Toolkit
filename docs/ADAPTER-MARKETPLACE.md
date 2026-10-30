# The adapter marketplace (Listings)

**Where apps list what they offer, as descriptions.** The toolkit's adapter
catalog (`tools/adapters/`) is what ships *in* this repository. The
*marketplace* is a catalog on a running toolkit instance where each **host
application** (the browser extension, the XR guide, any future host) lists
the adapters it offers, so a developer can see what exists per app. The
developer console shows it on the **Listings** page.

**To share an adapter other apps can run, use the adapter registry instead.**
The registry is the toolkit's own MCP server (`/v1/mcp`, the console's
**Adapters** page, [design/adapter-mcp.md](design/adapter-mcp.md) §14): apps
publish adapters with code in a format others can run, keep them private or
share them, and install each other's, and the browser runtime extension runs
them. The marketplace predates it and stays for description-only listings and
for the apps that already sync their catalogs here.

The wire contract is [server/CONTRACT.md](../server/CONTRACT.md)'s "Adapter
marketplace" section; the generated endpoint table is in
[server/API.md](../server/API.md); the implementation is
`server/src/adapters.js`.

The marketplace describes adapters; it does not run them. Live control of an
open app is [Adapter MCP](design/adapter-mcp.md)'s optional relay: an app that
uses the SDK connects with its developer's token, appears in the developer
console under **Apps**, and can be called by the console or by any MCP client
on the same account. That contract is a pre-alpha draft, so its shapes can
still change. A listing can carry an Adapter MCP descriptor (below), which
connects the two.

## Two kinds of listing

| Kind | What is stored | Who runs it |
|---|---|---|
| **data** | A manifest only: id, name, description, the settings keys it applies, support areas, links. The adapter's code stays in the app's own repository. | The app that registered it. |
| **data + code** | The manifest **plus** a JavaScript source blob (≤ 256 KB), served verbatim by `GET /v1/adapters/{appId}/{id}/code` with its SHA-256. | Any host that chooses to download, lint, and install it — behind that host's own consent flow. |

The server never executes, lints, or vouches for code. A host that runs
downloaded adapter code treats it like any third-party software: the browser
extension runs it through the same denylist lint the Adapter Builder uses
(not a sandbox — see the extension's SECURITY.md) and installs it as a Chrome
user script only when the person clicks Install.

## Grouped by app

Every entry belongs to an app (`appId`, a lowercase slug) and the two-level
key is `appId/id` — the browser extension and the XR app can each have an
adapter called `one-step`. `GET /v1/adapters` returns the flat list plus an
`apps` summary (display name, count); the developer console
(`/developer` → **Listings**) renders one group per app. An app the
developer has hidden on the Apps page is hidden here too, with a **Show
hidden** switch to bring it back.

## Adapter MCP descriptors

A listing may include `descriptor`, an Adapter MCP descriptor for the same
`appId` and `id`. The service checks it with the same rules an Adapter MCP
provider uses and stores it with a `descriptorDigest` it computes itself, so a
client can tell whether a connected app is running the version that was
listed. The console labels these listings **Adapter MCP 0.1** and the others
**Legacy listing**. Legacy listings keep working unchanged.

## Who can do what

- Any valid user bearer token can **register** and **list**.
- Update, delete, and sync-over an entry require the token whose uid
  registered it — or the admin password, for moderation.
- **Install state** (`PUT`/`DELETE …/install`) is per user: the marketplace
  is shared, each person's view of what they've installed is their own
  (`users/<uid>/adapters.json`, wiped with the rest of the partition on
  deletion).

## How the known apps use it

**Browser extension** (`AI-for-Accessibility-Extension`, personalized
build). In remote mode it adopts the API in both directions:

- *Publish:* on service-worker startup and whenever the server config
  changes, `background.js` calls `POST /v1/adapters/sync` with
  `appId: "browser-extension"`, `full: true`, and a catalog built from the
  baked toolkit registry (`AA_TOOLS`, 46 entries) plus the person's custom
  skills as metadata. No code is uploaded.
- *Consume:* the popup's **Toolkit Marketplace** section lists kind-`code`
  adapters registered for the browser extension. Install = download →
  `lib/adapter-lint.js` (the Adapter Builder's denylist, extracted so the
  service worker can use it) → save as a custom skill → the existing
  user-scripts reconcile registers it. Rejected code never lands.

**XR Task Guide** (`AI-for-Accessibility-XR`). Its adapters
(`src/toolkit-candidates/`) are data-only listings — prompt wording, paced
delivery, voice — because their code is TypeScript living in that repo.
[`examples/register-xr-adapters.mjs`](../examples/register-xr-adapters.mjs)
publishes them (`appId: "xr"`) and is idempotent: re-running upserts, and
`full: true` retires anything the list no longer contains.

**Redbird demo** (`AI-for-Accessibility-Collective/redbird`). Each store
tab connects through Adapter MCP as the app `redbird` rather than publishing a
listing, so its adapters show up under **Apps**, live, while the tab is open.

**Your app.** One call publishes your catalog — see the XR example as a
template — or register single adapters with `POST /v1/adapters`. Use
`full: true` sync if you want the listing to track your shipped set. To make
the adapters callable as well as listed, connect the app with the Adapter MCP
SDK (`toolkit/adapter-mcp/`).

## Tests

- `server/test/adapters.test.mjs` — the API: CRUD, ownership, sync semantics,
  code blobs, install state, validation, delete-cascade.
- `npm run test:adapters:e2e` — the Marketplace page in a real browser.
- `server/test/apps.test.mjs` and `npm run test:console:e2e` — Adapter MCP
  apps connecting, listing and being called, in the API and in the console.
- `npm run test:extension:e2e` — the real unpacked extension against a real
  instance: catalog sync, popup list, linted install, install state, and lint
  rejection. Needs the extension repository checked out beside this one.
