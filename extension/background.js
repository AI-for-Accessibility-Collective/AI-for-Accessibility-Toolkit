/**
 * AI for Accessibility - Background Service Worker
 * Handles AI API calls for image description, text simplification, etc.
 */

// Get API keys from storage
async function getApiKeys() {
  try {
    const result = await chrome.storage.sync.get(['geminiKey', 'falKey']);
    return {
      gemini: result.geminiKey || '',
      fal: result.falKey || ''
    };
  } catch (e) {
    console.error('[AI4A11y BG] Failed to get API keys:', e);
    return { gemini: '', fal: '' };
  }
}

// ============ COLOR & CONTRAST ============

function parseColor(color) {
  // Parse rgb(r, g, b) or rgba(r, g, b, a) or hex (3, 6, or 8 digit)
  if (!color || typeof color !== 'string') return null;
  if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g);
    if (match && match.length >= 3) {
      return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
    }
  } else if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    } else if (hex.length === 8) {
      // 8-digit hex (#RRGGBBAA) - ignore alpha, extract RGB
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
  }
  return null;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function sRGBtoY(rgb) {
  // Convert sRGB to luminance for APCA
  const coeffs = [0.2126729, 0.7151522, 0.0721750];
  return rgb.map((c, i) => {
    const chan = c / 255;
    return (chan <= 0.04045 ? chan / 12.92 : Math.pow((chan + 0.055) / 1.055, 2.4)) * coeffs[i];
  }).reduce((a, b) => a + b, 0);
}

function apcaContrast(textColor, bgColor) {
  // APCA contrast calculation (simplified)
  const txtY = Math.max(0, sRGBtoY([textColor.r, textColor.g, textColor.b]));
  const bgY = Math.max(0, sRGBtoY([bgColor.r, bgColor.g, bgColor.b]));

  const Ytxt = txtY > 0.022 ? txtY : txtY + Math.pow(0.022 - txtY, 1.414);
  const Ybg = bgY > 0.022 ? bgY : bgY + Math.pow(0.022 - bgY, 1.414);

  let contrast;
  if (Ybg > Ytxt) {
    contrast = (Math.pow(Ybg, 0.56) - Math.pow(Ytxt, 0.57)) * 1.14;
  } else {
    contrast = (Math.pow(Ybg, 0.65) - Math.pow(Ytxt, 0.62)) * 1.14;
  }

  return Math.abs(contrast * 100);
}

