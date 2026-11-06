/** Pure player timing logic: relative video seconds, half-open [start,end) cues.
 * When ASR cues overlap, prefer the most recently started cue.
 */
export function selectActiveCue(cues, time) {
  if (!Number.isFinite(time) || time < 0) return null;
  let found = null;
  for (const cue of cues) {
    if (cue.start > time) break;
    if (time < cue.end) found = cue;
  }
  return found;
}

export function nextCue(cues, currentTime) {
  return cues.find(cue => cue.start > currentTime + 0.05) ?? null;
}

export function replayCue(cues, currentTime) {
  const active = selectActiveCue(cues, currentTime);
  if (active) return active;
  return [...cues].reverse().find(cue => cue.start <= currentTime) ?? null;
}