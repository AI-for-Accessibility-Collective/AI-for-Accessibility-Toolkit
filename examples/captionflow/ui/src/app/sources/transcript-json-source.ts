import { Caption } from '../models/caption.model';
import { CaptionSource } from './caption-source';

interface TranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface TranscriptFile {
  readonly segments: readonly TranscriptSegment[];
}

export class TranscriptJsonSource implements CaptionSource {
  readonly extensions = ['json'];

  parse(text: string): readonly Caption[] {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('This file is not valid JSON.');
    }
    if (!isTranscriptFile(data)) {
      throw new Error('This JSON file is not a CaptionFlow transcript.');
    }
    return data.segments.map((segment) => ({
      startSeconds: segment.start,
      endSeconds: segment.end,
      text: segment.text,
    }));
  }
}

function isTranscriptFile(value: unknown): value is TranscriptFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'segments' in value &&
    Array.isArray(value.segments) &&
    value.segments.every(isTranscriptSegment)
  );
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    'end' in value &&
    'text' in value &&
    typeof value.start === 'number' &&
    typeof value.end === 'number' &&
    typeof value.text === 'string'
  );
}
