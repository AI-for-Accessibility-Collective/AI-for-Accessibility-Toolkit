// Asks for the microphone once for the extension (the side panel cannot show
// Chrome's prompt), so the Profile tab's Speak button can listen.
const state = document.getElementById('mic-state');
const again = document.getElementById('mic-again');
async function askForMicrophone() {
  again.hidden = true;
  state.textContent = 'Asking…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    state.textContent = 'The microphone is allowed. Close this tab and press Speak in the side panel again.';
  } catch (e) {
    state.textContent = `The microphone is not allowed (${e.name}). Allow it in Chrome’s site settings for this extension, or type instead.`;
    again.hidden = false;
  }
}
again.addEventListener('click', askForMicrophone);
askForMicrophone();
