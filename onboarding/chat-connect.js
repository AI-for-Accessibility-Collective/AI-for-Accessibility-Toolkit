// chat-connect.js: when a remote receiver counts as connected, lifted out of
// chat.js so it can be tested without a browser.
//
// The profile has to reach whatever /chat is driving. For the local preview
// that is immediate. For a remote receiver the socket is still opening when
// useRemote() returns. websocketChannel would hold a request posted then and
// send it on open, but remoteControl starts the request's timeout the moment
// it is posted, so a slow connection could time the application out and a
// failed one would leave it pending until that timeout. The right moment is
// the socket's own open event. And a socket the person has since replaced
// (Connect clicked twice, or a fall-back to the preview) must never report
// anything, or a slow first connection could apply over the second. That
// guard is `live`, and it is what the profile application rides on.

/**
 * Follow a socket's lifecycle and report it as connection states.
 *
 *   onConnected: the socket is open, already or on its 'open' event.
 *   onFailed:    it never opened, an error or a close before any open. A
 *                socket that errors and then closes reports both, so onFailed
 *                can run twice for one connection: keep what it does
 *                idempotent, the way re-rendering a status line is.
 *   onLost:      it closed after having opened.
 *
 * `live()` answers whether this socket is still the one being driven. No
 * callback fires for a socket that is not, so a caller may apply the profile
 * from onConnected without checking again.
 *
 * @param {{readyState: number, addEventListener(type: string, fn: Function): void}} sock
 *   A WebSocket, or anything shaped like one.
 * @param {{live?: () => boolean, onConnected: () => void, onFailed: () => void, onLost: () => void}} on
 */
export function watchConnection(sock, { live = () => true, onConnected, onFailed, onLost }) {
  let opened = false;
  const connected = () => { opened = true; if (live()) onConnected(); };
  // Listen before reporting. For a socket that is already open, onConnected
  // runs inside this call; a caller that throws there would otherwise leave
  // the socket unwatched, and its later close would never be reported.
  sock.addEventListener('error', () => { if (live() && !opened) onFailed(); });
  sock.addEventListener('close', () => { if (live()) (opened ? onLost : onFailed)(); });
  if (sock.readyState === 1) connected();
  else sock.addEventListener('open', connected);
}
