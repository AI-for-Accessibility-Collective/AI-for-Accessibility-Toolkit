# Security Policy

This policy covers this repository: the toolkit core, the tools catalog, the hosted service (`server/`), and the onboarding example. The browser extensions have their own policy in the [extension repository](https://github.com/josifiin/AI-for-Accessibility-Extension/blob/main/SECURITY.md). This is a pre-alpha research probe; a security review before any public release is an open roadmap item.

## Reporting a Vulnerability

1. **Do not** open a public issue
2. Email the maintainers directly at [dcelin@stanford.edu](mailto:dcelin@stanford.edu)
3. Include: a description, steps to reproduce, potential impact, and a suggested fix if you have one

We will respond within 48 hours and work with you to understand and address the issue. Only the latest version is supported.

## Facts worth knowing

- **The library never holds an API key.** The AI provider is injected by the host (`tools/utils/ai.js`); key storage and transmission are the host's responsibility.
- **Profile ids are credentials.** The onboarding service's routes are unauthenticated by design; the profile id itself is the capability, so treat an id like a private share link. Details in [onboarding/README.md](onboarding/README.md).
- **The hosted service uses bearer tokens.** See [server/README.md](server/README.md) before deploying.
- **Cross-app sharing is gated by explicit, revocable grants** (`toolkit/sync/grants.js`); free text and confidence scores are never exported through them.

## Practices for Contributors

1. Never use `innerHTML` with user or AI-generated content without sanitizing
2. Avoid `eval()`, `Function()`, and similar dynamic code execution
3. Use `textContent` for text-only insertions
4. Validate all inputs from external sources (AI responses, user input)
5. Keep dependencies up to date

## Acknowledgments

We thank our security researchers and community members who help keep this project secure.
