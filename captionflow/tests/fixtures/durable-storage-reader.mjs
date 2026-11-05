// Reader half of the cross-process durable-storage test. See
// durable-storage-writer.mjs: this is a separate OS process reading back
// whatever that process persisted to disk.
import { createToolkit } from '../../../toolkit/index.js';
import { fileKV } from '../../../toolkit/platforms/node/kv.js';
import { createToolkitPreferenceProvider } from '../../src/toolkit-preferences.mjs';

const [, , dir, userId] = process.argv;
const { librarian } = createToolkit({ kv: fileKV(dir) });
await librarian.setActingUser(userId);
const prefs = await createToolkitPreferenceProvider({ librarian, actingUserId: userId }).getPreferences({});
process.stdout.write(JSON.stringify(prefs));
