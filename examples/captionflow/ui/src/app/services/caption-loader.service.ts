import { Injectable, inject } from '@angular/core';
import { Caption } from '../models/caption.model';
import { CAPTION_SOURCES, CaptionSource } from '../sources/caption-source';

@Injectable({ providedIn: 'root' })
export class CaptionLoader {
  private readonly sources = inject(CAPTION_SOURCES);

  parseText(text: string, fileName: string): readonly Caption[] {
    return this.sourceFor(fileName).parse(text);
  }

  private sourceFor(fileName: string): CaptionSource {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const source = this.sources.find((candidate) => candidate.extensions.includes(extension));
    if (!source) {
      throw new Error('Captions must be a transcript .json file.');
    }
    return source;
  }
}
