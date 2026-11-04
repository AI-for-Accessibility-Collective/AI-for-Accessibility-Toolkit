import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { CAPTION_SOURCES } from './sources/caption-source';
import { TranscriptJsonSource } from './sources/transcript-json-source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: CAPTION_SOURCES, useClass: TranscriptJsonSource, multi: true },
  ],
};
