import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-caption-overlay',
  templateUrl: './caption-overlay.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pe-none' },
})
export class CaptionOverlayComponent {
  readonly text = input('');
}
