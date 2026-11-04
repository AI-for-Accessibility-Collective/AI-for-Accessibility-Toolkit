import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MediaStore } from '../services/media-store.service';

export const mediaLoadedGuard: CanActivateFn = () =>
  inject(MediaStore).isReady() || inject(Router).createUrlTree(['/']);
