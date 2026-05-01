const GEMINI_MODEL = 'gemini-2.5-flash';
const USER_SCRIPT_ID_PREFIX = 'aa-custom-';

function getApiUrl(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

// ----- User-scripts integration --------------------------------------------
// Custom skills are persisted blobs of arbitrary user-authored JS. MV3 forbids
// `unsafe-eval` everywhere except the dedicated user-scripts world, so saved
// skills are registered as user scripts (one per skill) and re-synced any time
// `customSkills` changes. Requires the user to enable "Developer mode" at
// chrome://extensions; calls below throw if it's off and the failures are
// surfaced via the getUserScriptsStatus message.

function userScriptsAvailable() {
  return typeof chrome.userScripts !== 'undefined';
}

let userScriptWorldConfigured = false;
async function ensureUserScriptWorld() {
  if (!userScriptsAvailable() || userScriptWorldConfigured) return;
  try {
    await chrome.userScripts.configureWorld({
      messaging: true,
      csp: "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'self'",
    });
    userScriptWorldConfigured = true;
  } catch (e) {
    console.warn('[AgenticA11y] configureWorld failed:', e.message);
  }
}

function isDevModeError(err) {
  const msg = (err && err.message) || '';
  return /developer mode|user script/i.test(msg);
}

async function syncCustomUserScripts() {
  if (!userScriptsAvailable()) return;
  let data;
  try {
    data = await chrome.storage.local.get(['customSkills', 'extensionEnabled']);
  } catch { return; }

  let registered;
  try {
    registered = await chrome.userScripts.getScripts();
  } catch (e) {
    if (isDevModeError(e)) {
      console.warn('[AgenticA11y] Custom skills require Developer mode at chrome://extensions.');
    } else {
      console.warn('[AgenticA11y] getScripts failed:', e.message);
    }
    return;
  }

  await ensureUserScriptWorld();

  const ours = registered.filter(s => s.id.startsWith(USER_SCRIPT_ID_PREFIX));
  const ourIds = new Set(ours.map(s => s.id));
  const enabled = data.extensionEnabled !== false;
  const customSkills = enabled ? (data.customSkills || []) : [];

  const desired = customSkills
    .filter(s => s && typeof s.code === 'string' && typeof s.id === 'string')
    // Treat missing `enabled` as true (existing skills predate the field).
    .filter(s => s.enabled !== false)
    .map(s => ({
      id: USER_SCRIPT_ID_PREFIX + s.id,
      // Wrap in an IIFE: chrome.userScripts.register runs the code as a
      // classic script, so a top-level `return` (which the prompt tells the
      // generator to use for idempotency guards) would be a SyntaxError.
      // Wrapping turns the body into a function, where `return` is legal,
      // and also keeps any `var`/`const`/`function` declarations from
      // colliding with other skills in the shared user-script world.
      js: [{ code: `(function(){\n${s.code}\n})();` }],
      matches: ['<all_urls>'],
      runAt: 'document_idle',
      world: 'USER_SCRIPT',
    }));

  const desiredIds = new Set(desired.map(d => d.id));

  const toRemove = [...ourIds].filter(id => !desiredIds.has(id));
  if (toRemove.length > 0) {
    try { await chrome.userScripts.unregister({ ids: toRemove }); }
    catch (e) { console.warn('[AgenticA11y] unregister failed:', e.message); }
  }

  for (const script of desired) {
    try {
      if (ourIds.has(script.id)) {
        await chrome.userScripts.update([script]);
      } else {
        await chrome.userScripts.register([script]);
      }
    } catch (e) {
      console.warn('[AgenticA11y] register/update failed for', script.id, ':', e.message);
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.customSkills || changes.extensionEnabled) {
    syncCustomUserScripts();
  }
});

ensureUserScriptWorld().then(syncCustomUserScripts);

// callGemini supports two third-arg shapes for backward compatibility:
//   - an array of image data URLs (legacy from main: multimodal vision calls)
//   - an options object: { images?: string[], mimeType?: string }
// New callers should use the object form; mimeType (e.g. 'application/json')
// asks Gemini to emit only valid JSON, which the skill-builder relies on for
// runtime AI calls inside saved skills.
async function callGemini(prompt, apiKey, optsOrImages) {
  const opts = Array.isArray(optsOrImages)
    ? { images: optsOrImages }
    : (optsOrImages || {});
  const { images, mimeType, model } = opts;

  const parts = [{ text: prompt }];
  if (images && images.length > 0) {
    for (const dataUrl of images) {
      const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: { mimeType: match[1], data: match[2] }
        });
      }
    }
  }

  const generationConfig = { temperature: 0.7 };
  if (mimeType) generationConfig.responseMimeType = mimeType;

  const resp = await fetch(getApiUrl(apiKey, model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig,
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  return text;
}

async function getApiKey() {
  const data = await chrome.storage.sync.get(['geminiApiKey', 'geminiKey']);
  return data.geminiApiKey || data.geminiKey || null;
}

// Routed from BOTH chrome.runtime.onMessage (extension pages: popup, builder,
// onboarding) AND chrome.runtime.onUserScriptMessage (user scripts running
// saved custom skills). User-script messages don't reach the regular
// onMessage listener — they have their own event channel — so without this
// shared handler, runtime AI calls from skills get no reply and return
// `undefined` to the caller.
function handleGeminiMessage(msg, sender, sendResponse) {
  (async () => {
    const callerId = sender?.userScriptWorldId != null
      ? `userScript:${sender.userScriptWorldId}`
      : (sender?.id || sender?.url || 'unknown');
    try {
      const apiKey = msg.apiKey || await getApiKey();
      if (!apiKey) {
        console.log('[AgenticA11y] gemini call from', callerId, '→ no API key');
        sendResponse({ error: 'No Gemini API key configured. Go to extension settings.' });
        return;
      }
      const result = await callGemini(msg.prompt, apiKey, {
        images: msg.images,
        mimeType: msg.mimeType,
        model: msg.model,
      });
      console.log('[AgenticA11y] gemini call from', callerId, '→ result length:', result.length);
      sendResponse({ result });
    } catch (e) {
      console.log('[AgenticA11y] gemini call from', callerId, '→ error:', e.message);
      sendResponse({ error: e.message });
    }
  })();
  return true;
}

if (chrome.runtime.onUserScriptMessage) {
  chrome.runtime.onUserScriptMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'gemini') {
      return handleGeminiMessage(msg, sender, sendResponse);
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'gemini') {
    return handleGeminiMessage(msg, sender, sendResponse);
  }

  if (msg.type === 'saveApiKey') {
    chrome.storage.sync.set({ geminiApiKey: msg.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'getApiKey') {
    getApiKey().then(key => sendResponse({ apiKey: key }));
    return true;
  }

  if (msg.type === 'getActiveSkills') {
    chrome.storage.local.get(['activeSkills', 'customSkills'], (data) => {
      sendResponse({
        activeSkills: data.activeSkills || [],
        customSkills: data.customSkills || []
      });
    });
    return true;
  }

  if (msg.type === 'setActiveSkills') {
    chrome.storage.local.set({ activeSkills: msg.skills }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'saveCustomSkill') {
    chrome.storage.local.get('customSkills', (data) => {
      const customs = data.customSkills || [];
      const existing = customs.findIndex(s => s.id === msg.skill.id);
      if (existing >= 0) {
        customs[existing] = msg.skill;
      } else {
        customs.push(msg.skill);
      }
      chrome.storage.local.set({ customSkills: customs }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'deleteCustomSkill') {
    chrome.storage.local.get('customSkills', (data) => {
      const customs = (data.customSkills || []).filter(s => s.id !== msg.skillId);
      chrome.storage.local.set({ customSkills: customs }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'executeCustomSkill') {
    (async () => {
      try {
        await ensureUserScriptWorld();
        // Preferred path: chrome.userScripts.execute runs in the user-scripts
        // world whose CSP we configured to allow `unsafe-eval`, so arbitrary
        // skill code works even on strict-CSP pages (Google, GitHub, etc).
        if (userScriptsAvailable() && typeof chrome.userScripts.execute === 'function') {
          await chrome.userScripts.execute({
            target: { tabId: msg.tabId },
            js: [{ code: msg.code }],
            world: 'USER_SCRIPT',
          });
          sendResponse({ success: true });
          return;
        }
        // Fallback for older Chrome: scripting + new Function. This will fail
        // on strict-CSP pages, but works on permissive pages.
        await chrome.scripting.executeScript({
          target: { tabId: msg.tabId },
          func: (code) => {
            try {
              const fn = new Function(code);
              fn();
            } catch (e) {
              console.error('[AgenticA11y] Custom skill error:', e);
            }
          },
          args: [msg.code],
        });
        sendResponse({ success: true });
      } catch (e) {
        if (isDevModeError(e)) {
          sendResponse({
            error: 'Custom skills need Developer mode enabled. Open chrome://extensions and toggle Developer mode in the top-right, then try again.',
          });
        } else {
          sendResponse({ error: e.message });
        }
      }
    })();
    return true;
  }

  if (msg.type === 'getUserScriptsStatus') {
    (async () => {
      let result;
      try {
        const us = chrome.userScripts;
        const diag = {
          chromeVersion: (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || 'unknown',
          userScriptsType: typeof us,
          hasGetScripts: !!(us && typeof us.getScripts === 'function'),
          hasExecute: !!(us && typeof us.execute === 'function'),
          hasRegister: !!(us && typeof us.register === 'function'),
          hasConfigureWorld: !!(us && typeof us.configureWorld === 'function'),
        };
        console.log('[AgenticA11y] userScripts diag:', diag);

        if (!us || typeof us.getScripts !== 'function') {
          result = {
            available: false,
            reason: 'toggle_off',
            message: `chrome.userScripts is ${diag.userScriptsType}. Toggle "Allow user scripts" for this extension at chrome://extensions, then reload the extension.`,
            diag,
          };
        } else {
          try {
            const scripts = await us.getScripts();
            result = { available: true, registeredCount: scripts.length, diag };
          } catch (e) {
            result = {
              available: false,
              reason: isDevModeError(e) ? 'developer_mode' : 'error',
              message: e.message,
              diag,
            };
          }
        }
      } catch (e) {
        result = {
          available: false,
          reason: 'handler_crash',
          message: 'getUserScriptsStatus handler threw: ' + ((e && e.message) || String(e)),
        };
      }
      console.log('[AgenticA11y] getUserScriptsStatus →', result);
      try { sendResponse(result); }
      catch (e) { console.warn('[AgenticA11y] sendResponse failed:', e); }
    })();
    return true;
  }

  if (msg.type === 'getUserProfile') {
    chrome.storage.local.get('userProfile', (data) => {
      sendResponse({ profile: data.userProfile || null });
    });
    return true;
  }

  if (msg.type === 'saveUserProfile') {
    chrome.storage.local.set({ userProfile: msg.profile }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // --- AI Support: interpret natural language needs ---
  if (msg.type === 'interpretNeeds') {
    (async () => {
      try {
        const apiKey = await getApiKey();
        if (!apiKey) { sendResponse({ error: 'No API key' }); return; }

        const prompt = `You are an accessibility assistant for a browser extension. The user describes what they need in plain language. Map their description to specific extension settings.

Available settings (use these exact keys):
- darkMode (boolean): Dark theme
- fontScale (number 50-200): Font size percentage
- lineHeight (number 1.0-3.0): Line spacing
- letterSpacing (number 0-0.5): Letter spacing in em
- dyslexiaFont (boolean): OpenDyslexic font
- largeCursor (boolean): Larger mouse cursor
- enhanceFocus (boolean): Stronger focus indicators
- readingGuide (boolean): Horizontal reading guide
- focusMode (boolean): Highlight current paragraph
- hideDistractions (boolean): Dim ads and popups
- showProgress (boolean): Scroll progress bar
- motionReducer (boolean): Stop animations
- readerMode (boolean): Clean reading view
- keyboardNav (boolean): Enhanced keyboard navigation
- voiceCommands (boolean): Voice-controlled browsing
- contrastMode (string: "none", "light", "yellow-black"): Contrast level
- colorBlindMode (string: "none", "protanopia", "deuteranopia", "tritanopia"): Color filter
- autoWcagFix (boolean): Auto-fix accessibility issues
- autoDescribe (boolean): AI image descriptions
- autoFixLabels (boolean): AI-generated form labels
- autoCaptions (boolean): Auto captions on video
- autoSimplify (boolean): Simplify complex text
- autoSummarize (boolean): Add summaries to long content

User says: "${msg.text}"

Return ONLY valid JSON with:
{
  "summary": "One friendly sentence describing what you understood",
  "settings": { /* only keys that should change, with their values */ },
  "reasons": { /* same keys as settings, each with a short reason why */ },
  "newSkills": [ /* ONLY if the user's need CANNOT be fully met by the settings above, suggest custom skills to build. Each object has "name" (short) and "description" (1-2 sentences of what it would do). Leave as empty array [] if existing settings are sufficient. */ ]
}`;

        const result = await callGemini(prompt, apiKey);
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // --- Custom Profile CRUD ---
  if (msg.type === 'saveCustomProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = data.customProfiles || [];
      const existing = profiles.findIndex(p => p.id === msg.profile.id);
      if (existing >= 0) profiles[existing] = msg.profile;
      else profiles.push(msg.profile);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'getCustomProfiles') {
    chrome.storage.local.get('customProfiles', (data) => {
      sendResponse({ profiles: data.customProfiles || [] });
    });
    return true;
  }

  if (msg.type === 'deleteCustomProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = (data.customProfiles || []).filter(p => p.id !== msg.id);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // --- Site Classification ---
  if (msg.type === 'classifySite') {
    (async () => {
      const hostname = msg.hostname || '';
      const title = msg.title || '';

      const hostMap = {
        'youtube.com': 'video', 'vimeo.com': 'video', 'twitch.tv': 'video', 'dailymotion.com': 'video',
        'netflix.com': 'video', 'hulu.com': 'video', 'disneyplus.com': 'video',
        'reddit.com': 'social', 'twitter.com': 'social', 'x.com': 'social',
        'facebook.com': 'social', 'instagram.com': 'social', 'linkedin.com': 'social',
        'tiktok.com': 'social', 'mastodon.social': 'social', 'threads.net': 'social',
        'amazon.com': 'shopping', 'ebay.com': 'shopping', 'etsy.com': 'shopping',
        'walmart.com': 'shopping', 'target.com': 'shopping', 'shopify.com': 'shopping',
        'nytimes.com': 'news', 'cnn.com': 'news', 'bbc.com': 'news', 'bbc.co.uk': 'news',
        'reuters.com': 'news', 'washingtonpost.com': 'news', 'theguardian.com': 'news',
        'medium.com': 'news', 'substack.com': 'news',
        'wikipedia.org': 'reference', 'stackoverflow.com': 'reference',
        'docs.google.com': 'productivity', 'notion.so': 'productivity',
        'github.com': 'productivity', 'gitlab.com': 'productivity',
        'coursera.org': 'education', 'edx.org': 'education', 'khanacademy.org': 'education',
        'udemy.com': 'education', 'canvas.instructure.com': 'education',
      };

      const domain = hostname.replace(/^www\./, '');
      let siteType = null;
      for (const [pattern, type] of Object.entries(hostMap)) {
        if (domain === pattern || domain.endsWith('.' + pattern)) {
          siteType = type;
          break;
        }
      }

      if (!siteType) {
        try {
          const apiKey = await getApiKey();
          if (apiKey) {
            const result = await callGemini(
              `Classify this website into exactly one category. Hostname: "${hostname}", Title: "${title}". Categories: news, social, video, shopping, education, productivity, reference, other. Return ONLY the category word, nothing else.`,
              apiKey
            );
            const cleaned = result.trim().toLowerCase();
            const valid = ['news', 'social', 'video', 'shopping', 'education', 'productivity', 'reference', 'other'];
            siteType = valid.includes(cleaned) ? cleaned : 'other';
          }
        } catch (e) {
          siteType = 'other';
        }
      }

      if (!siteType) siteType = 'other';

      const { customProfiles } = await chrome.storage.local.get('customProfiles');
      const profiles = customProfiles || [];
      const matching = profiles.find(p => p.autoApply && p.siteTypes?.includes(siteType));

      sendResponse({ siteType, matchingProfile: matching || null });
    })();
    return true;
  }

  if (msg.type === 'openOnboarding') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'openSkillBuilder') {
    const url = msg.pendingSkills
      ? chrome.runtime.getURL('skill-builder/builder.html') + '?pending=' + encodeURIComponent(JSON.stringify(msg.pendingSkills))
      : chrome.runtime.getURL('skill-builder/builder.html');
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }
});
