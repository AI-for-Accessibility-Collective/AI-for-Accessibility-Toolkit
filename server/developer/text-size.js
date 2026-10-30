// The text size control in the top bar. It scales the whole console (every
// size is in rem) and is remembered in this browser only.

const KEY = 'ai4a11y.developer.text-scale';
const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Wire the control: buttons #text-smaller, #text-reset, #text-larger. */
export function setupTextSize(doc = document) {
  const smaller = doc.getElementById('text-smaller');
  const reset = doc.getElementById('text-reset');
  const larger = doc.getElementById('text-larger');
  let saved = 1;
  try { saved = Number(localStorage.getItem(KEY)) || 1; } catch { /* storage blocked */ }
  let index = SCALES.indexOf(saved);
  if (index < 0) index = SCALES.indexOf(1);

  function apply(next, remember = true) {
    index = Math.min(SCALES.length - 1, Math.max(0, next));
    const scale = SCALES[index];
    doc.documentElement.style.setProperty('--text-scale', String(scale));
    const percent = `${Math.round(scale * 100)}%`;
    reset.textContent = percent;
    reset.setAttribute('aria-label', `${percent}, back to the default text size`);
    smaller.disabled = index === 0;
    larger.disabled = index === SCALES.length - 1;
    if (remember) {
      try {
        if (scale === 1) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, String(scale));
      } catch { /* storage blocked */ }
    }
  }

  smaller.addEventListener('click', () => apply(index - 1));
  larger.addEventListener('click', () => apply(index + 1));
  reset.addEventListener('click', () => apply(SCALES.indexOf(1)));
  apply(index, false);
}
