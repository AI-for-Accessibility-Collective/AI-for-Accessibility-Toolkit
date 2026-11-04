import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ReadingSettings {
  readonly wordsPerMinute = signal(160);
  readonly pacingEnabled = signal(true);

  setWordsPerMinute(value: number): void {
    this.wordsPerMinute.set(value);
  }

  setPacingEnabled(enabled: boolean): void {
    this.pacingEnabled.set(enabled);
  }
}
