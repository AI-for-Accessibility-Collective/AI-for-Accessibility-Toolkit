import { Injectable, inject } from '@angular/core';
import { TranscriptionLanguage } from '../models/transcription-language.model';
import { UploadCallbacks } from '../models/upload-callbacks.model';
import { Caption } from '../models/caption.model';
import { CaptionLoader } from './caption-loader.service';
import { MediaStore } from './media-store.service';

const TRANSCRIBE_PATH = '/api/transcribe';
const FALLBACK_ERROR = 'Captions could not be created. Try again.';
const NO_SPEECH_ERROR = 'No speech was found in this video, so there are no captions to show.';

@Injectable({ providedIn: 'root' })
export class MediaUpload {
  private readonly captions = inject(CaptionLoader);
  private readonly store = inject(MediaStore);

  async upload(video: File, language: TranscriptionLanguage, callbacks: UploadCallbacks): Promise<void> {
    const transcript = await this.transcribe(video, language, callbacks);
    this.publish(video, this.captions.parseText(transcript, 'transcript.json'));
  }

  private publish(video: File, captions: readonly Caption[]): void {
    if (captions.length === 0) {
      throw new Error(NO_SPEECH_ERROR);
    }
    this.store.set({
      title: video.name,
      videoUrl: URL.createObjectURL(video),
      captions,
    });
  }

  private transcribe(video: File, language: TranscriptionLanguage, callbacks: UploadCallbacks): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${TRANSCRIBE_PATH}?lang=${encodeURIComponent(language)}`);
      request.setRequestHeader('Content-Type', video.type || 'application/octet-stream');
      request.setRequestHeader('X-Filename', encodeURIComponent(video.name));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          callbacks.onUploadProgress(event.loaded / event.total);
        }
      };
      request.upload.onload = () => callbacks.onWriting();
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve(request.responseText);
        } else {
          reject(new Error(errorMessageFrom(request.responseText)));
        }
      };
      request.onerror = () => reject(new Error(FALLBACK_ERROR));
      request.send(video);
    });
  }
}

function errorMessageFrom(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string'
      ? parsed.error
      : FALLBACK_ERROR;
  } catch {
    return FALLBACK_ERROR;
  }
}