function wcagContrastRatio(color1, color2) {
  const l1 = sRGBtoY([color1.r, color1.g, color1.b]);
  const l2 = sRGBtoY([color2.r, color2.g, color2.b]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function fixContrast(textColor, bgColor, targetRatio = 4.5) {
  // Adjust text color to meet contrast ratio
  const text = parseColor(textColor);
  const bg = parseColor(bgColor);
  if (!text || !bg) return textColor;

  const bgLuminance = sRGBtoY([bg.r, bg.g, bg.b]);

  // Decide if we need lighter or darker text
  if (bgLuminance > 0.5) {
    // Light background - darken text
    let factor = 0;
    while (factor <= 1) {
      const newR = Math.round(text.r * (1 - factor));
      const newG = Math.round(text.g * (1 - factor));
      const newB = Math.round(text.b * (1 - factor));
      const ratio = wcagContrastRatio({ r: newR, g: newG, b: newB }, bg);
      if (ratio >= targetRatio) {
        return rgbToHex(newR, newG, newB);
      }
      factor += 0.1;
    }
    return '#000000';
  } else {
    // Dark background - lighten text
    let factor = 0;
    while (factor <= 1) {
      const newR = Math.round(text.r + (255 - text.r) * factor);
      const newG = Math.round(text.g + (255 - text.g) * factor);
      const newB = Math.round(text.b + (255 - text.b) * factor);
      const ratio = wcagContrastRatio({ r: newR, g: newG, b: newB }, bg);
      if (ratio >= targetRatio) {
        return rgbToHex(newR, newG, newB);
      }
      factor += 0.1;
    }
    return '#ffffff';
  }
}

function checkContrast(textColor, bgColor) {
  const text = parseColor(textColor);
  const bg = parseColor(bgColor);
  if (!text || !bg) return null;

  const wcag = wcagContrastRatio(text, bg);
  const apca = apcaContrast(text, bg);

  return {
    wcagRatio: wcag.toFixed(2),
    apcaValue: apca.toFixed(1),
    wcagAA: wcag >= 4.5,
    wcagAAA: wcag >= 7,
    apcaPass: apca >= 60,
    fixedColor: wcag < 4.5 ? fixContrast(textColor, bgColor) : null
  };
}

// Describe image using Gemini
async function describeImage(imageDataUrl, options = {}) {
  const keys = await getApiKeys();
  if (!keys.gemini) {
    throw new Error('Gemini API key not set. Open extension settings.');
  }
  return await describeImageGemini(imageDataUrl, options, keys.gemini);
}

// Gemini image description
async function describeImageGemini(imageDataUrl, options, geminiKey) {
  console.log('[AI4A11y BG] Using Gemini');

  const base64Match = imageDataUrl.match(/^data:(image\/[\w\-\+\.]+);base64,(.+)$/);
  if (!base64Match) {
    throw new Error('Invalid image data URL');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: base64Match[1], data: base64Match[2] } },
            { text: `Alt text for screen reader. Be BRIEF and USEFUL.

CHART: "Bar chart: Sales rose from $2M (2020) to $5M (2023)"
ICON: "Sunny weather, 72F" or "Settings gear icon"
PHOTO: "Woman speaking at podium" not "A woman with brown hair..."
LOGO: "Acme Corp logo"

One sentence max. No fluff. Just the facts.` }
          ]
        }],
        generationConfig: { temperature: 0.1 }
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API error');
  }

  const data = await response.json();
  let result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  if (result.length < 5) {
    throw new Error('Gemini returned empty response');
  }

  return result;
}

