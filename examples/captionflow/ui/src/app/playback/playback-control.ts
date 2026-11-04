import { InjectionToken } from '@angular/core';

export interface PlaybackControl {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
}

export const PLAYBACK_CONTROL = new InjectionToken<PlaybackControl>('PLAYBACK_CONTROL');
