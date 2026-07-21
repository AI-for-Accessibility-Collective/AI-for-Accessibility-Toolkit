// Convert image element to data URL
export async function imageToDataUrl(img) {
  // If already a data URL or blob
  if (img.src?.startsWith('data:') || img.src?.startsWith('blob:')) {
    return img.src;
  }

  // Try to fetch and convert
  try {
    const response = await fetch(img.src);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    // Fallback: draw to canvas
    return imageToCanvas(img);
  }
}

// Draw image to canvas and get data URL
export function imageToCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  try {
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[AI4A11y] Canvas tainted, cannot export:', e);
    return null;
  }
}

// Capture video frame as data URL
export function captureVideoFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 360;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  try {
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[AI4A11y] Canvas tainted (CORS), cannot capture frame:', e);
    return null;
  }
}

// Capture multiple frames from video
export async function captureVideoFrames(video, numFrames = 6) {
  // Validate numFrames to prevent issues with invalid input
  numFrames = Math.min(Math.max(1, Math.floor(numFrames) || 6), 30);

  const frames = [];
  const duration = video.duration || 0;

  if (!duration || duration < 1) {
    // Single frame for very short or live videos
    frames.push(captureVideoFrame(video));
    return frames;
  }

  const interval = duration / (numFrames + 1);
  const originalTime = video.currentTime;

  try {
    for (let i = 1; i <= numFrames; i++) {
      video.currentTime = interval * i;
      await new Promise(resolve => {
        video.onseeked = resolve;
        setTimeout(resolve, 500); // Timeout fallback
      });
      frames.push(captureVideoFrame(video));
    }
  } finally {
    video.currentTime = originalTime;
  }

  return frames;
}

// Get image dimensions
export function getImageSize(img) {
  return {
    width: img.naturalWidth || img.width || 0,
    height: img.naturalHeight || img.height || 0
  };
}

// Check if image is likely decorative (small icon, spacer, etc.)
export function isLikelyDecorative(img) {
  const { width, height } = getImageSize(img);

  // Very small images are likely icons/spacers
  if (width < 20 && height < 20) return true;

  // 1x1 tracking pixels
  if (width === 1 && height === 1) return true;

  // Has presentation role
  if (img.getAttribute('role') === 'presentation') return true;
  if (img.getAttribute('role') === 'none') return true;

  return false;
}