// Describe canvas/chart element
async function describeElement(imageDataUrl, elementType = 'canvas', context = '') {
  const keys = await getApiKeys();
  if (!keys.gemini) {
    throw new Error('Gemini API key not set');
  }

  // For role-img without image data, use context-based description
  if (elementType === 'role-img' && context && !imageDataUrl) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Generate a short accessible name for this element with role="img".

HTML: ${context}

What would be a good aria-label? Return ONLY the label (1-5 words).`
            }]
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 30 }
        })
      }
    );

    if (!response.ok) throw new Error('Gemini API error');
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  const base64Match = imageDataUrl?.match(/^data:(image\/[\w\-\+\.]+);base64,(.+)$/);
  if (!base64Match) throw new Error('Invalid image data');

  const mimeType = base64Match[1];
  const base64Data = base64Match[2];

  const prompts = {
    canvas: `Describe this canvas for a blind user. Don't just say "canvas" or "chart" - describe the ACTUAL DATA or CONTENT shown. Include specific numbers, labels, trends. If it's interactive, explain what it does. 3-4 sentences with real details.`,
    svg: `Describe this SVG graphic for a blind user. Don't just label it - describe what it actually shows. Include specific text, data values, or what it represents. 2-3 sentences.`,
    chart: `Describe this chart's DATA for a blind user. Include:
- What is being measured (axis labels)
- Key data points and values
- Trends (increasing, decreasing, comparison)
- The main takeaway
Do NOT just say "bar chart" or "line graph" - describe what the data shows. 3-4 sentences.`,
    webgl: 'Describe this 3D content for a blind user. What objects are shown? What is the scene? What can the user interact with? 2-3 sentences.',
    'role-img': 'Describe what this image represents for a screen reader user. 1-2 sentences max.',
    'video frame': `Describe this video frame in detail for a blind or low-vision user who cannot see the video.

Include:
1. WHO: People visible - their appearance, clothing, expressions, actions, approximate ages
2. WHERE: Setting/location - indoor/outdoor, type of place, notable features
3. WHAT: What is happening - actions, interactions, objects being used
4. TEXT: Any visible text, titles, captions, signs, logos
5. MOOD: Overall tone - formal, casual, dramatic, educational, etc.

Be thorough and specific. This description replaces the video content for someone who cannot see it.
Aim for 4-6 detailed sentences.`
  };

  const isVideoFrame = elementType === 'video frame';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: prompts[elementType] || prompts.canvas }
          ]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: isVideoFrame ? 500 : 200 }
      })
    }
  );

  if (!response.ok) throw new Error('Gemini API error');
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// Describe video from multiple frames OR video URL
async function describeVideoFrames(frames, metadata = {}) {
  const keys = await getApiKeys();
  if (!keys.gemini) {
    throw new Error('Gemini API key not set');
  }

  const durationInfo = metadata.duration ? `Video duration: ${Math.round(metadata.duration)} seconds.` : '';
  const titleInfo = metadata.title ? `Video title: "${metadata.title}".` : '';

  const prompt = `Describe this video for a blind or low-vision user who cannot see it.

${titleInfo} ${durationInfo}

Include:
1. OVERVIEW: What is this video about? What type of content is it?
2. PEOPLE: Who appears? Describe their appearance, clothing, and roles.
3. SETTING: Where does it take place? Describe the environment(s).
4. ACTION: What happens? Describe the progression of events/scenes.
5. KEY VISUALS: Important text, graphics, demonstrations shown.
6. TONE: What is the mood or style?

Write a comprehensive description (6-10 sentences) that helps someone understand what they would see.`;

  // Build parts array
  const parts = [];

  // If we have frames (base64 images), add them
  if (frames && frames.length > 0) {
    for (const frame of frames) {
      const base64Match = frame.match(/^data:(image\/[\w\-\+\.]+);base64,(.+)$/);
      if (base64Match) {
        parts.push({ inlineData: { mimeType: base64Match[1], data: base64Match[2] } });
      }
    }
    parts.push({ text: `These are ${frames.length} frames sampled from a video at equal intervals.\n\n${prompt}` });
  }
  // If we have a video URL, try to use Gemini's video capability
  else if (metadata.videoUrl) {
    // For video URLs, we'll upload to Gemini's File API first
    const videoDescription = await describeVideoFromUrl(metadata.videoUrl, prompt, keys.gemini);
    return videoDescription;
  }
  else {
    throw new Error('No frames or video URL provided');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${err.error?.message || response.status}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// Describe video using Gemini Files API (more robust than inline)
async function describeVideoFromUrl(videoUrl, prompt, apiKey) {
  console.log('[AI4A11y BG] Attempting to describe video from URL:', videoUrl?.substring(0, 80));

  if (videoUrl?.startsWith('blob:')) {
    throw new Error('Cannot access blob: URLs - video is dynamically loaded');
  }

  try {
    // Step 1: Fetch the video
    console.log('[AI4A11y BG] Fetching video...');
    const videoResponse = await fetch(videoUrl, { credentials: 'omit' });
    if (!videoResponse.ok) {
      throw new Error(`HTTP ${videoResponse.status}`);
    }

    let mimeType = videoResponse.headers.get('content-type') || 'video/mp4';
    if (mimeType.includes(';')) mimeType = mimeType.split(';')[0].trim();
    if (!mimeType.startsWith('video/')) {
      if (videoUrl.includes('.mp4')) mimeType = 'video/mp4';
      else if (videoUrl.includes('.webm')) mimeType = 'video/webm';
      else mimeType = 'video/mp4';
    }

    const videoBlob = await videoResponse.blob();
    const sizeMB = videoBlob.size / 1024 / 1024;
    console.log('[AI4A11y BG] Video:', mimeType, sizeMB.toFixed(2), 'MB');

    if (sizeMB > 50) {
      throw new Error('Video too large (>50MB)');
    }

    // Step 2: Upload to Gemini Files API
    console.log('[AI4A11y BG] Uploading to Gemini Files API...');
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

    const metadata = JSON.stringify({ file: { displayName: 'video_for_description' } });

    // Create multipart form
    const boundary = '---FormBoundary' + Math.random().toString(36).substring(2);
    const body = new Blob([
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadata,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      videoBlob,
      `\r\n--${boundary}--\r\n`
    ]);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: body
    });

    if (!uploadResponse.ok) {
      const err = await uploadResponse.json().catch(() => ({}));
      console.error('[AI4A11y BG] Upload failed:', err);
      throw new Error(`Upload failed: ${err.error?.message || uploadResponse.status}`);
    }

    const uploadData = await uploadResponse.json();
    const fileUri = uploadData.file?.uri;
    console.log('[AI4A11y BG] Uploaded file URI:', fileUri);

    if (!fileUri) {
      throw new Error('No file URI returned from upload');
    }

    // Step 3: Wait for file to be processed
    let fileState = uploadData.file?.state;
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const checkResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadData.file.name}?key=${apiKey}`);
      if (!checkResponse.ok) {
        console.warn('[AI4A11y BG] File check failed, retrying...');
        attempts++;
        continue;
      }
      const checkData = await checkResponse.json();
      fileState = checkData.state;
      console.log('[AI4A11y BG] File state:', fileState);
      attempts++;
    }

    if (fileState !== 'ACTIVE') {
      throw new Error(`File processing failed (state: ${fileState})`);
    }

    // Step 4: Generate content with the file
    console.log('[AI4A11y BG] Generating description...');
    const genResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { fileData: { mimeType, fileUri } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
        })
      }
    );

    if (!genResponse.ok) {
      const err = await genResponse.json().catch(() => ({}));
      throw new Error(`Gemini: ${err.error?.message || genResponse.status}`);
    }

    const data = await genResponse.json();
    console.log('[AI4A11y BG] Gemini response:', JSON.stringify(data).substring(0, 500));

    if (!data.candidates?.length) {
      const reason = data.promptFeedback?.blockReason || 'unknown';
      throw new Error(`Gemini blocked: ${reason}`);
    }

    const result = data.candidates[0]?.content?.parts?.[0]?.text?.trim();
    if (!result) {
      throw new Error('Empty response from Gemini');
    }

    // Clean up: delete the uploaded file
    try {
      await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadData.file.name}?key=${apiKey}`, {
        method: 'DELETE'
      });
    } catch (e) { /* ignore cleanup errors */ }

    console.log('[AI4A11y BG] Got description, length:', result.length);
    return result;

  } catch (e) {
    console.error('[AI4A11y BG] Video processing failed:', e);
    throw new Error(e.message);
  }
}

