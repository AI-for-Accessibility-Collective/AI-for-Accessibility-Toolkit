# Security policy

This policy covers this repository: the toolkit core, the tools catalog, the
hosted service (`server/`) and the onboarding example. The browser extensions
have their own policy in the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension/blob/main/SECURITY.md).

This is a research prototype and hasn't had a security review yet (it's on the
[roadmap](ROADMAP.md) before any public release).

## Reporting a vulnerability

Please don't open a public issue.

1. Go to this repository's **Security** tab and click **Report a
   vulnerability**. If you can't, email the address in
   [MAINTAINERS.md](MAINTAINERS.md).

2. Include a description, steps to reproduce, the possible impact, and a fix
   if you have one.

We aim to reply within a week. There are no releases yet, so only the latest
`main` branch is supported.

## Things to know

- The toolkit never stores an API key. The host passes in the AI provider
  (`tools/utils/ai.js`) and is responsible for its key. For example,
  `server/` reads `GEMINI_API_KEY` from its environment and keeps it while it
  runs, so whoever deploys it is responsible for that key.
- Keep profile ids private. The onboarding service's routes have no login on
  purpose, so anyone with a profile id can use that profile (see
  [onboarding/README.md](onboarding/README.md)).
- The hosted service uses bearer tokens (see
  [server/README.md](server/README.md) before deploying). It sends the Gemini
  key in a request header, not in the URL, so the key stays out of access
  logs.
- The CLI may download axe-core. `session audit` uses the bundled
  `cli/axe-core.min.js`. If that file is missing, the CLI downloads the same
  version from cdnjs over HTTPS without an integrity check and saves it next
  to the package. If you don't want any network requests, check that the
  bundled file is there.
- Sharing a profile with another app needs a grant that the user can revoke
  (`toolkit/sync/grants.js`). Free text and confidence scores are never shared
  through a grant.

## For contributors

1. Don't use `innerHTML` with user or AI-generated content unless you sanitize
   it.
2. Don't use `eval()`, `Function()` or similar.
3. Use `textContent` to insert text.
4. Validate everything from outside sources, including AI responses and user
   input.
5. Keep dependencies up to date.
