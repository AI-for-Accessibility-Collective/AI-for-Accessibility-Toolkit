// Controller M5 test — the remote transport. The receiver is served over an
// in-memory channel; the Controller drives it through a remote proxy. The whole
// point: the SAME core produces the SAME behavior across a wire, with no change
// to the Controller — proving "the Controller is a service".
//
//   node toolkit/test/controller-remote.test.mjs

import { createDirectChannelPair, serveControl, remoteControl } from '../controller/transport/remote.js';
import { createController } from '../controller/createController.js';
import { createMockReceiver } from '../controller/mock-receiver.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

async function run() {
  // Receiver on one end of the channel; Controller on the other.
  const receiver = createMockReceiver({ actions: ['activate', 'scroll'] });
  const [clientCh, serverCh] = createDirectChannelPair();
  const detach = serveControl(serverCh, receiver);
  const remote = remoteControl({ channel: clientCh });
  const c = createController({ control: remote });

  // capabilities round-trip
  const caps = await remote.describeCapabilities();
  check('remote: describeCapabilities round-trips', caps.platform === 'mock' && caps.settingKeys.includes('fontScale'));

  // adapt over the wire (dispatch reads context THEN applies — two round-trips)
  const r1 = await c.handle('text size 150');
  check('remote: adapt applies on the far receiver', r1.ok && receiver.settings.fontScale === 150);

  const r2 = await c.handle('bigger text'); // delta resolves against remote context → 160
  check('remote: relative delta uses remote context', receiver.settings.fontScale === 160);

  // read content over the wire
  const rd = await c.handle('read this');
  check('remote: getContent round-trips', rd.ok && /demo document/i.test(rd.say));

  // command over the wire
  const rc = await c.handle('click documentation');
  check('remote: performAction round-trips', rc.ok && receiver.focus === 'activate:documentation');

  // undo over the wire
  const ru = await c.handle('undo');
  check('remote: undoLast round-trips (fontScale back to 150)', ru.ok && receiver.settings.fontScale === 150);

  // honesty survives the wire: unsupported key still refused
  const recv2 = createMockReceiver({ settingKeys: ['fontScale'] }); // no darkMode
  const [cc, sc] = createDirectChannelPair();
  serveControl(sc, recv2);
  const c2 = createController({ control: remoteControl({ channel: cc }) });
  const rh = await c2.handle('dark mode');
  check('remote: honesty preserved — unsupported key refused across the wire', rh.ok === false && !('darkMode' in recv2.settings));

  detach();
  check('remote: detach returns a function', typeof detach === 'function');

  console.log(`\nController M5 (remote transport): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
