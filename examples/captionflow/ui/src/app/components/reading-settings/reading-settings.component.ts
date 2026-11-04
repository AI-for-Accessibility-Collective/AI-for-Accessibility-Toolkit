import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReadingSettings } from '../../services/reading-settings.service';

@Component({
  selector: 'app-reading-settings',
  templateUrl: './reading-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadingSettingsComponent {
  protected readonly settings = inject(ReadingSettings);

  protected changeSpeed(event: Event): void {
    this.settings.setWordsPerMinute(Number((event.target as HTMLInputElement).value));
  }

  protected togglePacing(event: Event): void {
    this.settings.setPacingEnabled((event.target as HTMLInputElement).checked);
  }
}
