# Adapter MCP SDK

Connect your app's accessibility adapters to an AI for Accessibility toolkit,
so they show up in the developer console under **Apps** and the console — or
any MCP client on your account, such as a coding agent — can list them, turn
them on and off, read their state, and undo a change.

**Status:** an active research project, pre-alpha, a technology probe. The
contract (version `0.1.0`) can still change, the adapters it carries are not
validated with the people they are meant for, and none of it replaces
assistive technology. In practice: use it to prototype and to learn, expect
to update your code when the contract changes, and do not rely on it for
anyone's access to anything.

The design and its open questions are in
[docs/design/adapter-mcp.md](../../docs/design/adapter-mcp.md); the wire shapes
and checks are in [`../protocol/adapter/`](../protocol/adapter/README.md).

## What you need

- A toolkit service you can sign in to (`npm run dev:workshop` from the
  repository root, then an account from `/admin`).
- Your **default token**, from the sidebar of `/developer` after signing in.

## Connect a web page

A page loads the SDK from the toolkit itself, so it always speaks the version
that toolkit understands:

```js
const TOOLKIT = 'http://localhost:8080';
const { createAdapterProvider, connectToToolkit, defineDescriptor, fromToggleAdapter, detectBrowserPlatform } =
  await import(`${TOOLKIT}/sdk/adapter-mcp.js`);

const provider = createAdapterProvider({
  application: {
    appId: 'my-app',                      // groups every instance under one app in the console
    name: 'My app',
    version: '0.1.0',
    supportedPlatforms: [{ environment: 'web-page' }],
    platform: detectBrowserPlatform(),
    surfaces: ['web'],
  },
  adapters: [
    fromToggleAdapter({
      adapter: bigText,                   // any object with enable(options), disable() and `enabled`
      descriptor: defineDescriptor({
        appId: 'my-app', id: 'big-text', name: 'Big text', version: '0.1.0',
        description: 'Makes the text on this page bigger.',
        targets: [{ platforms: ['*'], urls: [`${location.origin}/*`] }],
        inputSchema: {
          type: 'object',
          properties: { scale: { type: 'number', minimum: 1, maximum: 2, default: 1.25 } },
          additionalProperties: false,
        },
        operations: ['query', 'check', 'apply', 'revert', 'targets'],
      }),
      targets: () => ({ candidates: [{ target: { url: location.href } }], coverage: 'complete' }),
    }),
  ],
});

const link = connectToToolkit({ url: TOOLKIT, token: 'aat_…', provider, label: 'My app tab' });
await link.ready;                         // now live under Apps
addEventListener('pagehide', () => link.close());
```

The toolkit has to allow your page's address: `npm run dev:workshop` allows
any address, or set `CORS_ORIGINS` on the service.

In Node, import from `@ai4a11y/toolkit/adapter-mcp` (or
`toolkit/adapter-mcp/index.js` in this repository) instead; use
`{ environment: 'node' }` as the platform.

## The pieces

| Export | What it does |
|---|---|
| `createAdapterProvider({application, adapters, typedTools?, instructions?})` | An MCP server for your app's exported adapters, as a JSON-RPC handler (`provider.handle(message)`). Checks every descriptor when created and throws `AdapterMcpError` with the reasons. Adapters with `exposure: 'internal'`, or that do not fit the app's platform, are not exported. |
| `defineDescriptor(fields)` | A descriptor with defaults filled in: on/off (`mode: 'stateful'`), changes only this app (`reach: 'self'`), no parameters, fully undoable. Override any field. |
| `fromToggleAdapter({descriptor, adapter, toOptions?, observe?, targets?, resolveTarget?, check?, availability?})` | Wraps an adapter that has `enable(options)` and `disable()`. Calling apply again with new parameters reconfigures it; undo refuses if anything changed it since. |
| `fromAction({descriptor, run, …})` | Wraps a one-shot adapter (`mode: 'action'`): apply runs it once; there is nothing to undo. |
| `connectToToolkit({url, token, provider, providerId?, label?, onStatus?})` | Connects the provider to a toolkit service. Reconnects by itself after a network failure or a restart; stops on a wrong or revoked token. `onStatus` receives `connected`, `reconnecting`, `failed` or `closed` (it starts out `connecting`). |
| `createMcpClient({url, token})`, `adapterClient(client)` | A small MCP client, and the adapter tools on top of it: `list`, `describe`, `targets`, `query`, `check`, `apply`, `revert`. |
| `catalogDescriptors()` | Descriptors for this repository's built-in adapter catalog (`tools/adapters/`). |

Your app keeps running its own adapters. The provider only checks requests
against the descriptors and calls your functions; it does not load code,
schedule work or keep anything after a restart.

## The tools a client sees

`adapter_list`, `adapter_describe`, `adapter_targets`, `adapter_query`,
`adapter_check`, `adapter_apply` and `adapter_revert`, plus one `apply_<id>`
shortcut per adapter (turn these off with `typedTools: false`). A client pins
the exact adapter it means with `adapterRef` = `{appId, id, version,
descriptorDigest}`, from `adapter_list`; if the app has since changed the
adapter, the call is refused instead of running something else.

Through the toolkit, a client of the same account reaches your app at:

- `POST /v1/mcp/apps/<appId>` — the app's one live instance (refused, with the
  list, when several are connected), or
- `POST /v1/mcp/providers/<providerId>` — one particular instance.

For Claude Code:
`claude mcp add --transport http my-app http://localhost:8080/v1/mcp/apps/my-app --header "Authorization: Bearer aat_…"`.

## Tests

`node test/adapter-mcp.test.mjs` (here), and from `server/`:
`node test/apps.test.mjs`. Browser workflows from the repository root:
`npm run test:console:e2e` and `npm run test:redbird:e2e`.