// Simplify text for cognitive accessibility
async function simplifyText(text) {
  // Clean up whitespace
  text = text.trim().replace(/\s+/g, ' ');
  console.log('[AI4A11y BG] simplifyText called, text length:', text.length);
  const keys = await getApiKeys();
  console.log('[AI4A11y BG] API key present:', !!keys.gemini);
  if (!keys.gemini) {
    throw new Error('Gemini API key not set');
  }

  console.log('[AI4A11y BG] Calling Gemini API...');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Rewrite this text using simpler language, but KEEP ALL THE INFORMATION.

ORIGINAL TEXT:
${text}

RULES:
- Use common, everyday words (6th-grade vocabulary)
- Break long sentences into shorter ones
- Keep EVERY fact, detail, and point from the original
- The simplified version should be roughly the SAME LENGTH as the original
- Do NOT summarize or shorten - rewrite with simpler words
- No bullet points, no markdown, plain text only
- Maintain the same paragraph structure

This is for cognitive accessibility - make it easier to read while preserving all content.

Return ONLY the simplified text:`
          }]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
      })
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('[AI4A11y BG] Gemini API error:', response.status, errData);
    throw new Error(`Gemini API error: ${response.status} - ${errData.error?.message || 'Unknown'}`);
  }
  const data = await response.json();
  const finishReason = data.candidates?.[0]?.finishReason;
  let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Clean up output: trim, remove markdown bullets/formatting, normalize whitespace
  resultText = resultText
    .trim()
    .replace(/^[\s•\-\*]+/gm, '')  // Remove leading bullets/dashes
    .replace(/\*\*/g, '')          // Remove bold markdown
    .replace(/\n{3,}/g, '\n\n')    // Max 2 newlines
    .replace(/^\s+/gm, '')         // Remove leading whitespace per line
    .trim();

  console.log('[AI4A11y BG] Gemini response OK, finishReason:', finishReason, 'length:', resultText?.length);

  // If truncated, return original
  if (finishReason === 'MAX_TOKENS') {
    console.warn('[AI4A11y BG] Response truncated, returning original');
    return text;
  }
  return resultText || text;
}

// Summarize long text
async function summarizeText(text) {
  text = text.trim().replace(/\s+/g, ' ');
  console.log('[AI4A11y BG] summarizeText called, text length:', text.length);

  const keys = await getApiKeys();
  if (!keys.gemini) {
    throw new Error('Gemini API key not set');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Summarize this text in 2-3 sentences. Keep the key points. Use simple language.

${text}

Return ONLY the summary, nothing else.`
          }]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
      })
    }
  );

  if (!response.ok) {
    throw new Error('Gemini API error');
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
}

