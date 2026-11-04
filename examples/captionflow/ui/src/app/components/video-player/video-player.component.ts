import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { CaptionOverlayComponent } from '../caption-overlay/caption-overlay.component';
import { VIDEO_SURFACE } from '../../playback/video-surface';

const DEFAULT_RATIO = 16 / 9;
const MAX_FRAME_VIEWPORT_HEIGHT = 70;

@Component({
  selector: 'app-video-player',
  imports: [CaptionOverlayComponent],
  templateUrl: './video-player.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPlayerComponent {
  readonly source = input.required<string>();
  readonly caption = input('');
  private readonly surface = inject(VIDEO_SURFACE);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  protected readonly ratio = signal(DEFAULT_RATIO);
  protected readonly failed = signal(false);
  protected readonly frameWidth = computed(
    () => `min(100%, ${(MAX_FRAME_VIEWPORT_HEIGHT * this.ratio()).toFixed(2)}vh)`,
  );

  constructor() {
    afterNextRender(() => this.surface.attach(this.video().nativeElement));
  }

  protected onMetadata(): void {
    const { videoWidth, videoHeight } = this.video().nativeElement;
    if (videoWidth > 0 && videoHeight > 0) {
      this.ratio.set(videoWidth / videoHeight);
    }
  }

  protected onError(): void {
    this.failed.set(true);
  }

  protected onTimeUpdate(): void {
    this.surface.reportTime(this.video().nativeElement.currentTime);
  }
}
