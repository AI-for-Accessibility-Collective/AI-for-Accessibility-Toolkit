// Adapter MCP helpers — optional. Two halves: sharing adapters through a
// toolkit's registry (registry.js), and live control of an app's own
// adapters (provider.js, wrap.js, connect.js), which validates and delegates
// to application-owned functions without scheduling work, tracking targets or
// keeping an undo journal. See README.md in this folder and
// docs/design/adapter-mcp.md.

export { createAdapterProvider, describeOutcome, AdapterMcpError } from './provider.js';
export { fromToggleAdapter, fromAction } from './wrap.js';
export { connectToToolkit, detectBrowserPlatform } from './connect.js';
export { createMcpClient, adapterClient, McpError } from './client.js';
export { createRegistryClient, loadInstalledAdapters, RegistryCallError } from './registry.js';
export * from '../protocol/adapter/index.js';
export { catalogDescriptor, catalogDescriptors } from './catalog.js';