// Transcribe audio/video using Fal Whisper or Gemini
async function transcribeAudio(mediaUrl) {
  console.log('[AI4A11y BG] transcribeAudio called with:', mediaUrl?.substring(0, 80));
  const keys = await getApiKeys();

  // Skip blob URLs - can't be fetched
  if (mediaUrl?.startsWith('blob:')) {
    throw new Error('Cannot transcribe blob: URLs');
  }

  // Try Fal Whisper first if key is set
  if (keys.fal) {
    try {
      const response = await fetch('https://fal.run/fal-ai/wizper', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${keys.fal}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio_url: mediaUrl,
          task: 'transcribe',
          language: 'en',
          chunk_level: 'segment'
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text && data.text.trim().length > 0) {
          console.log('[AI4A11y BG] Fal transcription complete');
          return { type: 'transcript', text: data.text };
        } else {
          // No speech detected
          console.log('[AI4A11y BG] Fal: no speech detected');
          return { type: 'no-speech', text: 'No speech detected in audio' };
        }
      }
    } catch (e) {
      console.warn('[AI4A11y BG] Fal failed, trying Gemini:', e.message);
    }
  }

  // Fall back to Gemini (fetch video ourselves, upload to Gemini)
  if (keys.gemini) {
    return await transcribeWithGemini(mediaUrl, keys.gemini);
  }

  throw new Error('No API key set (need Gemini or Fal)');
}

