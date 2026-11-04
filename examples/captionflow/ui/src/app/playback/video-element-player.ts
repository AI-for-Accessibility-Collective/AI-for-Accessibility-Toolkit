import { Injectable, signal } from '@angular/core';
import { PlaybackControl } from './playback-control';
import { PlaybackState } from './playback-state';
import { VideoSurface } from './video-surface';

@Injectable()
export class VideoElementPlayer implements PlaybackControl, PlaybackState, VideoSurface {
  private video: HTMLVideoElement | null = null;
  private readonly time = signal(0);
  private readonly playbackRate = signal(1);
  readonly currentSeconds = this.time.asReadonly();
  readonly rate = this.playbackRate.asReadonly();

  attach(video: HTMLVideoElement): void {
    this.video = video;
    video.playbackRate = this.playbackRate();
  }

  reportTime(seconds: number): void {
    this.time.set(seconds);
  }

  play(): void {
    void this.video?.play();
  }

  pause(): void {
    this.video?.pause();
  }

  seek(seconds: number): void {
    if (this.video) {
      this.video.currentTime = seconds;
    }
    this.time.set(seconds);
  }

  setRate(rate: number): void {
    if (this.video) {
      this.video.playbackRate = rate;
    }
    this.playbackRate.set(rate);
  }
}
