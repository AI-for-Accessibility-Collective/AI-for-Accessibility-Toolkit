import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PipComponent } from '../../components/pip/pip.component';
import { UploadStage } from '../../models/upload-stage.model';
import { MediaUpload } from '../../services/media-upload.service';

const NOT_A_VIDEO = 'Choose a video file: MP4, MOV, M4V, WebM or MKV.';
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv)$/i;

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSION.test(file.name);
}

@Component({
  imports: [PipComponent],
  templateUrl: './upload-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadPageComponent {
  private readonly upload = inject(MediaUpload);
  private readonly router = inject(Router);
  protected readonly videoFile = signal<File | null>(null);
  protected readonly stage = signal<UploadStage>('idle');
  protected readonly progress = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly busy = computed(() => this.stage() !== 'idle');
  protected readonly canSubmit = computed(() => this.videoFile() !== null && !this.busy());
  protected readonly progressPercent = computed(() => Math.round(this.progress() * 100));
  protected readonly fileSize = computed(() => {
    const file = this.videoFile();
    return file ? `${(file.size / 1_000_000).toFixed(1)} MB` : '';
  });

  protected pickVideo(event: Event): void {
    this.chooseFile((event.target as HTMLInputElement).files?.item(0) ?? null);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dragLeave(): void {
    this.dragging.set(false);
  }

  protected dropVideo(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.chooseFile(event.dataTransfer?.files.item(0) ?? null);
  }

  protected async submit(): Promise<void> {
    const video = this.videoFile();
    if (!video) {
      return;
    }
    this.stage.set('uploading');
    this.progress.set(0);
    this.error.set(null);
    try {
      await this.upload.upload(video, {
        onUploadProgress: (fraction) => this.progress.set(fraction),
        onWriting: () => this.stage.set('writing'),
      });
      await this.router.navigateByUrl('/player');
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Captions could not be created. Try again.');
    } finally {
      this.stage.set('idle');
    }
  }

  private chooseFile(file: File | null): void {
    const accepted = file !== null && isVideoFile(file);
    this.error.set(file && !accepted ? NOT_A_VIDEO : null);
    this.videoFile.set(accepted ? file : null);
  }
}
