import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, viewChild, viewChildren } from '@angular/core';
import { Caption } from '../../models/caption.model';
import { ClockPipe } from '../../utils/clock.pipe';

@Component({
  selector: 'app-captions-panel',
  imports: [ClockPipe],
  templateUrl: './captions-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaptionsPanelComponent {
  readonly captions = input.required<readonly Caption[]>();
  readonly activeIndex = input(-1);
  readonly captionSelected = output<Caption>();
  protected readonly followEnabled = signal(true);
  private readonly list = viewChild.required<ElementRef<HTMLDivElement>>('list');
  private readonly items = viewChildren<ElementRef<HTMLButtonElement>>('item');

  constructor() {
    effect(() => {
      const index = this.activeIndex();
      const item = this.items()[index]?.nativeElement;
      if (!this.followEnabled() || !item) {
        return;
      }
      this.centre(item);
    });
  }

  protected toggleFollow(): void {
    this.followEnabled.update((enabled) => !enabled);
  }

  private centre(item: HTMLElement): void {
    const container = this.list().nativeElement;
    const top = item.offsetTop - container.clientHeight / 2 + item.clientHeight / 2;
    container.scrollTo({ top, behavior: 'smooth' });
  }
}
