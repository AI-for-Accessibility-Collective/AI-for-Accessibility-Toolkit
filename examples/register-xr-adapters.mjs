// Register the XR app's adapters with a toolkit instance's marketplace —
// the same API the browser extension uses (server/CONTRACT.md "Adapter
// marketplace"), from the other direction: a host publishing what it offers.
//
// The adapters listed here are the ones in the sibling XR repository
// (github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR,
// src/toolkit-candidates/): they apply the toolkit's XR surface settings to
// spoken guidance — prompt wording, delivery pacing, and voice. They are
// data-only listings: the code lives in that repo, and the marketplace entry
// is the manifest another developer can discover and read.
//
// Usage:
//   node examples/register-xr-adapters.mjs --url http://localhost:8080 --token aat_…
//   AA_SERVER_URL=… AA_TOKEN=… node examples/register-xr-adapters.mjs
//
// Re-running is safe: the sync upserts this app's entries and, with full:
// true, retires any that this list no longer contains.

const ADAPTERS = [
  {
    id: 'one-step', name: 'One Step at a Time', version: '1.0.0',
    description: 'Speaks one action, then waits for the person before the next. Prompt wording; the pacing half runs in the app’s delivery layer.',
    settingsKeys: ['pacing:stepwise'], supportAreas: ['cognitive'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/one-step.ts',
  },
  {
    id: 'action-first', name: 'Action First', version: '1.0.0',
    description: 'Verb first, one new thing per sentence, a question instead of an “if”, numbered steps.',
    settingsKeys: ['clarity'], supportAreas: ['cognitive', 'reading'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/action-first.ts',
  },
  {
    id: 'plain-words', name: 'Plain Words', version: '1.0.0',
    description: 'Everyday words, one name per object, in the generated guidance.',
    settingsKeys: ['simplify'], supportAreas: ['cognitive', 'reading'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/plain-words.ts',
  },
  {
    id: 'gist-first', name: 'Gist First', version: '1.0.0',
    description: 'One-sentence gist before detail; details on request.',
    settingsKeys: ['spokenDetail:gist'], supportAreas: ['cognitive'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/gist-first.ts',
  },
  {
    id: 'captions', name: 'Captions', version: '1.0.0',
    description: 'Shows spoken guidance as captions on the glasses display.',
    settingsKeys: ['captions'], supportAreas: ['hearing'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/captions.ts',
  },
  {
    id: 'adapted-voice', name: 'Adapted Voice', version: '1.0.0',
    description: 'Speaking rate, pitch, and volume from the profile; maps to the TTS vendor’s options.',
    settingsKeys: ['readAloudRate', 'voicePitch'], supportAreas: ['hearing'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/voice.ts',
  },
  {
    id: 'paced-delivery', name: 'Paced Delivery', version: '1.0.0',
    description: 'Packs speech into short chunks with pauses between them, and stops on cancel.',
    settingsKeys: ['chunkMaxWords', 'pauseBetweenChunks'], supportAreas: ['cognitive', 'motor'],
    sourceUrl: 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR/blob/main/src/toolkit-candidates/adapters/paced-delivery.ts',
  },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : process.env[`AA_${name.toUpperCase().replace(/-/g, '_')}`];
}

const url = (arg('url') || 'http://localhost:8080').replace(/\/+$/, '');
const token = arg('token');
if (!token) {
  console.error('Usage: node examples/register-xr-adapters.mjs --url <instance> --token <aat_…>');
  process.exit(1);
}

const response = await fetch(`${url}/v1/adapters/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ appId: 'xr', appName: 'XR Task Guide', full: true, adapters: ADAPTERS }),
});
const result = await response.json();
if (!response.ok) {
  console.error(`Sync failed (${response.status}):`, result.error || result);
  process.exit(1);
}
console.log(`Published ${result.created} new, ${result.updated} updated XR adapters to ${url}`);
if (result.removed.length) console.log(`Retired: ${result.removed.join(', ')}`);
if (result.skipped.length) console.warn(`Skipped: ${JSON.stringify(result.skipped)}`);
