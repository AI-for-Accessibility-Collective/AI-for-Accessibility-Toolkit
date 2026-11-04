import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'clock' })
export class ClockPipe implements PipeTransform {
  transform(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secondsPart = String(total % 60).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsPart}`
      : `${minutes}:${secondsPart}`;
  }
}
