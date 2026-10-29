// Adapter MCP binding helpers — optional. They validate and delegate to
// application-owned functions; they do not load adapters, schedule work, track
// targets or keep an undo journal. See README.md in this folder and
// docs/design/adapter-mcp.md.

export { createAdapterProvider, describeOutcome, AdapterMcpError } from './provider.js';
export { fromToggleAdapter, fromAction } from './wrap.js';
export { connectToToolkit, detectBrowserPlatform } from './connect.js';
export { createMcpClient, adapterClient, McpError } from './client.js';
export * from '../protocol/adapter/index.js';
export { catalogDescriptor, catalogDescriptors } from './catalog.js';
