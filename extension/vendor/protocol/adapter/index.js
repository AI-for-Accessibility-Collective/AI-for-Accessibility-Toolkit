// Adapter MCP wire contract — see docs/design/adapter-mcp.md and README.md
// in this folder. Pure: no DOM, no Node APIs, no network; Web Crypto is the
// only host facility (for the descriptor and package digests).

export {
  PROFILE_NAME, PROFILE_VERSION, MCP_PROTOCOL_VERSION, SUPPORTED_PROFILE_VERSIONS,
  MODES, EXPOSURES, REACHES, SURFACES, REVERSIBILITY, OPERATIONS, VERIFICATION,
  MUTATION_STATUSES, QUERY_STATUSES, REASON_CODES, SUPPORT_AREAS, SLUG, VISIBILITY, APP_VISIBILITY,
  checkApplication, checkDescriptor, summarizeDescriptor, adapterRefOf, defineDescriptor,
} from './descriptor.js';
export { checkSchema, validate, formatErrors, jsonEqual } from './schema.js';
export { canonicalize, sha256Hex, descriptorDigest, digestInput, DIGEST_FIELDS } from './canonical.js';
export {
  urlPatternError, matchUrlPattern, checkTargetRules, targetShapeError, matchTarget,
  checkPlatformRecords, platformCompatibility,
} from './match.js';
export { ADAPTER_REF_SCHEMA, TARGET_SCHEMA, TOOL_SCHEMAS, GATEWAY_TOOLS, TOOL_DESCRIPTIONS } from './wire.js';
export {
  WEB_MODULE, PACKAGE_FORMATS, MAX_PACKAGE_CODE, artifactDigest, rewriteExports, moduleFactorySource,
  isAdapterObject, pickAdapter, instantiateWebModule, lintWebModule, webUrlPatterns, checkPackage,
  chromeMatchPatterns, urlPatternRegExpSource, normalizedUrl,
} from './package.js';
export {
  REGISTRY_KEY_SCHEMA, REGISTRY_TOOL_SCHEMAS, REGISTRY_TOOLS, REGISTRY_READ_ONLY, REGISTRY_TOOL_DESCRIPTIONS,
  BROWSER_RUNTIME_APP, REPORT_STATUSES, OWNER_PATTERN, registryKey,
} from './registry.js';
export { PROFILE_TOOL_SCHEMAS, PROFILE_TOOLS, PROFILE_READ_ONLY, PROFILE_TOOL_DESCRIPTIONS } from './profile.js';
export { ACCESS_TOOL_SCHEMAS, ACCESS_TOOLS, ACCESS_READ_ONLY, ACCESS_TOOL_DESCRIPTIONS, narrowestVisibility } from './access.js';
