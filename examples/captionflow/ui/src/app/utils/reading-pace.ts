import { Caption } from '../models/caption.model';

const MIN_RATE = 0.5;
const MAX_RATE = 1;
const MIN_READ_SECONDS = 1;

export function readingSeconds(text: string, wordsPerMinute: number): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(MIN_READ_SECONDS, (words / Math.max(1, wordsPerMinute)) * 60);
}

export function pacingRate(caption: Caption, wordsPerMinute: number): number {
  const speechSeconds = caption.endSeconds - caption.startSeconds;
  const rate = speechSeconds / readingSeconds(caption.text, wordsPerMinute);
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}
