import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { ColorModeChoice } from '../models/color-mode.model';

@Injectable({ providedIn: 'root' })
export class ColorMode {
  private readonly document = inject(DOCUMENT);
  readonly choice = signal<ColorModeChoice>('dark');

  constructor() {
    effect(() => {
      this.apply(this.choice());
    });
  }

  choose(choice: ColorModeChoice): void {
    this.choice.set(choice);
  }

  private apply(choice: ColorModeChoice): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
    this.document.documentElement.setAttribute('data-bs-theme', resolved);
  }
}
