import { Caption } from './caption.model';

export interface LoadedMedia {
  readonly title: string;
  readonly videoUrl: string;
  readonly captions: readonly Caption[];
}
