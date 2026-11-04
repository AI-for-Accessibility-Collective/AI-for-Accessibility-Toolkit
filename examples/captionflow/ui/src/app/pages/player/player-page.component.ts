import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CaptionsPanelComponent } from '../../components/captions-panel/captions-panel.component';
import { ReadingSettingsComponent } from '../../components/reading-settings/reading-settings.component';
import { VideoPlayerComponent } from '../../components/video-player/video-player.component';
import { Caption } from '../../models/caption.model';
import { PLAYBACK_CONTROL } from '../../playback/playback-control';
import { PLAYBACK_STATE } from '../../playback/playback-state';
import { VideoElementPlayer } from '../../playback/video-element-player';
import { VIDEO_SURFACE } from '../../playback/video-surface';
import { MediaStore } from '../../services/media-store.service';
import { ReadingSettings } from '../../services/reading-settings.service';
import { captionIndexAt } from '../../utils/caption-index';
import { pacingRate } from '../../utils/reading-pace';

@Component({
  imports: [RouterLink, CaptionsPanelComponent, ReadingSettingsComponent, VideoPlayerComponent],
  templateUrl: './player-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    VideoElementPlayer,
    { provide: PLAYBACK_CONTROL, useExisting: VideoElementPlayer },
    { provide: PLAYBACK_STATE, useExisting: VideoElementPlayer },
    { provide: VIDEO_SURFACE, useExisting: VideoElementPlayer },
  ],
})
export class PlayerPageComponent {
  protected readonly media = inject(MediaStore).current;
  private readonly control = inject(PLAYBACK_CONTROL);
  private readonly state = inject(PLAYBACK_STATE);
  private readonly settings = inject(ReadingSettings);
  protected readonly activeIndex = computed(() =>
    captionIndexAt(this.media()?.captions ?? [], this.state.currentSeconds()),
  );
  protected readonly activeCaption = computed<Caption | null>(() => {
    const index = this.activeIndex();
    return index < 0 ? null : (this.media()?.captions[index] ?? null);
  });
  protected readonly captionText = computed(() => this.activeCaption()?.text ?? '');
  protected readonly paceLabel = computed(() => {
    const rate = this.state.rate();
    return rate < 1 ? `Slowed to ${Math.round(rate * 100)}%` : 'Normal speed';
  });

  constructor() {
    effect(() => {
      const caption = this.activeCaption();
      const rate = this.settings.pacingEnabled() && caption ? pacingRate(caption, this.settings.wordsPerMinute()) : 1;
      this.control.setRate(rate);
    });
  }

  protected playFrom(caption: Caption): void {
    this.control.seek(caption.startSeconds);
    this.control.play();
  }
}
