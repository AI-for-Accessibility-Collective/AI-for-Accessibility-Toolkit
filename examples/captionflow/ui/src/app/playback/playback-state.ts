import { InjectionToken, Signal } from '@angular/core';

export interface PlaybackState {
  readonly currentSeconds: Signal<number>;
  readonly rate: Signal<number>;
}

export const PLAYBACK_STATE = new InjectionToken<PlaybackState>('PLAYBACK_STATE');
