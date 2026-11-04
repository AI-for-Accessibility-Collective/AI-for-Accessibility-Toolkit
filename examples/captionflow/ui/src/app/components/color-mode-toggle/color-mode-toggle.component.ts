import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ColorModeChoice } from '../../models/color-mode.model';
import { ColorMode } from '../../services/color-mode.service';

interface ColorModeOption {
  readonly value: ColorModeChoice;
  readonly label: string;
}

@Component({
  selector: 'app-color-mode-toggle',
  templateUrl: './color-mode-toggle.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorModeToggleComponent {
  protected readonly colorMode = inject(ColorMode);
  protected readonly options: readonly ColorModeOption[] = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
}
