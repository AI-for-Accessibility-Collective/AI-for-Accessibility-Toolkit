let _provider = null;

export function setAIProvider(provider) {
  _provider = provider;
}

export function getAIProvider() {
  return _provider;
}

export async function callAI(prompt) {
  if (!_provider) throw new Error('No AI provider set');
  if (typeof _provider === 'function') return _provider(prompt);
  if (_provider.sendToBackground) return _provider.sendToBackground(prompt);
  throw new Error('Invalid AI provider');
}

export async function describeImage(imageData) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.describeImage(imageData);
}

export async function describeVideo(frames) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.describeVideo(frames);
}

export async function simplifyText(text, options) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.simplifyText(text, options);
}

export async function summarizeText(text) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.summarizeText(text);
}

export async function generateLabels(context) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.generateLabels(context);
}

export async function generateCaptions(audioData) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.generateCaptions(audioData);
}

export async function inferLabel(context) {
  if (!_provider) throw new Error('No AI provider set');
  return _provider.inferLabel(context);
}

export async function fixContrast(foreground, background) {
  if (!_provider?.fixContrast) return null;
  return _provider.fixContrast(foreground, background);
}

export async function getYouTubeTranscript(videoId) {
  if (!_provider?.getYouTubeTranscript) return null;
  return _provider.getYouTubeTranscript(videoId);
}

export async function transcribeVideo(videoUrl) {
  if (!_provider?.transcribeVideo) return null;
  return _provider.transcribeVideo(videoUrl);
}

export async function transcribeAudio(audioUrl) {
  if (!_provider?.transcribeAudio) return null;
  return _provider.transcribeAudio(audioUrl);
}

export async function describeElement(element, context) {
  if (!_provider?.describeElement) return null;
  return _provider.describeElement(element, context);
}

export async function translateText(text, targetLang) {
  if (!_provider?.translateText) return null;
  return _provider.translateText(text, targetLang);
}

export async function defineWord(word, context) {
  if (!_provider?.defineWord) return null;
  return _provider.defineWord(word, context);
}

export function announce(message) {
  if (_provider?.announce) {
    _provider.announce(message);
  }
}

export function createChromeAIProvider() {
  function sendToBackground(prompt, images) {
    return new Promise((resolve, reject) => {
      const msg = { type: 'gemini', prompt };
      if (images) msg.images = images;
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response?.result || '');
      });
    });
  }

  return {
    sendToBackground,

    async describeImage(imageData) {
      return sendToBackground(
        'Describe this image concisely for use as alt text on a webpage. Be specific and brief (under 125 characters). Return ONLY the alt text.',
        [imageData]
      );
    },

    async describeVideo(frames) {
      return sendToBackground(
        'These are frames from a video. Describe what is happening in the video concisely for accessibility purposes. Return ONLY the description.',
        frames
      );
    },

    async simplifyText(text) {
      return sendToBackground(`Simplify the following text to a 6th-grade reading level. Keep the meaning but use simpler words and shorter sentences. Return ONLY the simplified text.\n\n${text}`);
    },

    async summarizeText(text) {
      return sendToBackground(`Summarize the following text in 2-3 concise sentences. Return ONLY the summary.\n\n${text}`);
    },

    async translateText(text, targetLang) {
      return sendToBackground(`Translate the following text into ${targetLang || 'English'}. Preserve the meaning and tone. Return ONLY the translated text.\n\n${text}`);
    },

    async defineWord(word, context) {
      return sendToBackground(`Define the word or phrase "${word}" in one short, plain-language sentence, as used in: "${context || ''}". Return ONLY the definition.`);
    },

    async generateLabels(context) {
      const { elements } = context;
      return sendToBackground(`Generate accessible labels for the following elements. Return a JSON array of labels.\n\n${JSON.stringify(elements)}`);
    },

    async generateCaptions(audioData) {
      return sendToBackground(`Generate captions for the following audio data. Return timestamped captions.\n\n${audioData}`);
    },

    async inferLabel(context) {
      const { elementType, url, existingText, context: ctx, svgContent } = context;
      let prompt = `Generate a short, accessible label for a ${elementType || 'element'}.`;
      if (url) prompt += ` URL: ${url}`;
      if (existingText) prompt += ` Existing text: ${existingText}`;
      if (ctx) prompt += ` Context: ${ctx}`;
      if (svgContent) prompt += ` SVG content: ${svgContent}`;
      prompt += ` Return ONLY the label text, nothing else.`;
      return sendToBackground(prompt);
    },

    async fixContrast(foreground, background) {
      const result = await sendToBackground(`Given foreground color "${foreground}" on background "${background}", suggest a new foreground color that meets WCAG AA contrast ratio (4.5:1). Return ONLY the hex color code, e.g. #1a2b3c.`);
      return result?.trim() || null;
    },

    async getYouTubeTranscript(videoId) {
      return null;
    },

    async transcribeVideo(videoUrl) {
      return null;
    },

    async transcribeAudio(audioUrl) {
      return null;
    },

    async describeElement(element, context) {
      return null;
    },

    announce(message) {
      let region = document.getElementById('ai4a11y-announcer');
      if (!region) {
        region = document.createElement('div');
        region.id = 'ai4a11y-announcer';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('aria-atomic', 'true');
        region.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
        document.body.appendChild(region);
      }
      region.textContent = message;
    }
  };
}
