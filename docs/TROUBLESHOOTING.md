# Troubleshooting

Common issues and solutions for the AI for Accessibility Toolkit.

## Chrome Extension

### Extension not loading

**Symptoms:** Extension doesn't appear in Chrome toolbar or content script doesn't run.

**Solutions:**
1. Verify extension is enabled at `chrome://extensions`
2. Check for manifest errors in the extension card
3. Rebuild: `npm run build`
4. Reload the extension after building

### AI features not working

**Symptoms:** Alt text not generated, text not simplified, "API key not set" errors.

**Solutions:**
1. Open extension popup → Settings
2. Verify Gemini API key is entered correctly
3. Test the key at [Google AI Studio](https://aistudio.google.com/)
4. Check browser console for API errors (F12 → Console)

**Rate limits:** Free tier allows 15 requests/minute, 1500/day. For heavier use, enable billing in [Google Cloud Console](https://console.cloud.google.com/).

### Visual settings not applying

**Symptoms:** Font size, dark mode, or other visual settings don't change the page.

**Solutions:**
1. Check if the site uses `!important` CSS (may override our styles)
2. Try a different site to isolate the issue
3. Open DevTools → Check for `ai4a11y-*` style tags in `<head>`
4. Some sites (Google Docs, Figma) run in iframes that block content scripts

### Content script errors

**Symptoms:** Red errors in browser console mentioning `content.bundle.js`.

**Solutions:**
1. Rebuild: `npm run build`
2. Check `extension/src/content.js` for syntax errors
3. Reload extension and refresh the page

## CLI

### `ai4a11y: command not found`

**Solutions:**
1. Reinstall: `pip install -e .`
2. Check your PATH includes pip's bin directory
3. Try: `python -m ai4a11y.cli`

### Browser session issues

**Symptoms:** `session start` fails or browser doesn't launch.

**Solutions:**
1. Install Playwright browsers: `playwright install`
2. Check for existing Playwright processes: `pkill -f playwright`
3. Try with visible browser: session commands show a Chromium window by default

### Claude API errors

**Symptoms:** `ANTHROPIC_API_KEY not set` or API errors in describe/audit commands.

**Solutions:**
1. Set environment variable: `export ANTHROPIC_API_KEY=sk-...`
2. Add to shell profile (`~/.bashrc`, `~/.zshrc`)
3. Verify key at [Anthropic Console](https://console.anthropic.com/)

## Voice/Text Control Web Apps

### Backend won't start

**Symptoms:** `uvicorn` fails or "module not found" errors.

**Solutions:**
```bash
cd webapp/voicecontrol/backend  # or textcontrol
uv venv && uv pip install -e .
uv pip install -e ../../browser-harness
```

### Chrome not connecting

**Symptoms:** "CDP not reachable" or "browser-harness daemon not available".

**Solutions:**
1. Launch Chrome with remote debugging:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir=/tmp/chrome-debug
   ```
2. Verify Chrome is listening: `curl http://localhost:9222/json/version`
3. Check no other process uses port 9222

### Voice not working

**Symptoms:** Mic button doesn't respond or no audio playback.

**Solutions:**
1. Allow microphone access when prompted
2. Check browser permissions: `chrome://settings/content/microphone`
3. Verify mic works in another app
4. Check WebSocket connection status in the UI

### WebSocket disconnects

**Symptoms:** Frequent "connecting..." status or dropped sessions.

**Solutions:**
1. Check backend logs for errors
2. Ensure stable network connection
3. Voice control uses Gemini Live API which requires real-time streaming

## Personalized Extension

### Onboarding flow issues

**Symptoms:** Onboarding doesn't start or recommendations don't appear.

**Solutions:**
1. Clear extension storage: DevTools → Application → Storage → Clear
2. Rebuild: `cd personalized-extension && npm run build`
3. Check for Gemini API key in the onboarding flow

### Custom skills not running

**Symptoms:** Saved skills don't apply to pages.

**Solutions:**
1. Chrome 120+ required for userScripts API
2. Enable Developer Mode at `chrome://extensions`
3. Check skill is enabled in extension popup
4. View skill errors in DevTools console

### Skill builder lint errors

**Symptoms:** "Code didn't look safe to run" during skill creation.

**Solutions:**
1. Skills cannot use `eval`, `fetch`, `import`, `document.write`
2. For AI-powered skills, choose "With AI" option (uses `chrome.runtime.sendMessage`)
3. Review the generated code in the code viewer

## Build Issues

### `npm run build` fails

**Solutions:**
1. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Check Node version: `node --version` (requires Node 18+)
3. Review esbuild errors in terminal output

### Missing dependencies

**Solutions:**
```bash
npm install                    # Main extension
cd personalized-extension && npm install
pip install -e .               # CLI
```

## Getting Help

If your issue isn't listed:

1. Search [existing issues](https://github.com/chuanenlin/AI-for-Accessibility-Toolkit/issues)
2. Open a new issue with:
   - Browser/OS version
   - Steps to reproduce
   - Console errors (F12 → Console)
   - Extension version
3. Ping [@chuanenlin](https://github.com/chuanenlin) (David)
