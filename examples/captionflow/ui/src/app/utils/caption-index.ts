import { Caption } from '../models/caption.model';

export function captionIndexAt(captions: readonly Caption[], seconds: number): number {
  return captions.findIndex((caption) => seconds >= caption.startSeconds && seconds < caption.endSeconds);
}
