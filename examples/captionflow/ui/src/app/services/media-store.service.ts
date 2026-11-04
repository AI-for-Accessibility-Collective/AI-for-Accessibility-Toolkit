import { Injectable, computed, signal } from '@angular/core';
import { LoadedMedia } from '../models/loaded-media.model';

@Injectable({ providedIn: 'root' })
export class MediaStore {
  private readonly media = signal<LoadedMedia | null>(null);
  readonly current = this.media.asReadonly();
  readonly isReady = computed(() => this.media() !== null);

  set(media: LoadedMedia): void {
    const previous = this.media();
    if (previous) {
      URL.revokeObjectURL(previous.videoUrl);
    }
    this.media.set(media);
  }
}
