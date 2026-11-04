import { Caption } from '../models/caption.model';
import { parseCues } from '../utils/cue-parser';
import { CaptionSource } from './caption-source';

export class CueFileSource implements CaptionSource {
  readonly extensions = ['vtt', 'srt'];

  parse(text: string): readonly Caption[] {
    const captions = parseCues(text);
    if (captions.length === 0) {
      throw new Error('No captions were found in this file. Check that it is a WebVTT or SRT file with timings.');
    }
    return captions;
  }
}
