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
  const aiMapChecks = ['autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoCaptions', 'autoSimplify'];
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
    'autoWcagFix', 'autoDescribe', 'autoFixLabels', 'autoCaptions', 'autoSimplify',
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
  for (const r of ['voiceGetContext', 'voiceApplySettings', 'voiceReadPage', 'voiceSuggestCapabilities', 'voiceGetMemory']) {
    if (voiceRoutesCode.includes(`'${r}'`)) console.log(`PASS: SW voice route '${r}'`);
    else console.log(`FAIL: SW missing voice route '${r}'`);
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

  console.log('\n=== DONE ===');

  server.close();
  process.exit(0);
});
