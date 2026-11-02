// One event stream per account, to every sidebar that account has open.
// Server-sent events: `event: <type>` and one JSON `data:` line.

const HEARTBEAT_MS = 25_000;

export function createEvents() {
  const streams = new Map(); // uid -> Set<res>

  function subscribe(uid, res, initial = []) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    for (const event of initial) write(res, event);
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(beat);
      streams.get(uid)?.delete(res);
      if (!streams.get(uid)?.size) streams.delete(uid);
    });
  }

  function write(res, event) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  function publish(uid, event) {
    for (const res of streams.get(uid) || []) write(res, event);
  }

  const listening = (uid) => (streams.get(uid)?.size || 0) > 0;
  return { subscribe, publish, listening };
}
