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
  // W3 captions merge: auto-captions.js + generate-captions.js → captions.js (16→15 files).
  const skillDir = path.join(ROOT, 'skills/builtin');
  const expectedSkills = [
    'dark-mode', 'focus-mode', 'visual-assist', 'motion-reducer',
    'reader-mode', 'keyboard-nav', 'auto-alt-text', 'fix-contrast',
    'simplify-text', 'voice-commands', 'captions', 'color-filter',
    'read-aloud', 'generate-labels', 'wcag-fixes'
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
  // W3 captions merge: auto-captions.js and generate-captions.js deleted.
  for (const old of ['large-cursor.js', 'dyslexia-font.js', 'auto-captions.js', 'generate-captions.js']) {
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

  // Test 5: Check registry has all 13 skills (W3 merge: 16→15; Phase 3 retirement: 15→13)
  // Retired: large-cursor, dyslexia-font (entries removed; settingsMeta keys kept).
  const registryPath = path.join(ROOT, 'skills/registry.js');
  const registryContent = fs.readFileSync(registryPath, 'utf8');
  for (const skill of expectedSkills) {
    if (registryContent.includes(`id: '${skill}'`)) {
      console.log(`PASS: registry contains '${skill}'`);
    } else {
      console.log(`FAIL: registry missing '${skill}'`);
    }
  }
  // Verify old caption IDs are gone.
  if (registryContent.includes("id: 'auto-captions'")) {
    console.log("FAIL: registry still has old 'auto-captions' entry — should be merged into 'captions'");
  } else {
    console.log("PASS: registry no longer has 'auto-captions' entry");
  }
  if (registryContent.includes("id: 'generate-captions'")) {
    console.log("FAIL: registry still has old 'generate-captions' entry — should be merged into 'captions'");
  } else {
    console.log("PASS: registry no longer has 'generate-captions' entry");
  }
  // Phase 3 retirement: large-cursor and dyslexia-font entries removed.
  if (registryContent.includes("id: 'large-cursor'")) {
    console.log("FAIL: registry still has 'large-cursor' entry — should be retired (Phase 3)");
  } else {
    console.log("PASS: 'large-cursor' registry entry correctly retired");
  }
  if (registryContent.includes("id: 'dyslexia-font'")) {
    console.log("FAIL: registry still has 'dyslexia-font' entry — should be retired (Phase 3)");
  } else {
    console.log("PASS: 'dyslexia-font' registry entry correctly retired");
  }
  // settingsMeta keys must still be present (VA sub-settings for existing users).
  if (registryContent.includes('largeCursor:') && registryContent.includes('dyslexiaFont:')) {
    console.log("PASS: settingsMeta retains largeCursor and dyslexiaFont keys for VA sub-settings");
  } else {
    console.log("FAIL: settingsMeta lost largeCursor or dyslexiaFont — required for existing user VA settings");
  }

  // Test 6: Check content.js imports all 15 skills (W3 captions merge)
  const contentPath = path.join(ROOT, 'extension/content/content.js');
  const contentCode = fs.readFileSync(contentPath, 'utf8');
  const importChecks = {
    'DarkMode': 'dark-mode', 'FocusMode': 'focus-mode', 'VisualAssist': 'visual-assist',
    'MotionReducer': 'motion-reducer', 'ReaderMode': 'reader-mode', 'KeyboardNav': 'keyboard-nav',
    'AutoAltText': 'auto-alt-text', 'FixContrast': 'fix-contrast', 'SimplifyText': 'simplify-text',
    'VoiceCommands': 'voice-commands', 'Captions': 'captions', 'ColorFilter': 'color-filter',
    'ReadAloud': 'read-aloud', 'GenerateLabels': 'generate-labels', 'WcagFixes': 'wcag-fixes'
  };

  for (const [cls, file] of Object.entries(importChecks)) {
    if (contentCode.includes(cls) && contentCode.includes(file)) {
      console.log(`PASS: content.js imports ${cls} from ${file}`);
    } else {
      console.log(`FAIL: content.js missing import for ${cls}/${file}`);
    }
  }
  // Verify dead imports are gone.
  if (contentCode.includes("AutoCaptions") && contentCode.includes("auto-captions")) {
    console.log("FAIL: content.js still imports AutoCaptions from auto-captions.js — deleted in W3 merge");
  } else {
    console.log("PASS: content.js does not import AutoCaptions/auto-captions (correctly deleted)");
  }
  if (contentCode.includes("GenerateCaptions") && contentCode.includes("generate-captions")) {
    console.log("FAIL: content.js still imports GenerateCaptions from generate-captions.js — deleted in W3 merge");
  } else {
    console.log("PASS: content.js does not import GenerateCaptions/generate-captions (correctly deleted)");
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
  //     Documented allowlist: empty after Phase 3 retirement.
  //       - lineHeight, letterSpacing, dyslexiaFont were previously shared
  //         between visual-assist and the now-retired dyslexia-font entry.
  //         With dyslexia-font retired, those keys are no longer shared.
  //     Note: autoCaptions collision (auto-captions + generate-captions) was
  //     removed in W3 merge — now a single 'captions' entry.
  const SHARED_KEY_ALLOWLIST = new Set([
    // (empty — no shared keys expected post Phase 3)
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

  // ---------------------------------------------------------------------------
  // Test 17: auto-alt-text static checks (2.2 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const altPath = path.join(ROOT, 'skills/builtin/auto-alt-text.js');
    const altCode = fs.readFileSync(altPath, 'utf8');

    // (a) computeAccessibleName is imported from dom-accessibility-api.
    if (/computeAccessibleName/.test(altCode) && /dom-accessibility-api/.test(altCode)) {
      console.log('PASS: auto-alt-text.js imports computeAccessibleName from dom-accessibility-api');
    } else {
      console.log('FAIL: auto-alt-text.js missing computeAccessibleName import from dom-accessibility-api');
    }

    // (b) img[alt=""] is NOT in the selector string (would overwrite decorative alt).
    //     The guard: the literal string 'img[alt=""]' must not appear in non-comment code.
    const altCodeNoComments = altCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!altCodeNoComments.includes('img[alt=""]') && !altCodeNoComments.includes("img[alt='']")) {
      console.log('PASS: auto-alt-text.js does not use img[alt=""] selector (decorative images protected)');
    } else {
      console.log('FAIL: auto-alt-text.js contains img[alt=""] selector — would overwrite decorative alt');
    }

    // (c) data-ai4a11y-generated attribute is set on written elements (provenance).
    if (altCode.includes('data-ai4a11y-generated')) {
      console.log('PASS: auto-alt-text.js sets data-ai4a11y-generated for provenance');
    } else {
      console.log('FAIL: auto-alt-text.js missing data-ai4a11y-generated attribute (no provenance)');
    }

    // (d) generateVideoDescription is absent (deleted as planned — dead and destructive).
    if (!altCode.includes('generateVideoDescription')) {
      console.log('PASS: auto-alt-text.js does not export generateVideoDescription (correctly deleted)');
    } else {
      console.log('FAIL: auto-alt-text.js still contains generateVideoDescription — must be deleted');
    }

    // (e) disable() references prev-alt restore (reverts written alt values).
    if (altCode.includes('prev-alt') || altCode.includes('PREV_ALT_ATTR') || altCode.includes('revertAlt')) {
      console.log('PASS: auto-alt-text.js disable() has prev-alt restore logic');
    } else {
      console.log('FAIL: auto-alt-text.js disable() missing prev-alt restore — alt text is not reverted on disable');
    }

    // (f) registerSweep is used (late-loaded images handled via MutationObserver).
    if (altCode.includes('registerSweep') && altCode.includes('observe.js')) {
      console.log('PASS: auto-alt-text.js uses registerSweep from observe.js');
    } else {
      console.log('FAIL: auto-alt-text.js missing registerSweep from observe.js — late-loaded images not handled');
    }

    // (g) Background fetchImageBytes route is used for cross-origin images.
    if (altCode.includes('fetchImageBytes')) {
      console.log('PASS: auto-alt-text.js routes cross-origin images through fetchImageBytes');
    } else {
      console.log('FAIL: auto-alt-text.js missing fetchImageBytes usage — cross-origin images will silently fail');
    }

    // (h) axeHandlers export shape contains expected keys.
    if (altCode.includes("'image-alt'") && altCode.includes("'svg-img-alt'")) {
      console.log('PASS: auto-alt-text.js axeHandlers has image-alt and svg-img-alt keys');
    } else {
      console.log('FAIL: auto-alt-text.js axeHandlers missing image-alt or svg-img-alt key');
    }

    // (i) logFix call includes structured type:'alt-text' (popup fixes panel integration).
    if (altCode.includes("type: 'alt-text'") || altCode.includes("type:'alt-text'")) {
      console.log('PASS: auto-alt-text.js logFix call includes type:alt-text for popup fixes panel');
    } else {
      console.log('FAIL: auto-alt-text.js logFix missing type:alt-text — fixes will not appear in popup panel');
    }

    // (j) Aspect ratio preserved: fitDimensions uses same scale for both axes.
    //     Verify by checking the implementation doesn't independently cap w and h.
    if (altCode.includes('fitDimensions') && altCode.includes('scale')) {
      console.log('PASS: auto-alt-text.js uses fitDimensions with unified scale (aspect ratio preserved)');
    } else {
      console.log('FAIL: auto-alt-text.js missing fitDimensions / unified scale — aspect ratio may be squashed');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 18: simplify-text + generate-labels static guards (2.5 wave)
  // ---------------------------------------------------------------------------
  {
    const stPath = path.join(ROOT, 'skills/builtin/simplify-text.js');
    const stCode = fs.readFileSync(stPath, 'utf8');

    // (a) No textContent = '' wipe — the destroy-children bug is gone.
    const stNoComments = stCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!stNoComments.includes("element.textContent = ''") && !stNoComments.includes('element.textContent=""')) {
      console.log('PASS: simplify-text.js has no element.textContent="" DOM wipe');
    } else {
      console.log('FAIL: simplify-text.js still has element.textContent="" — destroys child nodes (links/em/strong)');
    }

    // (b) 'td' not in the element selector (data corruption fix).
    //     The selector should be 'p, li' only.
    const selectorLine = stNoComments.match(/querySelectorAll\(['"](.*?)['"]\)/);
    const selectorStr = selectorLine ? selectorLine[1] : stNoComments;
    // Check: no standalone 'td' in a querySelectorAll argument.
    const hasTdInSelector = /querySelectorAll\(['"][^'"]*\btd\b[^'"]*['"]\)/.test(stNoComments);
    if (!hasTdInSelector) {
      console.log("PASS: simplify-text.js does not select 'td' elements (data corruption fix)");
    } else {
      console.log("FAIL: simplify-text.js still selects 'td' — must use 'p, li' only");
    }

    // (c) summarizeContent is invoked from the adapter (autoSummarize finally wired).
    if (stCode.includes('summarizeContent')) {
      console.log('PASS: simplify-text.js invokes summarizeContent (autoSummarize feature wired)');
    } else {
      console.log('FAIL: simplify-text.js does not invoke summarizeContent — autoSummarize remains dead code');
    }

    // (d) registerSweep from observe.js (late content handled).
    if (stCode.includes('registerSweep') && stCode.includes('observe.js')) {
      console.log('PASS: simplify-text.js uses registerSweep from observe.js');
    } else {
      console.log('FAIL: simplify-text.js missing registerSweep from observe.js');
    }

    // (e) enabled re-check after await (disable race prevention).
    if ((stCode.match(/if\s*\(!this\.enabled\)/g) || []).length >= 2) {
      console.log('PASS: simplify-text.js re-checks this.enabled after awaits');
    } else {
      console.log('FAIL: simplify-text.js missing enabled re-check after awaits (disable race)');
    }

    // (f) Cache: storage.session or module Map.
    if (stCode.includes('chrome.storage.session') || stCode.includes('_memCache')) {
      console.log('PASS: simplify-text.js has per-URL result cache');
    } else {
      console.log('FAIL: simplify-text.js missing result cache — toggle off/on burns fresh AI calls');
    }

    // (g) aria-label on Show original button tied to content.
    if (stCode.includes('aria-label') && stCode.includes('paragraph')) {
      console.log('PASS: simplify-text.js Show original button has aria-label tied to content');
    } else {
      console.log('FAIL: simplify-text.js Show original button missing aria-label tied to paragraph');
    }

    // (h) DOM-preserving wrapper: ai4a11y-original-content span used.
    if (stCode.includes('ai4a11y-original-content')) {
      console.log('PASS: simplify-text.js uses ai4a11y-original-content wrapper (DOM-preserving)');
    } else {
      console.log('FAIL: simplify-text.js missing ai4a11y-original-content wrapper — not DOM-preserving');
    }
  }

  {
    const glPath = path.join(ROOT, 'skills/builtin/generate-labels.js');
    const glCode = fs.readFileSync(glPath, 'utf8');
    const glNoComments = glCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // (a) computeAccessibleName imported from dom-accessibility-api.
    if (/computeAccessibleName/.test(glCode) && /dom-accessibility-api/.test(glCode)) {
      console.log('PASS: generate-labels.js imports computeAccessibleName from dom-accessibility-api');
    } else {
      console.log('FAIL: generate-labels.js missing computeAccessibleName import from dom-accessibility-api');
    }

    // (b) getAccessibleName (old naive import) no longer imported.
    if (!/import.*getAccessibleName.*from/.test(glCode)) {
      console.log('PASS: generate-labels.js does not import the old getAccessibleName shim');
    } else {
      console.log('FAIL: generate-labels.js still imports getAccessibleName — switch to computeAccessibleName');
    }

    // (c) :not([id]) gone from the form selector.
    if (!glNoComments.includes(':not([id])')) {
      console.log("PASS: generate-labels.js has no :not([id]) in form selector");
    } else {
      console.log("FAIL: generate-labels.js still has :not([id]) — skips unlabeled inputs that have an id");
    }

    // (d) try/catch around inferLabel calls (per-element error isolation).
    //     Check that try appears in every async generate* function body.
    const inferCallCount = (glNoComments.match(/inferLabel\(/g) || []).length;
    const tryCatchCount = (glNoComments.match(/\btry\s*\{/g) || []).length;
    if (inferCallCount > 0 && tryCatchCount >= inferCallCount) {
      console.log('PASS: generate-labels.js has try/catch around all inferLabel calls');
    } else {
      console.log(`FAIL: generate-labels.js missing try/catch around inferLabel (inferCalls=${inferCallCount}, tryCatches=${tryCatchCount})`);
    }

    // (e) isVisible filter used in sweep.
    if (glCode.includes('isVisible')) {
      console.log('PASS: generate-labels.js filters by isVisible');
    } else {
      console.log('FAIL: generate-labels.js missing isVisible filter');
    }

    // (f) data-ai4a11y-generated="label" provenance attribute.
    if (glCode.includes('data-ai4a11y-generated') && glCode.includes('label')) {
      console.log('PASS: generate-labels.js sets data-ai4a11y-generated="label" for provenance');
    } else {
      console.log('FAIL: generate-labels.js missing data-ai4a11y-generated provenance attribute');
    }

    // (g) disable() reverts AI-generated attributes.
    if (glCode.includes('data-ai4a11y-generated') && glCode.includes('removeAttribute')) {
      console.log('PASS: generate-labels.js disable() reverts AI-generated label attributes');
    } else {
      console.log('FAIL: generate-labels.js disable() does not revert AI-generated attributes');
    }

    // (h) registerSweep from observe.js.
    if (glCode.includes('registerSweep') && glCode.includes('observe.js')) {
      console.log('PASS: generate-labels.js uses registerSweep from observe.js');
    } else {
      console.log('FAIL: generate-labels.js missing registerSweep from observe.js');
    }

    // (i) axeHandlers export keys (link-name, button-name, frame-title, label, select-name).
    for (const key of ['link-name', 'button-name', 'frame-title', 'label', 'select-name']) {
      if (glCode.includes(`'${key}'`)) {
        console.log(`PASS: generate-labels.js axeHandlers has '${key}'`);
      } else {
        console.log(`FAIL: generate-labels.js axeHandlers missing '${key}'`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Test 19: utils/ai.js Chrome Summarizer API feature-detect
  // ---------------------------------------------------------------------------
  {
    const aiPath = path.join(ROOT, 'utils/ai.js');
    const aiCode = fs.readFileSync(aiPath, 'utf8');

    if (aiCode.includes("'Summarizer' in self") || aiCode.includes('"Summarizer" in self')) {
      console.log("PASS: utils/ai.js has Chrome Summarizer API feature-detect ('Summarizer' in self)");
    } else {
      console.log("FAIL: utils/ai.js missing Chrome Summarizer API feature-detect");
    }

    if (aiCode.includes('Summarizer.availability') && aiCode.includes('Summarizer.create')) {
      console.log('PASS: utils/ai.js uses Summarizer.availability() and Summarizer.create()');
    } else {
      console.log('FAIL: utils/ai.js missing Summarizer.availability()/create() calls');
    }

    // Cloud fallback still present.
    if (aiCode.includes('sendToBackground') && aiCode.includes('summarize')) {
      console.log('PASS: utils/ai.js retains cloud fallback for summarizeText');
    } else {
      console.log('FAIL: utils/ai.js missing cloud fallback in summarizeText');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 20: keyboard-nav static checks (2.3 implementation guard)
  // ---------------------------------------------------------------------------
  {
    const knPath = path.join(ROOT, 'skills/builtin/keyboard-nav.js');
    const knCode = fs.readFileSync(knPath, 'utf8');

    // (a) tabbable imported
    if (/from\s+['"]tabbable['"]/.test(knCode) && knCode.includes('tabbable(')) {
      console.log('PASS: keyboard-nav.js imports and uses tabbable');
    } else {
      console.log('FAIL: keyboard-nav.js must import { tabbable } from tabbable and call tabbable()');
    }

    // (b) aria-hidden on badge container and/or individual badges
    if (knCode.includes('aria-hidden') && knCode.includes('"true"')) {
      console.log('PASS: keyboard-nav.js sets aria-hidden on badges/container');
    } else {
      console.log('FAIL: keyboard-nav.js missing aria-hidden="true" on badge container');
    }

    // (c) e.code used for shortcuts (not e.key)
    if (/e\.code\s*===\s*['"](?:KeyH|Digit1|Digit2|KeyF)['"]/.test(knCode)) {
      console.log('PASS: keyboard-nav.js uses e.code for shortcuts');
    } else {
      console.log('FAIL: keyboard-nav.js must use e.code (KeyH/Digit1/Digit2/KeyF) instead of e.key');
    }

    // (d) ctrlKey guard present
    if (/e\.ctrlKey\s*\|\|\s*e\.metaKey/.test(knCode) || /e\.ctrlKey/.test(knCode)) {
      console.log('PASS: keyboard-nav.js has ctrlKey guard (AltGr protection)');
    } else {
      console.log('FAIL: keyboard-nav.js missing ctrlKey guard for AltGr protection');
    }

    // (e) No :focus-visible rule in keyboard-nav.js
    if (!knCode.includes(':focus-visible')) {
      console.log('PASS: keyboard-nav.js has no :focus-visible rule (delegated to visual-assist)');
    } else {
      console.log('FAIL: keyboard-nav.js must not contain :focus-visible CSS — visual-assist owns the focus ring');
    }

    // (f) isContentEditable guard
    if (knCode.includes('isContentEditable')) {
      console.log('PASS: keyboard-nav.js has isContentEditable guard');
    } else {
      console.log('FAIL: keyboard-nav.js missing isContentEditable guard for editable targets');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 21: wcag-fixes 2.4 static guards
  // ---------------------------------------------------------------------------
  {
    const wcagPath = path.join(ROOT, 'skills/builtin/wcag-fixes.js');
    const wcagCode = fs.readFileSync(wcagPath, 'utf8');
    const wcagNoComments = wcagCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // (a) updateIdReferences gone or is a no-op (must not re-point for/aria-labelledby)
    if (!wcagNoComments.includes('updateIdReferences') ||
        wcagNoComments.includes('// no-op') ||
        // allow the word to appear only in a comment (stripped above means it's in active code if present)
        !wcagCode.replace(/\/\/[^\n]*/g, '').includes('updateIdReferences(')) {
      console.log('PASS: wcag-fixes.js updateIdReferences removed (no re-pointing of id refs)');
    } else {
      console.log('FAIL: wcag-fixes.js still calls updateIdReferences — breaks correct label wiring');
    }

    // (b) No aria-checked/aria-expanded/aria-selected backfill in wcag-fixes.js
    if (!wcagNoComments.includes("aria-checked") || !wcagNoComments.includes("'false'")) {
      console.log('PASS: wcag-fixes.js has no aria-checked="false" state backfill');
    } else {
      // Check more carefully: is it in the code that sets it?
      const backfillPat = /setAttribute\s*\(\s*['"]aria-checked['"]\s*,\s*['"]false['"]/;
      if (!backfillPat.test(wcagNoComments)) {
        console.log('PASS: wcag-fixes.js has no aria-checked="false" state backfill');
      } else {
        console.log('FAIL: wcag-fixes.js still backfills aria-checked="false" (lies to SRs)');
      }
    }

    // (c) BCP-47 validator present (isValidBcp47 exported)
    if (wcagCode.includes('export function isValidBcp47')) {
      console.log('PASS: wcag-fixes.js exports isValidBcp47 BCP-47 structural validator');
    } else {
      console.log('FAIL: wcag-fixes.js missing isValidBcp47 export');
    }

    // (d) wcagRiskyFixes key in registry settingsMeta
    const registryPath = path.join(ROOT, 'skills/registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf8');
    if (registryCode.includes('wcagRiskyFixes')) {
      console.log('PASS: registry.js contains wcagRiskyFixes setting key');
    } else {
      console.log('FAIL: registry.js missing wcagRiskyFixes setting key');
    }

    // (e) wcagRiskyFixes in a PROMPT_GROUP
    const promptGroupsSection = registryCode.slice(registryCode.indexOf('PROMPT_GROUPS'));
    if (promptGroupsSection.includes('wcagRiskyFixes')) {
      console.log('PASS: wcagRiskyFixes is in a PROMPT_GROUP');
    } else {
      console.log('FAIL: wcagRiskyFixes not placed in any PROMPT_GROUP');
    }

    // (f) build.js copies axe.min.js (copyAxe function present)
    const buildPath = path.join(ROOT, 'build.js');
    const buildCode = fs.readFileSync(buildPath, 'utf8');
    if (buildCode.includes('axe.min.js') && buildCode.includes('copyAxe')) {
      console.log('PASS: build.js has copyAxe() that copies axe.min.js');
    } else {
      console.log('FAIL: build.js missing copyAxe() for axe.min.js');
    }

    // (g) lib/axe.min.js exists after build
    const axeDst = path.join(ROOT, 'extension/lib/axe.min.js');
    if (require('fs').existsSync(axeDst)) {
      console.log('PASS: extension/lib/axe.min.js exists after build');
    } else {
      console.log('FAIL: extension/lib/axe.min.js not found — run npm run build');
    }

    // (h) content.js publishes __ai4a11yAxeDispatch
    const contentPath = path.join(ROOT, 'extension/content/content.js');
    const contentCode = fs.readFileSync(contentPath, 'utf8');
    if (contentCode.includes('__ai4a11yAxeDispatch')) {
      console.log('PASS: content.js publishes window.__ai4a11yAxeDispatch');
    } else {
      console.log('FAIL: content.js missing window.__ai4a11yAxeDispatch');
    }

    // (i) build.js has buildAriaTables (aria-query build-time generation)
    if (buildCode.includes('buildAriaTables') && buildCode.includes('aria-query')) {
      console.log('PASS: build.js has buildAriaTables() from aria-query');
    } else {
      console.log('FAIL: build.js missing buildAriaTables() — aria-tables.gen.js not generated');
    }

    // (j) SAFE_FIXERS and RISKY_FIXERS exported from wcag-fixes.js
    if (wcagCode.includes('export const SAFE_FIXERS') && wcagCode.includes('export const RISKY_FIXERS')) {
      console.log('PASS: wcag-fixes.js exports SAFE_FIXERS and RISKY_FIXERS');
    } else {
      console.log('FAIL: wcag-fixes.js missing SAFE_FIXERS or RISKY_FIXERS export');
    }

    // (k) removeMetaRefresh not present as active code
    if (!wcagNoComments.includes('removeMetaRefresh') ||
        !wcagNoComments.includes('element.remove()')) {
      console.log('PASS: removeMetaRefresh deleted (was no-op at document_idle)');
    } else {
      // check if it's still in active code paths
      const pat = /function removeMetaRefresh[\s\S]*?element\.remove\(\)/;
      if (!pat.test(wcagNoComments)) {
        console.log('PASS: removeMetaRefresh deleted (was no-op at document_idle)');
      } else {
        console.log('FAIL: removeMetaRefresh still present as active code — was a no-op, should be removed');
      }
    }

    // (l) fixViewportMeta regex also matches user-scalable=0
    if (wcagCode.includes('user-scalable=0') || wcagCode.includes('user-scalable\\s*=\\s*(no|0)')) {
      console.log('PASS: fixViewportMeta regex matches user-scalable=0');
    } else {
      console.log('FAIL: fixViewportMeta regex does not match user-scalable=0');
    }

    // (m) cssPath helper present in wcag-fixes.js
    if (wcagCode.includes('function cssPath')) {
      console.log('PASS: wcag-fixes.js has cssPath helper for unique element selectors');
    } else {
      console.log('FAIL: wcag-fixes.js missing cssPath helper');
    }

    // (n) logFix calls include inverse descriptor (5th arg)
    //     Check that at least one logFix call has a 5th argument
    const logFixCallsWithDesc = (wcagNoComments.match(/logFix\([^)]+,\s*\{/g) || []).length;
    if (logFixCallsWithDesc >= 3) {
      console.log(`PASS: wcag-fixes.js logFix calls include inverse descriptors (${logFixCallsWithDesc} found)`);
    } else {
      console.log(`FAIL: wcag-fixes.js logFix calls missing inverse descriptors (found ${logFixCallsWithDesc}, need >=3)`);
    }

    // (o) content.js has revertFix handler
    if (contentCode.includes("'revertFix'") && contentCode.includes('fixIndex')) {
      console.log('PASS: content.js has revertFix message handler with fixIndex support');
    } else {
      console.log('FAIL: content.js missing revertFix handler or fixIndex support');
    }

    // (p) background.js has runAxeAudit route
    const bgPath = path.join(ROOT, 'extension/background.js');
    const bgCode = fs.readFileSync(bgPath, 'utf8');
    if (bgCode.includes("'runAxeAudit'") && bgCode.includes('axe.min.js')) {
      console.log('PASS: background.js has runAxeAudit route that injects axe.min.js');
    } else {
      console.log('FAIL: background.js missing runAxeAudit route');
    }

    // (q) utils/aria-tables.gen.js exists (generated by build)
    const ariaTablesPath = path.join(ROOT, 'utils/aria-tables.gen.js');
    if (require('fs').existsSync(ariaTablesPath)) {
      const ariaTablesCode = fs.readFileSync(ariaTablesPath, 'utf8');
      if (ariaTablesCode.includes('VALID_ARIA_ROLES') && ariaTablesCode.includes('VALID_ARIA_ATTRS')) {
        console.log('PASS: utils/aria-tables.gen.js exists and exports VALID_ARIA_ROLES + VALID_ARIA_ATTRS');
      } else {
        console.log('FAIL: utils/aria-tables.gen.js exists but missing expected exports');
      }
      // Verify abstract roles are not included
      const abstractRoles = ['command', 'composite', 'landmark', 'range', 'roletype',
        'section', 'sectionhead', 'select', 'structure', 'widget', 'window'];
      const hasAbstract = abstractRoles.some(r => {
        // Check if it's a quoted entry in the array (not just a substring)
        return new RegExp(`["']${r}["']`).test(ariaTablesCode);
      });
      if (!hasAbstract) {
        console.log('PASS: utils/aria-tables.gen.js has no abstract roles');
      } else {
        console.log('FAIL: utils/aria-tables.gen.js still contains abstract ARIA roles');
      }
    } else {
      console.log('FAIL: utils/aria-tables.gen.js not found — run npm run build');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 22: voice-commands 2.1 static checks
  // ---------------------------------------------------------------------------
  {
    const vcPath = path.join(ROOT, 'skills/builtin/voice-commands.js');
    const vcCode = fs.readFileSync(vcPath, 'utf8');
    const paPath = path.join(ROOT, 'skills/builtin/page-actions.js');
    const paCode = fs.existsSync(paPath) ? fs.readFileSync(paPath, 'utf8') : '';

    // (a) page-actions.js exists
    if (fs.existsSync(paPath)) {
      console.log('PASS: skills/builtin/page-actions.js exists');
    } else {
      console.log('FAIL: skills/builtin/page-actions.js not found');
    }

    // (b) voice-commands.js imports from page-actions.js
    if (vcCode.includes('./page-actions.js') || vcCode.includes("'./page-actions'")) {
      console.log('PASS: voice-commands.js imports from page-actions.js');
    } else {
      console.log('FAIL: voice-commands.js does not import page-actions.js');
    }

    // (c) HUD transcript span has no aria-live
    // The feedbackElement or the interim text span must NOT have aria-live="polite"
    // on the transcript/text element. (A separate state region may have it.)
    const vcNoComments = vcCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // The text span (.ai4a11y-voice-text) must not be followed by aria-live.
    // Check: 'ai4a11y-voice-text' + 'aria-live' within the createFeedbackElement function.
    const feedbackFnMatch = vcNoComments.match(/createFeedbackElement[\s\S]*?(?=\n  [a-z_]|\n\})/);
    const feedbackFnCode = feedbackFnMatch ? feedbackFnMatch[0] : vcNoComments;
    const hasAriaLiveOnTranscript = /ai4a11y-voice-text[\s\S]{0,200}aria-live/.test(feedbackFnCode) ||
      /aria-live[\s\S]{0,200}ai4a11y-voice-text/.test(feedbackFnCode);
    if (!hasAriaLiveOnTranscript) {
      console.log('PASS: voice-commands.js HUD transcript element has no aria-live');
    } else {
      console.log('FAIL: voice-commands.js HUD transcript element must not have aria-live (SR echo)');
    }

    // (d) quickStart: false in registry for voice-commands
    const registryCode = fs.readFileSync(path.join(ROOT, 'skills/registry.js'), 'utf8');
    // Find the voice-commands entry and check quickStart
    const vcEntryMatch = registryCode.match(/id:\s*'voice-commands'[\s\S]*?(?=\},\s*\{|\}\s*\])/);
    if (vcEntryMatch && /quickStart:\s*false/.test(vcEntryMatch[0])) {
      console.log('PASS: voice-commands registry entry has quickStart: false');
    } else {
      console.log('FAIL: voice-commands registry entry must have quickStart: false');
    }

    // (e) voicePageAction in voice-routes.js whitelist
    if (voiceRoutesCode.includes("'voicePageAction'")) {
      console.log("PASS: voice-routes.js has 'voicePageAction' in the whitelist");
    } else {
      console.log("FAIL: voice-routes.js missing 'voicePageAction' route");
    }

    // (f) page_action in TOOL_DECLARATIONS in tools.js
    if (voiceToolsCode.includes("'page_action'")) {
      console.log("PASS: tools.js has 'page_action' declared");
    } else {
      console.log("FAIL: tools.js missing 'page_action' declaration");
    }

    // (g) prompt.js mentions page_action
    if (voicePromptCode.includes('page_action')) {
      console.log('PASS: prompt.js mentions page_action');
    } else {
      console.log('FAIL: prompt.js does not mention page_action');
    }

    // (h) content.js has pageCommand branch
    if (contentCode.includes("'pageCommand'") || contentCode.includes('"pageCommand"')) {
      console.log('PASS: content.js has pageCommand message branch');
    } else {
      console.log('FAIL: content.js missing pageCommand message branch');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 22: captions.js (W3 merge) static checks
  // ---------------------------------------------------------------------------
  {
    const captionsPath = path.join(ROOT, 'skills/builtin/captions.js');
    const captionsCode = fs.readFileSync(captionsPath, 'utf8');
    const captionsNoComments = captionsCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // (a) captions.js exists and is non-empty.
    if (fs.existsSync(captionsPath) && fs.statSync(captionsPath).size > 500) {
      console.log('PASS: skills/builtin/captions.js exists and is non-empty');
    } else {
      console.log('FAIL: skills/builtin/captions.js missing or too small');
    }

    // (b) No createSimpleVTT fixed-cadence code (old bad pattern deleted).
    if (!captionsCode.includes('createSimpleVTT') && !captionsCode.includes('secondsPerChunk')) {
      console.log('PASS: captions.js has no createSimpleVTT fixed-cadence pattern');
    } else {
      console.log('FAIL: captions.js still has createSimpleVTT or secondsPerChunk — must use real chunk offsets');
    }

    // (c) Real chunk offsets used (buildVTT takes startSec/endSec).
    if (captionsCode.includes('startSec') && captionsCode.includes('endSec') && captionsCode.includes('buildVTT')) {
      console.log('PASS: captions.js uses real chunk offsets (startSec/endSec) in buildVTT');
    } else {
      console.log('FAIL: captions.js missing real chunk offsets — must use chunk.startSec/endSec');
    }

    // (d) Track label mentions AI-generated.
    if (captionsCode.includes("AI-generated (may contain errors)")) {
      console.log("PASS: captions.js track label mentions 'AI-generated (may contain errors)'");
    } else {
      console.log("FAIL: captions.js track label must say 'AI-generated (may contain errors)'");
    }

    // (e) Honest notice string for blob:/MSE/DRM media.
    if (captionsCode.includes("Can't reach this player") && captionsCode.includes('Chrome Live Caption')) {
      console.log("PASS: captions.js has honest notice string for unreachable media");
    } else {
      console.log("FAIL: captions.js missing notice string for blob:/MSE/DRM media");
    }

    // (f) Namespaced marks used ('captions' namespace).
    if (captionsCode.includes("markProcessed") && captionsCode.includes("'captions'")) {
      console.log("PASS: captions.js uses namespaced marks (ns='captions')");
    } else {
      console.log("FAIL: captions.js missing namespaced marks");
    }

    // (g) No dataset.ai4a11yCaptioned permanent latch (old bad pattern).
    if (!captionsNoComments.includes("dataset.ai4a11yCaptioned = 'failed'")) {
      console.log("PASS: captions.js has no dataset.ai4a11yCaptioned permanent latch");
    } else {
      console.log("FAIL: captions.js still uses dataset.ai4a11yCaptioned='failed' latch — should use namespaced marks");
    }

    // (h) pagehide self-disable removed.
    if (!captionsNoComments.includes("'pagehide'")) {
      console.log("PASS: captions.js has no pagehide self-disable (SPA-safe: sweep handles navigation)");
    } else {
      console.log("FAIL: captions.js still has pagehide self-disable — must be removed (sweep handles SPA nav)");
    }

    // (i) wrapper position:relative restore on disable.
    if (captionsCode.includes('origWrapperPosition')) {
      console.log("PASS: captions.js records/restores wrapper position style on disable");
    } else {
      console.log("FAIL: captions.js missing origWrapperPosition — wrapper position leak on disable");
    }

    // (j) axeHandlers exported with correct keys.
    if (captionsCode.includes("'video-caption'") && captionsCode.includes("'audio-caption'")) {
      console.log("PASS: captions.js exports axeHandlers with video-caption and audio-caption keys");
    } else {
      console.log("FAIL: captions.js axeHandlers missing video-caption or audio-caption key");
    }

    // (k) registerSweep used for SPA navigation.
    if (captionsCode.includes('registerSweep') && captionsCode.includes('observe.js')) {
      console.log("PASS: captions.js uses registerSweep from observe.js for SPA navigation");
    } else {
      console.log("FAIL: captions.js missing registerSweep from observe.js");
    }

    // (l) No WCAG stat increment for machine output.
    //     logFix is called with type 'caption' (not 'wcag') — wcag counter stays clean.
    const logFixCalls = captionsNoComments.match(/logFix\([^)]+\)/g) || [];
    const hasWcagIncrement = captionsNoComments.includes("incrementStat('wcag')") || captionsNoComments.includes('incrementStat("wcag")');
    if (!hasWcagIncrement) {
      console.log("PASS: captions.js does not increment wcag stat for machine output");
    } else {
      console.log("FAIL: captions.js must not increment wcag stat for machine output");
    }

    // (m) background.js has transcribeMedia route.
    const bgPath = path.join(ROOT, 'extension/background.js');
    const bgCode = fs.readFileSync(bgPath, 'utf8');
    if (bgCode.includes("'transcribeMedia'") && bgCode.includes('captionDecodeAudio')) {
      console.log("PASS: background.js has transcribeMedia route and captionDecodeAudio plumbing");
    } else {
      console.log("FAIL: background.js missing transcribeMedia route or captionDecodeAudio");
    }

    // (n) offscreen/src/index.js has captionDecodeAudio handler.
    const offscreenIndexPath = path.join(ROOT, 'extension/offscreen/src/index.js');
    const offscreenCode = fs.readFileSync(offscreenIndexPath, 'utf8');
    if (offscreenCode.includes("'captionDecodeAudio'") && offscreenCode.includes('AudioContext')) {
      console.log("PASS: offscreen/src/index.js handles captionDecodeAudio with AudioContext");
    } else {
      console.log("FAIL: offscreen/src/index.js missing captionDecodeAudio handler");
    }

    // (o) content.js imports Captions from captions.js (not old modules).
    const contentPath2 = path.join(ROOT, 'extension/content/content.js');
    const contentCode2 = fs.readFileSync(contentPath2, 'utf8');
    if (contentCode2.includes("Captions") && contentCode2.includes("captions.js") &&
        contentCode2.includes("autoCaptions: Captions")) {
      console.log("PASS: content.js AI_TOOL_MAP routes autoCaptions to Captions (merged module)");
    } else {
      console.log("FAIL: content.js AI_TOOL_MAP not updated — autoCaptions must route to Captions");
    }

    // (p) utils/ai.js transcribeAudio sends 'transcribeMedia' to background (not null stub).
    const aiPath = path.join(ROOT, 'utils/ai.js');
    const aiCode = fs.readFileSync(aiPath, 'utf8');
    if (aiCode.includes("'transcribeMedia'") && aiCode.includes('transcribeAudio')) {
      console.log("PASS: utils/ai.js transcribeAudio sends transcribeMedia message to background");
    } else {
      console.log("FAIL: utils/ai.js transcribeAudio still returns null stub — must send transcribeMedia");
    }

    // (q) test/captions-test.mjs and test/captions-e2e.js exist.
    if (fs.existsSync(path.join(ROOT, 'test/captions-test.mjs'))) {
      console.log("PASS: test/captions-test.mjs exists");
    } else {
      console.log("FAIL: test/captions-test.mjs not found");
    }
    if (fs.existsSync(path.join(ROOT, 'test/captions-e2e.js'))) {
      console.log("PASS: test/captions-e2e.js exists");
    } else {
      console.log("FAIL: test/captions-e2e.js not found");
    }

    // (r) test/fixtures/captions/page.html exists.
    if (fs.existsSync(path.join(ROOT, 'test/fixtures/captions/page.html'))) {
      console.log("PASS: test/fixtures/captions/page.html exists");
    } else {
      console.log("FAIL: test/fixtures/captions/page.html not found");
    }
  }

  // ---------------------------------------------------------------------------
  // Test 23: Phase 3 low/no-demand tier static checks
  // ---------------------------------------------------------------------------
  {
    const cfPath = path.join(ROOT, 'skills/builtin/color-filter.js');
    const cfCode = fs.readFileSync(cfPath, 'utf8');
    const rdPath = path.join(ROOT, 'skills/builtin/read-aloud.js');
    const rdCode = fs.readFileSync(rdPath, 'utf8');
    const fmPath = path.join(ROOT, 'skills/builtin/focus-mode.js');
    const fmCode = fs.readFileSync(fmPath, 'utf8');
    const dmPath = path.join(ROOT, 'skills/builtin/dark-mode.js');
    const dmCode = fs.readFileSync(dmPath, 'utf8');
    const regCode = fs.readFileSync(path.join(ROOT, 'skills/registry.js'), 'utf8');

    // (a) color-filter: daltonization comment present.
    if (cfCode.includes('daltonization') || cfCode.includes('error-redistribution')) {
      console.log('PASS: color-filter.js has daltonization/error-redistribution comment');
    } else {
      console.log('FAIL: color-filter.js missing daltonization comment');
    }

    // (b) color-filter: old simulation values gone.
    if (!cfCode.includes('0.567 0.433 0')) {
      console.log('PASS: color-filter.js no longer has old protanopia simulation value');
    } else {
      console.log('FAIL: color-filter.js still has old protanopia simulation (0.567 0.433 0)');
    }

    // (c) color-filter: anchored to documentElement.
    if (cfCode.includes('document.documentElement.appendChild')) {
      console.log('PASS: color-filter.js appends SVG filter to documentElement');
    } else {
      console.log('FAIL: color-filter.js must append SVG filter to documentElement, not body');
    }

    // (d) focus-mode: no hover-highlight rule.
    if (!/p:hover\s*,\s*li:hover\s*,\s*td:hover/.test(fmCode)) {
      console.log('PASS: focus-mode.js has no p:hover/li:hover/td:hover hover-highlight rule');
    } else {
      console.log('FAIL: focus-mode.js still has always-on hover-highlight rule — remove it');
    }

    // (e) focus-mode: no dimBackground in active code (only in comments is OK).
    const fmNoComments = fmCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!fmNoComments.includes('dimBackground')) {
      console.log('PASS: focus-mode.js has no dead dimBackground code in active code');
    } else {
      console.log('FAIL: focus-mode.js still has dead dimBackground code branch in active code');
    }

    // (f) dark-mode: no DarkReader reference in active code.
    const dmNoComments = dmCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!dmNoComments.includes('DarkReader')) {
      console.log('PASS: dark-mode.js has no DarkReader reference (dead code removed)');
    } else {
      console.log('FAIL: dark-mode.js still references DarkReader in active code');
    }

    // (g) dark-mode: single img/video rule (no duplicate) — check in code only.
    // dmNoComments already declared above.
    const imgRuleCount = (dmNoComments.match(/img[\s\S]{0,100}filter:/g) || []).length;
    if (imgRuleCount === 1) {
      console.log('PASS: dark-mode.js has single img/video filter rule');
    } else {
      console.log(`FAIL: dark-mode.js has ${imgRuleCount} img filter rules in active code — expected 1`);
    }

    // (h) dark-mode: color-filter arbitration.
    if (dmCode.includes('_colorFilterStyleId') || dmCode.includes('color-filter')) {
      console.log('PASS: dark-mode.js checks for color-filter arbitration');
    } else {
      console.log('FAIL: dark-mode.js missing color-filter arbitration check');
    }

    // (i) read-aloud: no "Reading started" announce.
    if (!rdCode.includes("announce('Reading started')") && !rdCode.includes('announce("Reading started")')) {
      console.log('PASS: read-aloud.js has no "Reading started" announce (double-speak fix)');
    } else {
      console.log('FAIL: read-aloud.js still announces "Reading started" — double-speak with TTS');
    }

    // (j) read-aloud: sentenceChunks present.
    if (rdCode.includes('sentenceChunks')) {
      console.log('PASS: read-aloud.js has sentenceChunks for Chrome remote-voice stall fix');
    } else {
      console.log('FAIL: read-aloud.js missing sentenceChunks function');
    }

    // (k) registry: large-cursor and dyslexia-font entries retired.
    if (!regCode.includes("id: 'large-cursor'")) {
      console.log("PASS: 'large-cursor' registry entry correctly retired");
    } else {
      console.log("FAIL: 'large-cursor' registry entry still present — should be retired");
    }
    if (!regCode.includes("id: 'dyslexia-font'")) {
      console.log("PASS: 'dyslexia-font' registry entry correctly retired");
    } else {
      console.log("FAIL: 'dyslexia-font' registry entry still present — should be retired");
    }

    // (l) onboarding has retired-adapters-note.
    const onboardingHtmlPath = path.join(ROOT, 'extension/onboarding/onboarding.html');
    const onboardingHtml = fs.readFileSync(onboardingHtmlPath, 'utf8');
    if (onboardingHtml.includes('retired-adapters-note')) {
      console.log('PASS: onboarding.html has retired-adapters-note for moved cards');
    } else {
      console.log('FAIL: onboarding.html missing retired-adapters-note');
    }

    // (m) popup.js has contrastMigrationNudge.
    const popupJsPath = path.join(ROOT, 'extension/popup/popup.js');
    const popupJsCode = fs.readFileSync(popupJsPath, 'utf8');
    if (popupJsCode.includes('contrastMigrationNudge') && popupJsCode.includes('contrastNudgeDismissed')) {
      console.log('PASS: popup.js has fix-contrast migration nudge');
    } else {
      console.log('FAIL: popup.js missing fix-contrast migration nudge');
    }

    // (n) content.js has _osAutoDark for dark-mode auto-respect.
    const contentPath3 = path.join(ROOT, 'extension/content/content.js');
    const contentCode3 = fs.readFileSync(contentPath3, 'utf8');
    if (contentCode3.includes('_osAutoDark') && contentCode3.includes('prefs.dark')) {
      console.log('PASS: content.js has dark-mode prefers-color-scheme auto-respect');
    } else {
      console.log('FAIL: content.js missing dark-mode prefers-color-scheme auto-respect');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 24: Fix-regression static checks (#14, #16, #17, #18, #19)
  // ---------------------------------------------------------------------------
  {
    const contentPath4 = path.join(ROOT, 'extension/content/content.js');
    const contentCode4 = fs.readFileSync(contentPath4, 'utf8');
    const vcPath = path.join(ROOT, 'skills/builtin/voice-commands.js');
    const vcCode = fs.readFileSync(vcPath, 'utf8');
    const vrPath = path.join(ROOT, 'extension/voice-routes.js');
    const vrCode = fs.readFileSync(vrPath, 'utf8');

    // #16 — fixContrast must NOT be inside enableAITool() calls in content.js.
    // The correct pattern is a direct FixContrast.enable() without an AI-key gate.
    if (!contentCode4.includes("enableAITool('fixContrast'") &&
        !contentCode4.includes('enableAITool("fixContrast"')) {
      console.log('PASS (#16): content.js does not gate fixContrast through enableAITool');
    } else {
      console.log('FAIL (#16): content.js still routes fixContrast through enableAITool (key gate)');
    }

    // #16 — content.js must have an ungated FixContrast.enable() path reachable
    // from applyAISettings (outside the configured block).
    if (contentCode4.includes('await FixContrast.enable()')) {
      console.log('PASS (#16): content.js has direct (ungated) FixContrast.enable() call');
    } else {
      console.log('FAIL (#16): content.js missing direct FixContrast.enable() — keyless users cannot get contrast fixes');
    }

    // #14 — watchSystemPrefs must be called only once per init() via a module-level handle.
    // Check: the return value of watchSystemPrefs is captured (not discarded).
    if (contentCode4.includes('_prefsUnwatch = watchSystemPrefs(')) {
      console.log('PASS (#14): content.js captures watchSystemPrefs return as _prefsUnwatch');
    } else {
      console.log('FAIL (#14): content.js discards watchSystemPrefs unwatch — listener leak on rescan');
    }

    // #14 — init() must clear the old watcher before re-registering.
    if (contentCode4.includes('_prefsUnwatch()') && contentCode4.includes('_prefsUnwatch = null')) {
      console.log('PASS (#14): content.js calls _prefsUnwatch() before re-registering');
    } else {
      console.log('FAIL (#14): content.js does not unwatch before re-registering watchSystemPrefs');
    }

    // #17 — applyProfileSettings must be async (needs to await checkAIConfigured).
    if (contentCode4.includes('async function applyProfileSettings(')) {
      console.log('PASS (#17): applyProfileSettings is async (can await AI-key gate)');
    } else {
      console.log('FAIL (#17): applyProfileSettings is not async — keyless AI round-trips on every page load');
    }

    // #17 — applyProfileSettings must call checkAIConfigured() before enabling AI adapters.
    // Verify via a heuristic: the function body must reference checkAIConfigured.
    const profileFnStart = contentCode4.indexOf('async function applyProfileSettings(');
    const profileFnEnd = contentCode4.indexOf('console.log(\'[AI4A11y] Profile settings applied\')');
    const profileBody = profileFnStart >= 0 && profileFnEnd > profileFnStart
      ? contentCode4.slice(profileFnStart, profileFnEnd)
      : '';
    if (profileBody.includes('checkAIConfigured()')) {
      console.log('PASS (#17): applyProfileSettings calls checkAIConfigured() before AI adapter enables');
    } else {
      console.log('FAIL (#17): applyProfileSettings does not gate AI adapters on checkAIConfigured()');
    }

    // #18 — VoiceCommands.enable() must return false on the Live-session bail.
    // Check that the _isLiveActive bail uses `return false` not bare `return`.
    if (vcCode.includes('_isLiveActive()') && vcCode.includes('return false;')) {
      console.log('PASS (#18): voice-commands.js enable() returns false on mutual-exclusion bail');
    } else {
      console.log('FAIL (#18): voice-commands.js enable() does not return false — phantom-enabled state');
    }

    // #18 — enableTool must be async so it can await the enable() Promise.
    if (contentCode4.includes('async function enableTool(')) {
      console.log('PASS (#18): content.js enableTool is async (awaits enable() for VoiceCommands)');
    } else {
      console.log('FAIL (#18): content.js enableTool is not async — VoiceCommands bail not detected');
    }

    // #19 — _osAutoDark must be gated on the enableTool result, not set unconditionally.
    // The fix introduces darkEnableResult to carry the return value.
    if (contentCode4.includes('darkEnableResult') && contentCode4.includes('darkEnableResult?.ok !== false')) {
      console.log('PASS (#19): content.js gates _osAutoDark on enableTool result (no phantom flag)');
    } else {
      console.log('FAIL (#19): content.js sets _osAutoDark unconditionally — spurious "Dark mode disabled" announce');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 25 (#24 fix): Phase-0 wiring guard — parse actual dispatch-map keys
  //   Old guard: contentCode.includes(key) — fires for OBSERVED_SETTING_KEYS,
  //   comments, and string literals, so deleting a map entry stays green.
  //   New guard: PARSE the TOOL_MAP / AI_TOOL_MAP literals and assert set
  //   membership so a key rename or deletion breaks this test, not just style.
  // ---------------------------------------------------------------------------
  {
    const contentPath5 = path.join(ROOT, 'extension/content/content.js');
    const contentSrc5 = fs.readFileSync(contentPath5, 'utf8');

    // Extract keys from a `const <mapName> = { ... };` literal.
    function extractMapKeys(src, mapName) {
      const re = new RegExp(`const\\s+${mapName}\\s*=\\s*\\{([^}]+)\\}`, 's');
      const m = src.match(re);
      if (!m) return new Set();
      const block = m[1];
      const keys = new Set();
      for (const entry of block.split(',')) {
        const trimmed = entry.trim().replace(/\/\/[^\n]*/g, '').trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        const key = (colonIdx >= 0 ? trimmed.slice(0, colonIdx) : trimmed).trim().replace(/^['"]|['"]$/g, '');
        if (key && /^\w+$/.test(key)) keys.add(key);
      }
      return keys;
    }

    const toolMapKeys = extractMapKeys(contentSrc5, 'TOOL_MAP');
    const aiToolMapKeys = extractMapKeys(contentSrc5, 'AI_TOOL_MAP');

    if (toolMapKeys.size > 0) {
      console.log(`PASS (#24): TOOL_MAP parsed — ${toolMapKeys.size} keys: ${[...toolMapKeys].join(', ')}`);
    } else {
      console.log('FAIL (#24): could not parse TOOL_MAP from content.js');
    }
    if (aiToolMapKeys.size > 0) {
      console.log(`PASS (#24): AI_TOOL_MAP parsed — ${aiToolMapKeys.size} keys: ${[...aiToolMapKeys].join(', ')}`);
    } else {
      console.log('FAIL (#24): could not parse AI_TOOL_MAP from content.js');
    }

    // Assert every expected demand-tier key is a real map key (not just a substring).
    const toolMapExpected = new Set(['DarkMode', 'FocusMode', 'VisualAssist', 'MotionReducer',
      'ReaderMode', 'ColorBlindMode', 'KeyboardNavigator', 'VoiceCommands', 'ReadAloud']);
    const aiMapExpected = new Set(['fixContrast', 'autoWcagFix', 'autoFixLabels', 'autoDescribe',
      'autoCaptions', 'autoSimplify', 'autoSummarize']);

    let tmOk = true;
    for (const k of toolMapExpected) {
      if (!toolMapKeys.has(k)) {
        console.log(`FAIL (#24): TOOL_MAP missing '${k}' as an actual key`);
        tmOk = false;
      }
    }
    if (tmOk) console.log('PASS (#24): all required TOOL_MAP keys present as actual map keys');

    let amOk = true;
    for (const k of aiMapExpected) {
      if (!aiToolMapKeys.has(k)) {
        console.log(`FAIL (#24): AI_TOOL_MAP missing '${k}' as an actual key`);
        amOk = false;
      }
    }
    if (amOk) console.log('PASS (#24): all required AI_TOOL_MAP keys present as actual map keys');

    // No key should appear in BOTH maps.
    const overlap = [...toolMapKeys].filter(k => aiToolMapKeys.has(k));
    if (overlap.length === 0) {
      console.log('PASS (#24): no key in both TOOL_MAP and AI_TOOL_MAP (no duplicates)');
    } else {
      console.log(`FAIL (#24): key(s) appear in both maps (unexpected duplicates): ${overlap.join(', ')}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 26 (#25 fix): logFix call-time binding — strengthened dual-layer guard
  //   (a) Broadened static regex: catches ALL module-scope capture spellings
  //       (let, bracket-access, destructuring, alias), not just one exact form.
  //   (b) Positive contract: every builtin that calls logFix() must define it
  //       as an arrow wrapper that dereferences globalThis at CALL TIME.
  // ---------------------------------------------------------------------------
  {
    const builtinDir5 = path.join(ROOT, 'skills/builtin');
    const builtinFiles5 = fs.readdirSync(builtinDir5).filter(f => f.endsWith('.js'));

    // (a) Ban all module-scope capture spellings.
    const badPatterns5 = [
      /^\s*(const|let|var)\s+(logFix|incrementStat)\s*=\s*globalThis[.[]/m,    // dot or bracket
      /^\s*(const|let|var)\s*\{[^}]*ai4a11yLogFix[^}]*\}\s*=\s*globalThis/m,  // destructuring
      /^\s*(const|let|var)\s+\w+\s*=\s*globalThis\.ai4a11yLogFix/m,            // alias rename
    ];
    let allCallTime5 = true;
    for (const file of builtinFiles5) {
      const code = fs.readFileSync(path.join(builtinDir5, file), 'utf8');
      for (const pat of badPatterns5) {
        if (pat.test(code)) {
          console.log(`FAIL (#25a): ${file} has a module-scope globalThis capture for logFix/incrementStat`);
          allCallTime5 = false;
          break;
        }
      }
    }
    if (allCallTime5) console.log('PASS (#25a): no builtin has a module-scope globalThis capture (all spellings)');

    // (b) Positive contract: every builtin that USES logFix() must define it as
    //     a call-time wrapper arrow `(...a) => (globalThis.ai4a11yLogFix || ...)(...a)`.
    //     A module-scope capture form would not match this pattern.
    const callTimePat5 = /const\s+logFix\s*=\s*\(\.\.\.[\w]+\)\s*=>\s*\(globalThis\.ai4a11yLogFix/;
    let usesLogFix5 = 0, callTimeLogFix5 = 0;
    for (const file of builtinFiles5) {
      const code = fs.readFileSync(path.join(builtinDir5, file), 'utf8');
      if (code.includes('logFix(')) {
        usesLogFix5++;
        if (callTimePat5.test(code)) {
          callTimeLogFix5++;
        } else {
          console.log(`FAIL (#25b): ${file} calls logFix() but its definition is not the call-time wrapper form`);
        }
      }
    }
    if (usesLogFix5 > 0 && callTimeLogFix5 === usesLogFix5) {
      console.log(`PASS (#25b): all ${usesLogFix5} builtins that call logFix() use the call-time wrapper form`);
    } else if (usesLogFix5 === 0) {
      console.log('WARN (#25b): no builtins found that call logFix() — unexpected');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 27: adversarial-review fixes #6, #12, #13, #15 static guards
  // ---------------------------------------------------------------------------
  {
    const captionsPath27 = path.join(ROOT, 'skills/builtin/captions.js');
    const captionsCode27 = fs.readFileSync(captionsPath27, 'utf8');
    const bgPath27 = path.join(ROOT, 'extension/background.js');
    const bgCode27 = fs.readFileSync(bgPath27, 'utf8');
    const offscreenPath27 = path.join(ROOT, 'extension/offscreen/src/index.js');
    const offscreenCode27 = fs.readFileSync(offscreenPath27, 'utf8');

    // --- #6: Generation-counter pattern ---
    if (captionsCode27.includes('_generation') && captionsCode27.includes('_generation++')) {
      console.log('PASS (#6): captions.js has _generation counter that is bumped on disable()');
    } else {
      console.log('FAIL (#6): captions.js missing _generation counter or disable() bump');
    }

    if (captionsCode27.includes('const myGen = _generation') &&
        captionsCode27.includes('_generation !== myGen')) {
      console.log('PASS (#6): captions.js captures myGen before await and guards DOM write after');
    } else {
      console.log('FAIL (#6): captions.js missing myGen capture or post-await generation check');
    }

    if (captionsCode27.includes('export function _currentGeneration')) {
      console.log('PASS (#6): captions.js exports _currentGeneration() for testability');
    } else {
      console.log('FAIL (#6): captions.js missing _currentGeneration export');
    }

    // --- #12: Duration cap + busy flag in offscreen ---
    if (offscreenCode27.includes('MAX_DECODE_DURATION_S')) {
      console.log('PASS (#12): offscreen/src/index.js has MAX_DECODE_DURATION_S duration cap constant');
    } else {
      console.log('FAIL (#12): offscreen/src/index.js missing MAX_DECODE_DURATION_S constant');
    }

    if (offscreenCode27.includes('decoded.duration > MAX_DECODE_DURATION_S')) {
      console.log('PASS (#12): offscreen captionDecodeAudio checks duration against cap before PCM copy');
    } else {
      console.log('FAIL (#12): offscreen captionDecodeAudio missing duration cap check');
    }

    if (offscreenCode27.includes('_captionDecodeBusy') &&
        offscreenCode27.includes('_captionDecodeBusy = false')) {
      console.log('PASS (#12): offscreen has _captionDecodeBusy flag with finally-clear (serialize decodes)');
    } else {
      console.log('FAIL (#12): offscreen missing _captionDecodeBusy busy-flag');
    }

    if (offscreenCode27.includes('_captionDecodeBusy = true')) {
      console.log('PASS (#12): offscreen sets _captionDecodeBusy = true before decode');
    } else {
      console.log('FAIL (#12): offscreen does not set _captionDecodeBusy before decode');
    }

    // --- #13: Refcount registry + voice mutual exclusion + serialize end-to-end ---
    if (bgCode27.includes('_transcribeRefcount') && bgCode27.includes('_transcribeAcquire') &&
        bgCode27.includes('_transcribeRelease')) {
      console.log('PASS (#13): background.js has transcription refcount registry (_transcribeAcquire/Release)');
    } else {
      console.log('FAIL (#13): background.js missing transcription refcount registry');
    }

    if (bgCode27.includes('_waitTranscribeIdle') && bgCode27.includes('closeOffscreen')) {
      // Verify the deferred-close path: closeOffscreen must reference _waitTranscribeIdle.
      const closeOffscreenBody = bgCode27.slice(
        bgCode27.indexOf('async function closeOffscreen'),
        bgCode27.indexOf('async function closeOffscreen') + 600
      );
      if (closeOffscreenBody.includes('_waitTranscribeIdle')) {
        console.log('PASS (#13): closeOffscreen defers until in-flight transcriptions complete');
      } else {
        console.log('FAIL (#13): closeOffscreen does not wait for in-flight transcriptions');
      }
    } else {
      console.log('FAIL (#13): background.js missing _waitTranscribeIdle or deferred-close path');
    }

    if (bgCode27.includes('voice mode is using audio')) {
      console.log('PASS (#13): transcribeMedia refuses to start while voice session is active');
    } else {
      console.log('FAIL (#13): transcribeMedia missing voice-session mutual exclusion check');
    }

    if (bgCode27.includes('_transcribeQueue') && bgCode27.includes('_doTranscribeMedia')) {
      console.log('PASS (#13): transcribeMedia serializes end-to-end via _transcribeQueue');
    } else {
      console.log('FAIL (#13): transcribeMedia missing _transcribeQueue serializer');
    }

    // --- #15: Stream-read with incremental cap ---
    if (bgCode27.includes('reader.read()') && bgCode27.includes('totalBytes +=') &&
        bgCode27.includes('reader.cancel')) {
      console.log('PASS (#15): background.js uses stream reader loop with incremental byte cap');
    } else {
      console.log('FAIL (#15): background.js missing stream reader loop for incremental cap');
    }

    // Verify stream-read is present in BOTH transcribeMedia and fetchImageBytes paths.
    const doTranscribeBody = bgCode27.includes('_doTranscribeMedia') &&
      bgCode27.slice(bgCode27.indexOf('async function _doTranscribeMedia'), bgCode27.indexOf('async function _doTranscribeMedia') + 3000);
    const fetchImageBody = bgCode27.includes("'fetchImageBytes'") &&
      bgCode27.slice(bgCode27.indexOf("msg.type === 'fetchImageBytes'"), bgCode27.indexOf("msg.type === 'fetchImageBytes'") + 2000);

    if (doTranscribeBody && doTranscribeBody.includes('reader.read()')) {
      console.log('PASS (#15): stream reader present in _doTranscribeMedia (transcribeMedia path)');
    } else {
      console.log('FAIL (#15): _doTranscribeMedia missing stream reader loop');
    }

    if (fetchImageBody && fetchImageBody.includes('reader.read()')) {
      console.log('PASS (#15): stream reader present in fetchImageBytes path');
    } else {
      console.log('FAIL (#15): fetchImageBytes missing stream reader loop');
    }
  }

  // ---------------------------------------------------------------
  // Bundle-size budget guard (review finding #11): the content bundle is
  // injected into every page; fail if the gzipped size creeps past 90 KB.
  // Next lever if this trips: split reader-mode's readability+dompurify into
  // an on-demand chrome.scripting chunk (see docs/adapter-robustness-plan.md).
  // ---------------------------------------------------------------
  {
    const zlib = require('zlib');
    const bundleBytes = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'content.bundle.js'));
    const gzKB = zlib.gzipSync(bundleBytes).length / 1024;
    if (gzKB <= 90) {
      console.log(`PASS: content bundle within budget (${gzKB.toFixed(0)} KB gz <= 90 KB)`);
    } else {
      console.log(`FAIL: content bundle over budget (${gzKB.toFixed(0)} KB gz > 90 KB) — lazy-split heavy libs`);
    }
    const looksMinified = !bundleBytes.slice(0, 4096).toString().includes('\n  ');
    if (looksMinified) {
      console.log('PASS: content bundle is minified');
    } else {
      console.log('FAIL: content bundle is not minified (build.js contentConfig.minify)');
    }
  }

  console.log('\n=== DONE ===');

  server.close();
  process.exit(0);
});
