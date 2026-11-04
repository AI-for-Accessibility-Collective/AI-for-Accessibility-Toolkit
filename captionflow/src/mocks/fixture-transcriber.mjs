import { readFile } from 'node:fs/promises';

/** A deterministic local fixture, never an ASR call. */
export function createFixtureTranscriber({ fileUrl }) {
  return {
    async transcribe({ videoId, media }) {
      if (media.kind !== 'fixture') throw new Error('Fixture transcriber only supports media.kind="fixture"');
      const transcript = JSON.parse(await readFile(fileUrl, 'utf8'));
      if (transcript.videoId !== videoId) throw new Error(`Unknown fixture videoId: ${videoId}`);
      return transcript;
    },
  };
}
