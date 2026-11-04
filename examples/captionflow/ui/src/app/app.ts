import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ColorModeToggleComponent } from './components/color-mode-toggle/color-mode-toggle.component';
import { PipComponent } from './components/pip/pip.component';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, PipComponent, ColorModeToggleComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
