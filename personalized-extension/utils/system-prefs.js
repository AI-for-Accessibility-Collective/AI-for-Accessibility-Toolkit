// utils/system-prefs.js — observable OS preference signals.
//
// Implements the watchSystemPrefs() sketch from observable-settings.md.
// Five media queries, change listeners, initial read.
//
// Wire ONE consumer per wave:
//   Wave 1b (this wave): reducedMotion → auto-enable MotionReducer (see content.js)
//   Wave 2a: moreContrast / forcedColors → suggest/enable fix-contrast / visual-assist
//   Wave 2a: dark → suggest dark-mode (already 0/2 demand; just a notice)
//   Wave 2a: reducedTransparency → (no adapter yet; read-but-unconsumed)

const QUERIES = {
  reducedMotion:       '(prefers-reduced-motion: reduce)',
  dark:                '(prefers-color-scheme: dark)',
  moreContrast:        '(prefers-contrast: more)',
  forcedColors:        '(forced-colors: active)',
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
};

/**
 * Watch OS/browser media-query preference signals.
 *
 * Calls onChange(state) immediately with the current values, then again
 * whenever any signal changes.  `state` is a plain object:
 *   { reducedMotion, dark, moreContrast, forcedColors, reducedTransparency }
 * each value is a boolean.
 *
 * Returns a cleanup function that removes all listeners.
 *
 * @param {function(state: object): void} onChange
 * @returns {function(): void}  unwatch
 */
export function watchSystemPrefs(onChange) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // Non-browser context (Node/tests without DOM): fire once with all-false.
    onChange({ reducedMotion: false, dark: false, moreContrast: false, forcedColors: false, reducedTransparency: false });
    return () => {};
  }

  const mqs = Object.fromEntries(
    Object.entries(QUERIES).map(([k, q]) => [k, window.matchMedia(q)])
  );

  function read() {
    onChange(Object.fromEntries(
      Object.entries(mqs).map(([k, mq]) => [k, mq.matches])
    ));
  }

  // Add change listeners before the initial read to avoid a race where a
  // signal flips between now and when addEventListener fires.
  const handlers = {};
  for (const [k, mq] of Object.entries(mqs)) {
    handlers[k] = () => read();
    mq.addEventListener('change', handlers[k]);
  }

  read(); // synchronous initial delivery

  return function unwatch() {
    for (const [k, mq] of Object.entries(mqs)) {
      mq.removeEventListener('change', handlers[k]);
    }
  };
}
