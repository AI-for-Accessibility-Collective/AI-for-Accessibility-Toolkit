// AI Provider Abstraction
// Adapters call these functions; the provider is set by extension or CLI

let provider = null;

export function setAIProvider(p) {
  provider = p;
}

export function getAIProvider() {
  return provider;
}

export async function describeImage(imageData) {
  if (!provider?.describeImage) {
    throw new Error('AI provider not set or missing describeImage');
  }
  return provider.describeImage(imageData);
}

export async function describeVideo(frames) {
  if (!provider?.describeVideo) {
    throw new Error('AI provider not set or missing describeVideo');
  }
  return provider.describeVideo(frames);
}

export async function simplifyText(text, options = {}) {
  if (!provider?.simplifyText) {
    throw new Error('AI provider not set or missing simplifyText');
  }
  return provider.simplifyText(text, options);
}

export async function generateLabels(context) {
  if (!provider?.generateLabels) {
    throw new Error('AI provider not set or missing generateLabels');
  }
  return provider.generateLabels(context);
}

export async function generateCaptions(audioData) {
  if (!provider?.generateCaptions) {
    throw new Error('AI provider not set or missing generateCaptions');
  }
  return provider.generateCaptions(audioData);
}

export async function summarizeText(text) {
  if (!provider?.summarizeText) {
    throw new Error('AI provider not set or missing summarizeText');
  }
  return provider.summarizeText(text);
}

export async function inferLabel(context) {
  if (!provider?.inferLabel) {
    throw new Error('AI provider not set or missing inferLabel');
  }
  return provider.inferLabel(context);
}

export async function fixContrast(foreground, background) {
  if (!provider?.fixContrast) {
    return null; // Fallback handled by caller
  }
  return provider.fixContrast(foreground, background);
}

export async function getYouTubeTranscript(videoId) {
  if (!provider?.getYouTubeTranscript) {
    return null;
  }
  return provider.getYouTubeTranscript(videoId);
}

// Screen reader announcement (extension provides this, CLI may skip)
export function announce(message) {
  if (provider?.announce) {
    provider.announce(message);
  }
}

export async function transcribeVideo(videoUrl) {
  if (!provider?.transcribeVideo) {
    return null;
  }
  return provider.transcribeVideo(videoUrl);
}

export async function transcribeAudio(audioUrl) {
  if (!provider?.transcribeAudio) {
    return null;
  }
  return provider.transcribeAudio(audioUrl);
}

export async function describeElement(element, context = {}) {
  if (!provider?.describeElement) {
    return null;
  }
  return provider.describeElement(element, context);
}
