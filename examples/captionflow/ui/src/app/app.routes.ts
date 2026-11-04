import { Routes } from '@angular/router';
import { mediaLoadedGuard } from './guards/media-loaded.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/upload/upload-page.component').then((m) => m.UploadPageComponent),
  },
  {
    path: 'player',
    canActivate: [mediaLoadedGuard],
    loadComponent: () => import('./pages/player/player-page.component').then((m) => m.PlayerPageComponent),
  },
  { path: '**', redirectTo: '' },
];
