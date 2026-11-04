import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-pip',
  templateUrl: './pip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'pip',
    '[class.pip-lg]': 'large()',
  },
})
export class PipComponent {
  readonly large = input(false);
}
