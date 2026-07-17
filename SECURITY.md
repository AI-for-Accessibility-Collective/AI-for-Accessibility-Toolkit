# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in the AI for Accessibility Toolkit, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers directly at [dcelin@stanford.edu](mailto:dcelin@stanford.edu)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

### API Keys

- Gemini API keys are stored in `chrome.storage.local`, which is encrypted at rest by Chrome
- Keys are transmitted only to Google's API endpoints over HTTPS
- The extension never logs or transmits API keys elsewhere

### Content Script Execution

- Content scripts run in an isolated world separate from page scripts
- AI-generated text content uses `textContent` for safe DOM insertion
- Reader mode sanitizes extracted HTML before `innerHTML` insertion (tag/attribute allowlist)
- We do not use `eval()` or `document.write()`

### Data Handling

- User preferences are stored locally in `chrome.storage.sync`
- No user data is transmitted to third parties (except Gemini API for AI features)
- Custom adapters are linted before execution but are **not** sandboxed — they are registered as Chrome user scripts and run with full page access, which is why the extension warns users to only install adapters they trust

### Dependencies

- We minimize dependencies and audit them regularly
- Third-party libraries (axe-core, DarkReader, Readability) are bundled and version-locked

## Security Best Practices for Contributors

1. Never use `innerHTML` with user/AI-generated content without escaping
2. Avoid `eval()`, `Function()`, and similar dynamic code execution
3. Use `textContent` for text-only insertions
4. Validate all inputs from external sources (AI responses, user input)
5. Keep dependencies up to date

## Acknowledgments

We thank our security researchers and community members who help keep this project secure.