// Transcribe video/audio using Gemini (fetches the file server-side)
async function transcribeWithGemini(mediaUrl, apiKey) {
  console.log('[AI4A11y BG] Transcribing with Gemini:', mediaUrl?.substring(0, 80));

  try {
    // Fetch the media file (background script bypasses CORS)
    const response = await fetch(mediaUrl, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let mimeType = response.headers.get('content-type') || 'video/mp4';
    if (mimeType.includes(';')) mimeType = mimeType.split(';')[0].trim();

    const blob = await response.blob();
    const sizeMB = blob.size / 1024 / 1024;
    console.log('[AI4A11y BG] Media file:', mimeType, sizeMB.toFixed(2), 'MB');

    if (sizeMB > 50) throw new Error('File too large (>50MB)');

    // Upload to Gemini Files API
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
    const metadata = JSON.stringify({ file: { displayName: 'media_for_transcription' } });
    const boundary = '---FormBoundary' + Math.random().toString(36).substring(2);

    const body = new Blob([
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadata,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`
    ]);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });

    if (!uploadResponse.ok) {
      const err = await uploadResponse.json().catch(() => ({}));
      throw new Error(`Upload failed: ${err.error?.message || uploadResponse.status}`);
    }

    const uploadData = await uploadResponse.json();
    const fileUri = uploadData.file?.uri;
    if (!fileUri) throw new Error('No file URI returned');

    // Wait for processing
    let fileState = uploadData.file?.state;
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const checkResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadData.file.name}?key=${apiKey}`);
      if (!checkResponse.ok) {
        console.warn('[AI4A11y BG] File check failed, retrying...');
        attempts++;
        continue;
      }
      const checkData = await checkResponse.json();
      fileState = checkData.state;
      attempts++;
    }

    if (fileState !== 'ACTIVE') throw new Error(`Processing failed: ${fileState}`);

    // Ask Gemini to transcribe AND describe audio
    const genResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { fileData: { mimeType, fileUri } },
              { text: `Analyze this video/audio for accessibility:

1. If there is SPEECH: Transcribe all spoken words verbatim.
   - Include speaker labels if multiple speakers
   - Output the full transcript

2. If there is NO SPEECH but there IS audio (music, sound effects):
   - Start with "[Audio description]"
   - Describe the audio: music genre/mood, sound effects, ambient sounds
   - Example: "[Audio description] Upbeat electronic music plays. Sound effects: whoosh, click, chime."

3. If there is NO AUDIO at all:
   - Write "[Silent video]"

Output ONLY one of the above formats, nothing else.` }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8000 }
        })
      }
    );

    if (!genResponse.ok) {
      const err = await genResponse.json().catch(() => ({}));
      throw new Error(`Gemini: ${err.error?.message || genResponse.status}`);
    }

    const data = await genResponse.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Cleanup uploaded file
    try {
      await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadData.file.name}?key=${apiKey}`, { method: 'DELETE' });
    } catch (e) { /* ignore */ }

    if (!result) {
      throw new Error('Empty transcription result');
    }

    // Determine result type
    if (result.includes('[Silent video]')) {
      console.log('[AI4A11y BG] Silent video detected');
      return { type: 'silent', text: result };
    } else if (result.includes('[Audio description]')) {
      console.log('[AI4A11y BG] Audio description (music/sfx, no speech)');
      return { type: 'audio-description', text: result };
    } else if (result.includes('[No speech') || result.toLowerCase().includes('no speech')) {
      console.log('[AI4A11y BG] No speech detected');
      return { type: 'no-speech', text: result };
    }

    console.log('[AI4A11y BG] Gemini transcription complete, length:', result.length);
    return { type: 'transcript', text: result };

  } catch (e) {
    console.error('[AI4A11y BG] Gemini transcription failed:', e);
    throw e;
  }
}

// Describe audio/sound using Gemini
async function describeSound(audioDataUrl) {
  console.log('[AI4A11y BG] describeSound called');
  const keys = await getApiKeys();
  if (!keys.gemini) {
    throw new Error('Gemini API key not set');
  }

  const base64Match = audioDataUrl.match(/^data:audio\/([\w\-\+\.]+);base64,(.+)$/);
  if (!base64Match) {
    throw new Error('Invalid audio data URL');
  }

  const mimeType = `audio/${base64Match[1]}`;
  const base64Data = base64Match[2];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: 'Describe this audio for a deaf user. Include: what sounds are present, music/speech, mood, and any important audio information. 2-3 sentences max.' }
          ]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
      })
    }
  );

  if (!response.ok) throw new Error('Gemini API error');
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// Improve link text
async function improveLinkText(linkText, href, surroundingText) {
  const keys = await getApiKeys();
  if (!keys.gemini) return linkText;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Improve this ambiguous link text for screen reader users.

Current link text: "${linkText}"
Link URL: ${href}
Surrounding context: "${surroundingText}"

Generate a short, descriptive link text (2-5 words) that explains where the link goes.
Return only the improved link text.`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 30 }
      })
    }
  );

  if (!response.ok) return linkText;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || linkText;
}

