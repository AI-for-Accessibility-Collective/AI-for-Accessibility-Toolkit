// Buttons + toggles. Owns no state of its own -- relies on the store
// subscription to drive button visibility, and posts intent through the
// callbacks the entry point passes in.

export function mountControls({
  startBtn, micBtn, endBtn, restartBtn, bgWrapper, bgToggle, textForm,
  onStart, onEnd, onRestart, onMicToggle, onBackgroundChange,
}) {
  startBtn.addEventListener('click', () => onStart());
  endBtn.addEventListener('click', () => onEnd());
  restartBtn.addEventListener('click', () => onRestart());
  micBtn.addEventListener('click', () => onMicToggle());
  bgToggle.addEventListener('change', (e) => onBackgroundChange(!!e.target.checked));

  function render(snap) {
    const live = snap.connection === 'live' || snap.connection === 'connecting';
    // Typed input follows the same visibility as the mic: it goes through
    // the live session as a user turn, so it needs a connection.
    if (textForm) {
      textForm.hidden = snap.connection !== 'live';
    }
    // Restart is also useful next to Resume: a cached resumption handle
    // means the user can either continue the prior conversation or wipe
    // it for a fresh one. Show the button in both states.
    const showRestart = live || (!live && !!snap.hasResumeHandle);
    startBtn.hidden = live;
    micBtn.hidden = !live;
    endBtn.hidden = !live;
    restartBtn.hidden = !showRestart;
    bgWrapper.hidden = !live;

    // While the session is mid-reconnect, suppress double-clicks on
    // restart/mic so the user can't queue up commands the offscreen
    // can't yet honor.
    const connecting = snap.connection === 'connecting';
    restartBtn.disabled = connecting;
    micBtn.disabled = connecting;

    if (live) {
      micBtn.classList.toggle('muted', !snap.recording);
      micBtn.title = snap.recording ? 'Mute mic' : 'Unmute mic';
      bgToggle.checked = !!snap.backgroundMode;
    }
    if (connecting) {
      startBtn.textContent = snap.hasResumeHandle ? 'Resuming…' : 'Connecting…';
      startBtn.disabled = true;
    } else {
      // "Resume" if a session-resumption handle is cached from a prior
      // offscreen-page instance; the server may still hold context for
      // it. Otherwise plain "Start" for a fresh conversation.
      startBtn.textContent = snap.hasResumeHandle ? 'Resume' : 'Start';
      startBtn.disabled = false;
    }
  }
  return { render };
}
