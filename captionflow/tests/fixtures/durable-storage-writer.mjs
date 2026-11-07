// Writer half of the cross-process durable-storage test. Runs as a genuinely
// separate OS process from the reader, each with its own in-process memory --
// the only thing shared is the directory on disk.
import { createToolkit } from '../../../toolkit/index.js';
import { fileKV } from '../../../toolkit/platforms/node/kv.js';
import { createToolkitPreferenceProvider } from '../../src/toolkit-preferences.mjs';

const [, , dir, userId, rawValue] = process.argv;
const { librarian } = createToolkit({ kv: fileKV(dir) });
await librarian.setActingUser(userId);
await createToolkitPreferenceProvider({ librarian, actingUserId: userId })
  .setTextSize({ value: Number(rawValue), unit: 'ratio' });
