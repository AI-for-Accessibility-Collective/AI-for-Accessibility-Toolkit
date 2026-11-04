import { InjectionToken } from '@angular/core';

export interface VideoSurface {
  attach(video: HTMLVideoElement): void;
  reportTime(seconds: number): void;
}

export const VIDEO_SURFACE = new InjectionToken<VideoSurface>('VIDEO_SURFACE');
