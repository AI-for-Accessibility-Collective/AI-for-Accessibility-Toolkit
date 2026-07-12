const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8766;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (filePath.endsWith('/')) filePath += 'index.html';

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Server on http://localhost:${PORT}`);

  // Use a simple fetch + JSDOM approach to check modules load
  // But since skills are browser-only, let's just test the bundled output parses

  // Test 1: Check the bundle parses as valid JS
  const bundlePath = path.join(ROOT, 'extension/content/content.bundle.js');
  try {
    const bundleCode = fs.readFileSync(bundlePath, 'utf8');
    new Function(bundleCode);
    console.log('PASS: Bundle parses as valid JavaScript');
  } catch (e) {
    console.log('FAIL: Bundle parse error:', e.message);
  }

  // Test 2: Check all skill files exist and are non-empty
  const skillDir = path.join(ROOT, 'skills/builtin');
  const expectedSkills = [
    'dark-mode', 'focus-mode', 'visual-assist', 'motion-reducer',
    'reader-mode', 'keyboard-nav', 'auto-alt-text', 'fix-contrast',
    'simplify-text', 'voice-commands', 'auto-captions', 'color-filter',
    'read-aloud', 'generate-labels', 'generate-captions', 'wcag-fixes'
  ];

  for (const skill of expectedSkills) {
    const fp = path.join(skillDir, `${skill}.js`);
    try {
      const stat = fs.statSync(fp);
      if (stat.size > 100) {
        console.log(`PASS: ${skill}.js exists (${stat.size} bytes)`);
      } else {
        console.log(`FAIL: ${skill}.js too small (${stat.size} bytes)`);
      }
    } catch {
      console.log(`FAIL: ${skill}.js not found`);
    }
  }

  // Test 3: Check deleted files don't exist
  for (const old of ['large-cursor.js', 'dyslexia-font.js']) {
    const fp = path.join(skillDir, old);
    if (fs.existsSync(fp)) {
      console.log(`FAIL: ${old} should be deleted but still exists`);
    } else {
      console.log(`PASS: ${old} correctly removed`);
    }
  }

  // Test 4: Check utils exist and have correct exports
  const utilsDir = path.join(ROOT, 'utils');
  for (const util of ['ai.js', 'dom.js', 'color.js', 'constants.js']) {
    const fp = path.join(utilsDir, util);
    try {
      const content = fs.readFileSync(fp, 'utf8');
      if (content.length > 50) {
        console.log(`PASS: utils/${util} exists (${content.length} chars)`);
      } else {
        console.log(`FAIL: utils/${util} too small`);
      }
    } catch {
      console.log(`FAIL: utils/${util} not found`);
    }
  }

  // Test 5: Check registry has all 16 skills
  const registryPath = path.join(ROOT, 'skills/registry.js');
  const registryContent = fs.readFileSync(registryPath, 'utf8');
  for (const skill of expectedSkills) {
    if (registryContent.includes(`id: '${skill}'`)) {
      console.log(`PASS: registry contains '${skill}'`);
    } else {
      console.log(`FAIL: registry missing '${skill}'`);
    }
  }

  // Test 6: Check content.js imports all 16 skills
  const contentPath = path.join(ROOT, 'extension/content/content.js');
  const contentCode = fs.readFileSync(contentPath, 'utf8');
  const importChecks = {
    'DarkMode': 'dark-mode', 'FocusMode': 'focus-mode', 'VisualAssist': 'visual-assist',
    'MotionReducer': 'motion-reducer', 'ReaderMode': 'reader-mode', 'KeyboardNav': 'keyboard-nav',
    'AutoAltText': 'auto-alt-text', 'FixContrast': 'fix-contrast', 'SimplifyText': 'simplify-text',
    'VoiceCommands': 'voice-commands', 'AutoCaptions': 'auto-captions', 'ColorFilter': 'color-filter',
    'ReadAloud': 'read-aloud', 'GenerateLabels': 'generate-labels',
    'GenerateCaptions': 'generate-captions', 'WcagFixes': 'wcag-fixes'
  };

  for (const [cls, file] of Object.entries(importChecks)) {
    if (contentCode.includes(cls) && contentCode.includes(file)) {
      console.log(`PASS: content.js imports ${cls} from ${file}`);
    } else {
      console.log(`FAIL: content.js missing import for ${cls}/${file}`);
    }
  }

  // Test 7: Check content.js has TOOL_MAP and AI_TOOL_MAP with key modules
  const toolMapChecks = ['DarkMode', 'FocusMode', 'VisualAssist', 'MotionReducer',
    'ReaderMode', 'ColorBlindMode', 'KeyboardNavigator', 'VoiceCommands', 'ReadAloud'];
  for (const tool of toolMapChecks) {
    if (contentCode.includes(tool)) {
      console.log(`PASS: content.js TOOL_MAP has '${tool}'`);
    } else {
      console.log(`FAIL: content.js TOOL_MAP missing '${tool}'`);
    }
  }
  const aiMapChecks = ['fixContrast', 'autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoCaptions', 'autoSimplify'];
  for (const key of aiMapChecks) {
    if (contentCode.includes(key)) {
      console.log(`PASS: content.js AI_TOOL_MAP has '${key}'`);
    } else {
      console.log(`FAIL: content.js AI_TOOL_MAP missing '${key}'`);
    }
  }

  // Test 8: Verify each skill file exports enable/disable/toggle
  for (const skill of expectedSkills) {
    const fp = path.join(skillDir, `${skill}.js`);
    const code = fs.readFileSync(fp, 'utf8');
    const hasEnable = code.includes('enable(') || code.includes('enable ()');
    const hasDisable = code.includes('disable(') || code.includes('disable ()');
    const hasToggle = code.includes('toggle(') || code.includes('toggle ()');

    if (hasEnable && hasDisable && hasToggle) {
      console.log(`PASS: ${skill}.js has enable/disable/toggle`);
    } else {
      const missing = [];
      if (!hasEnable) missing.push('enable');
      if (!hasDisable) missing.push('disable');
      if (!hasToggle) missing.push('toggle');
      console.log(`FAIL: ${skill}.js missing: ${missing.join(', ')}`);
    }
  }

  // Test 9: Check popup has key controls matching reference project UI
  const popupPath = path.join(ROOT, 'extension/popup/popup.js');
  const popupCode = fs.readFileSync(popupPath, 'utf8');
  const popupHtmlPath = path.join(ROOT, 'extension/popup/popup.html');
  const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

  const popupControls = ['dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide',
    'darkMode', 'readerMode', 'focusMode', 'keyboardNav', 'voiceCommands', 'motionReducer',
    'fixContrast', 'autoWcagFix', 'autoDescribe', 'autoFixLabels', 'autoCaptions', 'autoSimplify',
    'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode', 'colorBlindMode'];
  for (const ctrl of popupControls) {
    if (popupHtml.includes(`id="${ctrl}"`) && popupCode.includes(ctrl)) {
      console.log(`PASS: popup has control '${ctrl}'`);
    } else {
      console.log(`FAIL: popup missing control '${ctrl}'`);
    }
  }

  // Verify access-need presets exist (functional, not diagnosis-based)
  const profiles = ['screenReader', 'biggerText', 'colorAdjust', 'captions', 'altInput',
    'simplerContent', 'fewerDistractions', 'lessMotion', 'dimmerDisplay', 'readingHelp'];
  for (const p of profiles) {
    if (popupCode.includes(`${p}:`)) {
      console.log(`PASS: popup has access-need preset '${p}'`);
    } else {
      console.log(`FAIL: popup missing access-need preset '${p}'`);
    }
  }

  // Test 9b: cross-app sharing UI (Phase 3 inc 4) — the grants panel, the
  // sharing switch, the acting-user selector, and their background routes.
  const sharingControls = ['sharingToggle', 'grantList', 'actingUserInput', 'actingUserSwitch',
    'exportProfileBtn', 'importProfileBtn'];
  for (const ctrl of sharingControls) {
    if (popupHtml.includes(`id="${ctrl}"`) && popupCode.includes(ctrl)) {
      console.log(`PASS: popup has sharing control '${ctrl}'`);
    } else {
      console.log(`FAIL: popup missing sharing control '${ctrl}'`);
    }
  }
  const bgPath = path.join(ROOT, 'extension/background.js');
  const bgCode = fs.readFileSync(bgPath, 'utf8');
  const sharingRoutes = ['librarianListGrants', 'librarianRevokeGrant', 'librarianSetSharingPaused',
    'librarianRequestGrant', 'librarianImportInsight', 'librarianExportAbilityModel',
    'librarianGetActingUser', 'librarianSetActingUser',
    'librarianExportProfileBlob', 'librarianImportProfileBlob'];
  for (const r of sharingRoutes) {
    if (bgCode.includes(`case '${r}'`)) {
      console.log(`PASS: background routes '${r}'`);
    } else {
      console.log(`FAIL: background missing route '${r}'`);
    }
  }
  // The popup resolves grant/insight proposals ONLY via the shared proposal
  // cards (librarianRespondToProposal) — no bespoke approve path.
  if (!popupCode.includes('librarianApproveGrant') && popupCode.includes('librarianRespondToProposal')) {
    console.log('PASS: grants resolve through the shared proposal/consent path');
  } else {
    console.log('FAIL: grants must resolve via librarianRespondToProposal only');
  }

  // Test 9c: voice mode — full toolkit control. The tool surface, the SW
  // data routes, the prompt's grounding, and the panel affordances have to
  // stay wired together; each check pins one seam.
  const voiceToolsCode = fs.readFileSync(path.join(ROOT, 'extension/offscreen/src/live/tools.js'), 'utf8');
  const voicePromptCode = fs.readFileSync(path.join(ROOT, 'extension/offscreen/src/live/prompt.js'), 'utf8');
  const voiceRoutesCode = fs.readFileSync(path.join(ROOT, 'extension/voice-routes.js'), 'utf8');
  const offscreenIndexCode = fs.readFileSync(path.join(ROOT, 'extension/offscreen/src/index.js'), 'utf8');
  const sidepanelHtml = fs.readFileSync(path.join(ROOT, 'extension/sidepanel/sidepanel.html'), 'utf8');
  const sidepanelStore = fs.readFileSync(path.join(ROOT, 'extension/sidepanel/src/store.js'), 'utf8');
  const sidepanelTranscript = fs.readFileSync(path.join(ROOT, 'extension/sidepanel/src/ui/transcript.js'), 'utf8');

  const voiceTools = [
    'get_context', 'adjust_settings', 'undo_last_change', 'get_page_content',
    'start_browser_task', 'get_browser_status', 'stop_browser_task',
    'suggest_capabilities', 'get_memory', 'remember', 'forget_memory', 'respond_to_proposal',
  ];
  for (const t of voiceTools) {
    if (voiceToolsCode.includes(`'${t}'`)) console.log(`PASS: voice tool '${t}' declared`);
    else console.log(`FAIL: voice tool '${t}' missing from tools.js`);
  }
  for (const t of voiceTools) {
    if (voicePromptCode.includes(t)) console.log(`PASS: prompt mentions '${t}'`);
    else console.log(`FAIL: prompt never mentions tool '${t}'`);
  }
  if (voicePromptCode.includes('settingsPromptLines') && voiceToolsCode.includes("skills/registry.js'")) {
    console.log('PASS: prompt + tool schema generated from skills/registry.js (single vocabulary source)');
  } else {
    console.log('FAIL: voice vocabulary must come from skills/registry.js');
  }
  if (/read the exact memory back|forget_memory is permanent/i.test(voicePromptCode) && /explicit yes/i.test(voicePromptCode)) {
    console.log('PASS: prompt enforces read-back + explicit yes before forget');
  } else {
    console.log('FAIL: prompt missing forget confirmation rules');
  }
  for (const r of ['voiceGetContext', 'voiceApplySettings', 'voiceUndoLast', 'voiceResetUndo', 'voiceReadPage', 'voiceSuggestCapabilities', 'voiceGetMemory']) {
    if (voiceRoutesCode.includes(`'${r}'`)) console.log(`PASS: SW voice route '${r}'`);
    else console.log(`FAIL: SW missing voice route '${r}'`);
  }
  // Undo journal is SW-owned (survives a lost response) and uses the Librarian
  // delete primitive so a created record is removed, not shadowed.
  if (voiceRoutesCode.includes('UNDO_STACK_KEY') && voiceRoutesCode.includes('removeScopedSetting')) {
    console.log('PASS: SW owns the undo journal + deletes created records on undo');
  } else {
    console.log('FAIL: undo journal must be SW-owned and use removeScopedSetting');
  }
  const librarianSrc = fs.readFileSync(path.join(ROOT, '..', 'toolkit/core/librarian.js'), 'utf8');
  if (librarianSrc.includes('removeScopedSetting') && librarianSrc.includes('hasScopedSetting')) {
    console.log('PASS: Librarian exposes the scoped-setting delete primitive');
  } else {
    console.log('FAIL: Librarian missing removeScopedSetting/hasScopedSetting');
  }
  if (/appliedToPage|reload/.test(voicePromptCode)) {
    console.log('PASS: prompt tells the model to relay the "applies on reload" case');
  } else {
    console.log('FAIL: prompt missing the not-applied-live honesty rule');
  }
  if (bgCode.includes("importScripts('voice-routes.js')")) {
    console.log('PASS: background imports voice-routes.js');
  } else {
    console.log('FAIL: background must importScripts voice-routes.js');
  }
  for (const t of ['voiceTextTurn', 'voiceUndoLast', 'voiceDebugToolCall']) {
    if (offscreenIndexCode.includes(`'${t}'`)) console.log(`PASS: offscreen handles '${t}'`);
    else console.log(`FAIL: offscreen missing message type '${t}'`);
  }
  if (sidepanelHtml.includes('vp-text-input') && sidepanelHtml.includes('vp-proposals')) {
    console.log('PASS: side panel has typed input + proposal pill');
  } else {
    console.log('FAIL: side panel missing typed input or proposal pill');
  }
  if (sidepanelStore.includes("role === 'action'") && sidepanelTranscript.includes('vp-msg-action')) {
    console.log('PASS: side panel renders action chips');
  } else {
    console.log('FAIL: side panel action-chip pipeline incomplete');
  }
  // VisualAssist live-apply must always send the full merged group (a
  // partial patch clobbers the other visual settings).
  if (/VisualAssist/.test(voiceRoutesCode) && /readingGuide: merged\('readingGuide'\)/.test(voiceRoutesCode)) {
    console.log('PASS: voice route sends the full merged VisualAssist group');
  } else {
    console.log('FAIL: voice route must merge the full VisualAssist options object');
  }

  // Test 10: Check that the bundle function constructor doesn't throw
  // (This validates the bundled code is syntactically valid in a broader context)
  const bundleCode2 = fs.readFileSync(bundlePath, 'utf8');
  try {
    // Wrap in try so Node doesn't crash
    new Function('window', 'document', 'chrome', 'navigator', 'location', 'history',
      'speechSynthesis', 'SpeechSynthesisUtterance', 'getComputedStyle', 'requestAnimationFrame',
      'requestIdleCallback', 'MutationObserver', 'CSS', 'XMLSerializer', 'Image', 'Event',
      bundleCode2);
    console.log('PASS: Bundle is valid JS with browser globals');
  } catch (e) {
    console.log('FAIL: Bundle validation error:', e.message);
  }

  // Test 11: Wiring guard tests
  // -----------------------------------------------------------------------
  // Parse registry entries from source text (registry.js is ESM; run-tests is
  // CJS so we extract the settings blocks via regex rather than dynamic import).
  function extractRegistryEntries(src) {
    // Extract each entry's id and settings keys via simple regex scan.
    const entries = [];
    const idRe = /id:\s*'([^']+)'/g;
    const settingsBlockRe = /settings:\s*\{([^}]*)\}/g;
    // Find all id: and settings: occurrences and pair them by index proximity.
    const ids = []; let m;
    while ((m = idRe.exec(src)) !== null) ids.push({ id: m[1], idx: m.index });
    const settingsBlocks = [];
    while ((m = settingsBlockRe.exec(src)) !== null) settingsBlocks.push({ keys: Object.keys(new Function(`return {${m[1]}}`)() || {}), idx: m.index });
    // Pair each id with the next settings block
    for (let i = 0; i < ids.length; i++) {
      const nextBlock = settingsBlocks.find(s => s.idx > ids[i].idx && (i + 1 >= ids.length || s.idx < ids[i + 1].idx));
      entries.push({ id: ids[i].id, settingsKeys: nextBlock ? nextBlock.keys : [] });
    }
    return entries;
  }

  // (a) No two registry entries share a settings key.
  //     Documented allowlist:
  //       - autoCaptions: shared by auto-captions/generate-captions until the
  //         W3 merge (same module wired, not a bug)
  //       - lineHeight, letterSpacing, dyslexiaFont: visual-assist piggyback
  //         keys also set by the dyslexia-font registry entry
  const SHARED_KEY_ALLOWLIST = new Set([
    'autoCaptions',    // auto-captions + generate-captions until merged
    'lineHeight',      // dyslexia-font piggybacks visual-assist keys
    'letterSpacing',   // dyslexia-font piggybacks visual-assist keys
    'dyslexiaFont',    // dyslexia-font piggybacks visual-assist keys
  ]);
  {
    const entries = extractRegistryEntries(registryContent);
    const keyToEntryIds = {};
    for (const entry of entries) {
      for (const key of entry.settingsKeys) {
        if (!keyToEntryIds[key]) keyToEntryIds[key] = [];
        keyToEntryIds[key].push(entry.id);
      }
    }
    let sharedOk = true;
    for (const [key, ids] of Object.entries(keyToEntryIds)) {
      if (ids.length > 1 && !SHARED_KEY_ALLOWLIST.has(key)) {
        console.log(`FAIL: settings key '${key}' shared by [${ids.join(', ')}] — not in allowlist`);
        sharedOk = false;
      }
    }
    if (sharedOk) console.log('PASS: no unexpected shared settings keys across registry entries');
  }

  // (b) Every registry entry has at least one settings key with an enable
  //     path in content.js source. Entries with empty settings ({}) are exempt
  //     (read-aloud has no persistent toggle key — it is triggered imperatively).
  {
    const entries = extractRegistryEntries(registryContent);
    for (const entry of entries) {
      const keys = entry.settingsKeys;
      if (keys.length === 0) {
        console.log(`PASS: ${entry.id} has no settings keys (imperative trigger — exempt)`);
        continue;
      }
      const hasEnablePath = keys.some(k => contentCode.includes(k));
      if (hasEnablePath) {
        console.log(`PASS: ${entry.id} has a settings key wired in content.js`);
      } else {
        console.log(`FAIL: ${entry.id} settings keys [${keys.join(', ')}] have no enable path in content.js`);
      }
    }
  }

  // (c) Builtins use call-time logFix — no module-scope const capture pattern.
  //     The bad pattern: `const logFix = globalThis.ai4a11yLogFix || ...`
  //     (captured at import time before content.js assigns the global).
  {
    const builtinDir = path.join(ROOT, 'skills/builtin');
    const builtinFiles = fs.readdirSync(builtinDir).filter(f => f.endsWith('.js'));
    // Match: start of line (after any whitespace), then `const logFix = globalThis.`
    const badPattern = /^\s*const\s+(logFix|incrementStat)\s*=\s*globalThis\./m;
    let allCallTime = true;
    for (const file of builtinFiles) {
      const code = fs.readFileSync(path.join(builtinDir, file), 'utf8');
      if (badPattern.test(code)) {
        console.log(`FAIL: ${file} uses module-scope globalThis capture for logFix/incrementStat`);
        allCallTime = false;
      }
    }
    if (allCallTime) console.log('PASS: all builtins use call-time logFix/incrementStat lookup');
  }

  // ---------------------------------------------------------------------------
  // Test 12: reader-mode static checks (1.1 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const readerPath = path.join(ROOT, 'skills/builtin/reader-mode.js');
    const readerCode = fs.readFileSync(readerPath, 'utf8');

    // (a) Imports @mozilla/readability (both named exports used).
    if (/from\s+['"]@mozilla\/readability['"]/. test(readerCode) &&
        readerCode.includes('Readability') &&
        readerCode.includes('isProbablyReaderable')) {
      console.log('PASS: reader-mode.js imports @mozilla/readability (Readability + isProbablyReaderable)');
    } else {
      console.log('FAIL: reader-mode.js missing @mozilla/readability import');
    }

    // (b) Imports dompurify.
    if (/from\s+['"]dompurify['"]/i.test(readerCode) &&
        readerCode.includes('DOMPurify')) {
      console.log('PASS: reader-mode.js imports dompurify');
    } else {
      console.log('FAIL: reader-mode.js missing dompurify import');
    }

    // (c) No hand-rolled sanitizer remnants: the old javascript:-scheme
    //     scrubbing block is gone (it was 23 lines of manual attribute checks).
    const hasJsSchemeBlock = /javascript:\s*['"]/i.test(readerCode) &&
                              readerCode.includes('vbscript:') &&
                              readerCode.includes('dangerousUrlAttrs');
    if (!hasJsSchemeBlock) {
      console.log('PASS: reader-mode.js has no hand-rolled javascript:/vbscript: sanitizer block');
    } else {
      console.log('FAIL: reader-mode.js still contains the old hand-rolled sanitizer — replace with DOMPurify');
    }

    // (d) Uses inert attribute for SR safety (load-bearing: page background
    //     must be unreachable to Tab + SR virtual cursor while overlay is open).
    if (readerCode.includes("setAttribute('inert'") || readerCode.includes('setAttribute("inert"')) {
      console.log("PASS: reader-mode.js uses inert attribute for SR-safe background isolation");
    } else {
      console.log("FAIL: reader-mode.js missing inert attribute usage for SR safety");
    }

    // (e) Protects the #ai4a11y-announcer from being inerted (would silence
    //     announce() for screen-reader users — this is load-bearing).
    if (readerCode.includes('ai4a11y-announcer')) {
      console.log('PASS: reader-mode.js explicitly spares #ai4a11y-announcer from inert');
    } else {
      console.log('FAIL: reader-mode.js must skip #ai4a11y-announcer when setting inert');
    }

    // (f) Uses a closed shadow root (page CSS isolation).
    if (readerCode.includes("mode: 'closed'") || readerCode.includes('mode:"closed"') || readerCode.includes("mode: \"closed\"")) {
      console.log("PASS: reader-mode.js attaches a closed shadow root");
    } else {
      console.log("FAIL: reader-mode.js missing closed shadow root — page CSS can restyle content");
    }

    // (g) SPA teardown via registerSweep from observe.js.
    if (readerCode.includes('registerSweep') && readerCode.includes('observe.js')) {
      console.log('PASS: reader-mode.js registers SPA URL-change sweep via observe.js');
    } else {
      console.log('FAIL: reader-mode.js missing registerSweep(observe.js) for SPA teardown');
    }

    // (h) Dead originalContent capture is gone (was line 33 of the old file).
    if (!readerCode.includes('originalContent')) {
      console.log('PASS: reader-mode.js has no dead originalContent capture');
    } else {
      console.log('FAIL: reader-mode.js still references originalContent — remove it');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 13: visual-assist static checks (1.4 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const vaPath = path.join(ROOT, 'skills/builtin/visual-assist.js');
    const vaCode = fs.readFileSync(vaPath, 'utf8');

    // (a) No html { zoom } rule — fontScale must use computed-style traversal.
    if (!vaCode.includes('html { zoom') && !vaCode.includes('html{zoom')) {
      console.log('PASS: visual-assist.js has no html { zoom } rule (fontScale uses computed-style traversal)');
    } else {
      console.log('FAIL: visual-assist.js still contains html { zoom } — must use computed-style traversal');
    }

    // (b) :focus-visible is present and bare *:focus { is absent.
    const hasFocusVisible = vaCode.includes(':focus-visible');
    const hasBareStarFocus = /\*:focus\s*[,{]/.test(vaCode);
    if (hasFocusVisible && !hasBareStarFocus) {
      console.log('PASS: visual-assist.js uses :focus-visible only (no bare *:focus { )');
    } else if (!hasFocusVisible) {
      console.log('FAIL: visual-assist.js missing :focus-visible selector');
    } else {
      console.log('FAIL: visual-assist.js contains bare *:focus { — must be :focus-visible only');
    }

    // (c) applyProfileSettings in content.js merges baseline before building the
    //     VA options object (profile-wipe fix). Look for the chrome.storage.sync.get
    //     call inside the vaKeys block.
    const contentPath = path.join(ROOT, 'extension/content/content.js');
    const contentSrc = fs.readFileSync(contentPath, 'utf8');
    // The fix introduces a chrome.storage.sync.get(vaKeys, ...) callback inside
    // the vaKeys block; the old code had a direct object literal with hardcoded defaults.
    if (contentSrc.includes('chrome.storage.sync.get(vaKeys') &&
        contentSrc.includes('Merge the stored baseline')) {
      console.log('PASS: applyProfileSettings merges stored baseline before applying VA settings');
    } else {
      console.log('FAIL: applyProfileSettings missing stored-baseline merge for VA keys (profile-wipe bug)');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 14: motion-reducer static guards (1.5 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const mrPath = path.join(ROOT, 'skills/builtin/motion-reducer.js');
    const mrCode = fs.readFileSync(mrPath, 'utf8');

    // (a) No class-substring transform:none rule
    if (!/\[class\*=["'](?:scroll|slide|carousel|animate|motion|move)["']\]/.test(mrCode)) {
      console.log('PASS: no class-substring transform:none rule in motion-reducer');
    } else {
      console.log('FAIL: motion-reducer still has class-substring transform:none heuristic — breaks layout');
    }

    // (b) getAnimations referenced (WAAPI support)
    if (mrCode.includes('getAnimations')) {
      console.log('PASS: motion-reducer calls document.getAnimations() for WAAPI');
    } else {
      console.log('FAIL: motion-reducer missing document.getAnimations() — WAAPI animations not handled');
    }

    // (c) aria-label set on frozen canvas (not just alt which confers no name)
    if (mrCode.includes('aria-label')) {
      console.log('PASS: motion-reducer sets aria-label on frozen canvas');
    } else {
      console.log('FAIL: motion-reducer missing aria-label on frozen canvas — canvas alt confers no accessible name');
    }

    // (d) Extension UI exemption in CSS
    if (mrCode.includes('ai4a11y-') && (mrCode.includes(':not(') || mrCode.includes('not('))) {
      console.log('PASS: motion-reducer CSS exempts extension UI elements');
    } else {
      console.log('FAIL: motion-reducer CSS missing extension UI exemption');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 15: background.js has fetchImageBytes route
  // ---------------------------------------------------------------------------
  {
    if (bgCode.includes("'fetchImageBytes'") || bgCode.includes('"fetchImageBytes"')) {
      console.log('PASS: background.js has fetchImageBytes route for cross-origin image freeze');
    } else {
      console.log('FAIL: background.js missing fetchImageBytes route');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 16: fix-contrast static checks (1.2 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const fcPath = path.join(ROOT, 'skills/builtin/fix-contrast.js');
    const fcCode = fs.readFileSync(fcPath, 'utf8');
    const colorPath = path.join(ROOT, 'utils/color.js');
    const colorCode = fs.readFileSync(colorPath, 'utf8');

    // (a) fix-contrast imports from utils/color.js (not just ai.js)
    if (fcCode.includes("from '../../utils/color.js'") || fcCode.includes('from "../../utils/color.js"')) {
      console.log('PASS: fix-contrast imports from utils/color.js');
    } else {
      console.log('FAIL: fix-contrast must import from utils/color.js');
    }

    // (b) No aiFixContrast in the sweep path — deterministic path has no LLM call.
    //     Allow it only if it's in a dead-code comment or stub, not a live call.
    const sweepSection = fcCode.replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!sweepSection.includes('aiFixContrast(')) {
      console.log('PASS: no aiFixContrast call in the fix-contrast sweep path');
    } else {
      console.log('FAIL: fix-contrast sweep path must not call aiFixContrast (deterministic path only)');
    }

    // (c) meetsContrastAA referenced in fix-contrast
    if (fcCode.includes('meetsContrastAA')) {
      console.log('PASS: meetsContrastAA referenced in fix-contrast.js');
    } else {
      console.log('FAIL: fix-contrast.js does not reference meetsContrastAA — AA gate missing');
    }

    // (d) utils/color.js exports meetsContrastAA (the function exists, was imported by nothing before)
    if (colorCode.includes('export function meetsContrastAA')) {
      console.log('PASS: utils/color.js exports meetsContrastAA');
    } else {
      console.log('FAIL: utils/color.js missing meetsContrastAA export');
    }

    // (e) utils/color.js exports the new API surface
    for (const fn of ['parseColor', 'contrastWCAG21', 'compositeOver', 'nearestAccessibleColor', 'contrastAPCA']) {
      if (colorCode.includes(`export function ${fn}`)) {
        console.log(`PASS: utils/color.js exports ${fn}`);
      } else {
        console.log(`FAIL: utils/color.js missing export ${fn}`);
      }
    }

    // (f) No import of aiFixContrast in fix-contrast.js
    const hasAiImport = /import[^;]*aiFixContrast[^;]*from/.test(fcCode);
    if (!hasAiImport) {
      console.log('PASS: fix-contrast.js does not import aiFixContrast');
    } else {
      console.log('FAIL: fix-contrast.js must not import aiFixContrast (deterministic, no LLM in correctness path)');
    }

    // (g) registerSweep imported from observe.js for incremental re-scan
    if (fcCode.includes("from '../../utils/observe.js'") || fcCode.includes('from "../../utils/observe.js"')) {
      console.log('PASS: fix-contrast imports registerSweep from observe.js');
    } else {
      console.log('FAIL: fix-contrast missing registerSweep import from observe.js');
    }
  }

  console.log('\n=== DONE ===');

  server.close();
  process.exit(0);
});
