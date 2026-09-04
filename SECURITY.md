# Security Policy

This policy covers this repository: the toolkit core, the tools catalog, the hosted service (`server/`), and the onboarding example. The browser extensions have their own policy in the [extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension/blob/main/SECURITY.md). This is a pre-alpha research probe; a security review before any public release is an open roadmap item.

## Reporting a Vulnerability

1. **Do not** open a public issue
2. Email the maintainers directly at [dcelin@stanford.edu](mailto:dcelin@stanford.edu)
3. Include: a description, steps to reproduce, potential impact, and a suggested fix if you have one

We will respond within 48 hours and work with you to understand and address the issue. There are no tagged releases yet; until the first one, only the current state of the default branch is supported.

## Facts worth knowing

- **The library never holds an API key.** The AI provider is injected by the host (`tools/utils/ai.js`); key storage and transmission are the host's responsibility. The hosted service is itself such a host: `server/` reads `GEMINI_API_KEY` from its environment and holds it for the life of the deployment, so a deployer owns that key's handling.
- **Profile ids are credentials.** The onboarding service's routes are unauthenticated by design; the profile id itself is the capability, so treat an id like a private share link. Details in [onboarding/README.md](onboarding/README.md).
- **The hosted service uses bearer tokens.** See [server/README.md](server/README.md) before deploying. Its Gemini calls send the key in a request header, not in the URL, so it stays out of access logs.
- **The CLI can fetch axe-core from a CDN.** `cli/axe-core.min.js` is vendored, and `session audit` uses it. If that file is missing from an install, the CLI downloads the same version from cdnjs over HTTPS with no integrity check and writes it next to the package. A deployer who wants no network fetch should confirm the vendored file is present.
- **Cross-app sharing is gated by explicit, revocable grants** (`toolkit/sync/grants.js`); free text and confidence scores are never exported through them.

## Practices for Contributors

1. Never use `innerHTML` with user or AI-generated content without sanitizing
2. Avoid `eval()`, `Function()`, and similar dynamic code execution
3. Use `textContent` for text-only insertions
4. Validate all inputs from external sources (AI responses, user input)
5. Keep dependencies up to date

## Acknowledgments

We thank our security researchers and community members who help keep this project secure.