// Infer element name from context
async function inferElementName(elementType, html, context) {
  const keys = await getApiKeys();
  if (!keys.gemini) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate a short accessible name for this ${elementType} element.

HTML: ${html}
Surrounding context: "${context}"

Return ONLY a short name (1-4 words) that describes what this element does.
If you cannot determine the purpose, return "Unknown ${elementType}".`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 20 }
      })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// Generate heading text from content
async function generateHeading(content) {
  const keys = await getApiKeys();
  if (!keys.gemini) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate a short heading (2-5 words) that summarizes this content:

"${content}"

Return ONLY the heading text, nothing else.`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 20 }
      })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// Infer column header from sample data
async function inferColumnHeader(sampleData) {
  if (!Array.isArray(sampleData) || sampleData.length === 0) return null;
  const keys = await getApiKeys();
  if (!keys.gemini) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `What is the best column header for this data? Sample values:
${sampleData.map(d => `- ${d}`).join('\n')}

Return ONLY a short header name (1-3 words).`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 15 }
      })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// Fetch YouTube auto-generated transcript
async function getYouTubeTranscript(videoId) {
  console.log('[AI4A11y BG] Fetching YouTube transcript for:', videoId);

  try {
    // Fetch the video page to get caption track URL
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const pageText = await pageResponse.text();

    // Extract captions URL from page
    const captionsMatch = pageText.match(/"captions":\s*(\{[^}]+\})/);
    if (!captionsMatch) {
      // Try alternative pattern
      const timedTextMatch = pageText.match(/timedtext[^"]*videoId[^"]*"/);
      if (!timedTextMatch) {
        throw new Error('No captions available for this video');
      }
    }

    // Look for the playerCaptionsTracklistRenderer
    const tracklistMatch = pageText.match(/"playerCaptionsTracklistRenderer":\s*\{[^}]*"captionTracks":\s*\[([\s\S]*?)\]/);
    if (!tracklistMatch) {
      throw new Error('No caption tracks found');
    }

    // Parse caption tracks to find English or auto-generated
    const tracksJson = '[' + tracklistMatch[1] + ']';
    let tracks;
    try {
      // Clean up the JSON (YouTube's format is messy)
      const cleanJson = tracksJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      tracks = JSON.parse(cleanJson);
    } catch (e) {
      // Try regex extraction
      const urlMatch = tracklistMatch[1].match(/"baseUrl":\s*"([^"]+)"/);
      if (urlMatch) {
        const captionUrl = urlMatch[1].replace(/\\u0026/g, '&');
        const captionResponse = await fetch(captionUrl);
        const captionXml = await captionResponse.text();
        return parseYouTubeCaptions(captionXml);
      }
      throw new Error('Could not parse caption tracks');
    }

    // Find best track (prefer English, then auto-generated)
    let bestTrack = tracks.find(t => t.languageCode === 'en' && !t.kind) ||
                    tracks.find(t => t.languageCode === 'en') ||
                    tracks.find(t => t.kind === 'asr') ||
                    tracks[0];

    if (!bestTrack?.baseUrl) {
      throw new Error('No usable caption track found');
    }

    // Fetch captions
    const captionUrl = bestTrack.baseUrl.replace(/\\u0026/g, '&');
    const captionResponse = await fetch(captionUrl);
    const captionXml = await captionResponse.text();

    return parseYouTubeCaptions(captionXml);

  } catch (e) {
    console.error('[AI4A11y BG] YouTube transcript failed:', e);
    throw e;
  }
}

