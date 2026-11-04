import { InjectionToken } from '@angular/core';
import { Caption } from '../models/caption.model';

export interface CaptionSource {
  readonly extensions: readonly string[];
  parse(text: string): readonly Caption[];
}

export const CAPTION_SOURCES = new InjectionToken<readonly CaptionSource[]>('CAPTION_SOURCES');