// Parse YouTube caption XML format
function parseYouTubeCaptions(xml) {
  const textMatches = xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
  const lines = [];

  for (const match of textMatches) {
    let text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (text) lines.push(text);
  }

  if (lines.length === 0) {
    throw new Error('No caption text found');
  }

  return lines.join(' ');
}

// Generate summary text for details/summary elements
async function generateSummaryText(content) {
  const keys = await getApiKeys();
  if (!keys.gemini) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate a short summary label (2-4 words) for this collapsible content:

"${content}"

Return ONLY the summary text, nothing else. Example: "More details", "Payment options", "Technical specs"`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 15 }
      })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AI4A11y BG] Received message:', message.type);

  const handlers = {
    'describeImage': () => describeImage(message.imageData, message.options),
    'describeElement': () => describeElement(message.imageData, message.elementType, message.context),
    'describeVideoFrames': () => describeVideoFrames(message.frames, message.metadata),
    'simplifyText': () => simplifyText(message.text),
    'summarizeText': () => summarizeText(message.text),
    'transcribeAudio': () => transcribeAudio(message.audioUrl || message.audioData),
    'transcribeVideo': () => transcribeAudio(message.audioUrl || message.audioData),
    'describeSound': () => describeSound(message.audioUrl || message.audioData),
    'improveLinkText': () => improveLinkText(message.linkText, message.href, message.context),
    'inferElementName': () => inferElementName(message.elementType, message.html, message.context),
    'inferLabel': () => inferElementName(message.elementType, message.html, message.context),
    'generateHeading': () => generateHeading(message.content),
    'inferColumnHeader': () => inferColumnHeader(message.sampleData),
    'generateSummary': () => generateSummaryText(message.content),
    'getYouTubeTranscript': () => getYouTubeTranscript(message.videoId),
    'checkContrast': () => Promise.resolve(checkContrast(message.textColor || message.foreground, message.bgColor || message.background)),
    'fixContrast': () => Promise.resolve(fixContrast(message.textColor || message.foreground, message.bgColor || message.background, message.targetRatio || 4.5)),
    'speak': () => new Promise((resolve, reject) => {
      chrome.tts.speak(message.text, {
        rate: message.rate || 1.0,
        pitch: message.pitch || 1.0,
        volume: message.volume || 1.0
      }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true });
        }
      });
    },
    'getSettings': () => chrome.storage.sync.get([
      'enabled', 'autoDescribe', 'autoSimplify', 'autoSummarize', 'autoWcagFix', 'autoFixLabels',
      'autoVideoDescribe', 'autoCaptions', 'fixContrast',
      'darkMode', 'readerMode', 'focusMode', 'keyboardNav', 'voiceCommands', 'motionReducer',
      'hideDistractions', 'showProgress', 'colorBlindMode',
      'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode',
      'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide',
      'selectedProfiles', 'geminiKey', 'falKey'
    ])
  };

  const handler = handlers[message.type];
  if (handler) {
    handler()
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Set default settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['enabled'], (result) => {
    if (result.enabled === undefined) {
      chrome.storage.sync.set({
        enabled: true,
        // AI features
        autoWcagFix: true,
        autoDescribe: true,
        autoSimplify: false,
        autoSummarize: false,
        autoFixLabels: true,
        autoVideoDescribe: false,
        autoCaptions: false,
        fixContrast: true,
        // Visual features
        darkMode: false,
        readerMode: false,
        focusMode: false,
        keyboardNav: false,
        voiceCommands: false,
        motionReducer: false,
        hideDistractions: false,
        showProgress: true,
        colorBlindMode: 'none',
        contrastMode: 'none',
        // Visual assist
        fontScale: 100,
        lineHeight: 1.5,
        letterSpacing: 0,
        dyslexiaFont: false,
        largeCursor: false,
        enhanceFocus: false,
        readingGuide: false,
        speechRate: 1,
        // Profile
        selectedProfile: 'none'
      });
    }
  });
});
