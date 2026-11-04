# CaptionFlow UI rules

These rules apply to the CaptionFlow user interface: the Angular app that
uploads a video, shows its progress, and plays it with synced captions and a
transcript. They do not apply to the toolkit core in `toolkit/`, `tools/` or
`server/`.

## Versions

- Angular: the newest 22.x release at least two weeks old. Today that is 22.2.3. Pin the exact version in `package.json`.
- Bootstrap: 5.3.8 (`npm install bootstrap@5.3.8`). Do not use the 6.x alpha on the `next` tag.
- TypeScript: the version Angular 22 requires. Compile with `strict: true`.

## Visual design

1. No cards. Do not use Bootstrap's `.card` class or any component that draws a card.
2. No heavy shadows. Do not use the `shadow`, `shadow-sm` or `shadow-lg` utilities, or any `box-shadow` above a 1px border or a focus ring.
3. No gradients. Do not use gradient backgrounds, gradient text or gradient borders, and do not write `linear-gradient` or `radial-gradient` anywhere.
4. No custom CSS. Use Bootstrap classes and utilities for all layout, spacing, colour, typography and sizing. Do not write rules in `.css` files, do not use `style` attributes, and do not hard-code values in templates or TypeScript.
5. Before writing any CSS that Bootstrap cannot provide, stop and ask the user for permission. State the exact selector, the property it sets and why Bootstrap cannot do it. Write it only after the user approves.
6. Use Bootstrap's CSS only. Do not use Bootstrap's JavaScript plugins (modal, offcanvas, dropdown). Angular owns all behaviour.
7. Dark theme by default, set with `data-bs-theme="dark"`, using Bootstrap's colour mode.
8. Keep one accent colour, using a Bootstrap theme colour class. It is used for focus, the progress bar and the active transcript line.

## Captions

These rules come from the DCMP Captioning Key ([print version](https://dcmp.org/captioningkey/print)). Apply them in the caption component only.

- Text is white and medium-weight sans serif, using Bootstrap classes.
- The DCMP key also asks for a drop or rim shadow on the text. Bootstrap has no utility for it, so ask the user for permission before adding that CSS (rule 5).
- Captions sit on a translucent box behind the text. Build the box with Bootstrap utilities if they support it; otherwise ask for permission (rule 5).
- Captions go on the bottom two lines and never exceed two lines.
- Every caption is on screen for at least 1 s 10 frames and at most 6 s.
- Presentation rate defaults to 160 words per minute, the DCMP upper level.

## Code comments

- No comments of any kind in TypeScript, HTML or CSS: no `//`, `/* */`, `<!-- -->`, and no `TODO` or `FIXME`.
- Name things so the code explains itself.

## Component files

- Every component has a `name.component.ts` and a `name.component.html` with the same base name. A `name.component.css` is added only after the user approves custom CSS (rule 5).
- The `.ts` file contains no HTML: no inline `template:` and no `styles:`. Use `templateUrl`, and `styleUrl` only for an approved CSS file.
- The `.html` file contains only template markup and bindings.
- `src/styles.css` contains only the Bootstrap import. Nothing else.
- One component, directive, service or model per file.

## Angular conventions

Source: the [Angular style guide](https://angular.dev/style-guide), except where marked as a rule set here.

- File names are lowercase with hyphens, and match the main identifier. Tests use `.spec.ts`.
- Components are standalone. Do not use `NgModule` for components. (Rule set here.)
- Each component uses `changeDetection: ChangeDetectionStrategy.OnPush`. (Rule set here.)
- Use signals for state: `signal`, `computed`, `input()`, `output()`, `model()`. (Rule set here.)
- Mark properties Angular initialises as `readonly`, including inputs, outputs, `model` and queries. Members used only by the template are `protected`.
- Inject dependencies with `inject()`, not constructor parameters.
- Use `class` and `style` bindings, not `ngClass` or `ngStyle`. Use Bootstrap class names in those bindings.
- Use the built-in control flow `@if`, `@for` and `@switch`. Do not use `*ngIf`, `*ngFor` or `*ngSwitch`. (Rule set here.)
- Keep template expressions simple. Move any logic that is more than a simple comparison or lookup into a `computed` signal or a method. Template methods are not allowed.
- Route to each feature with lazy loading (`loadComponent`). (Rule set here.)

## SOLID

- **Single responsibility.** Split by concern: upload, processing progress, playback, caption selection, transcript list, and caption style each have their own component and service. A component shows state and forwards user actions. Business logic lives in services.
- **Open/closed.** Caption sources, such as an uploaded `.vtt` file or the pipeline's `.transcript.json`, implement one `CaptionSource` interface. Add a new source without changing the player.
- **Liskov substitution.** Any `CaptionSource` or `VideoPlayer` implementation can replace another without the player knowing which one it has.
- **Interface segregation.** Keep interfaces small and focused, such as `PlaybackControl` (play, pause, seek) separate from `PlaybackState` (current time, duration, rate).
- **Dependency inversion.** Components and services depend on interfaces, provided with `InjectionToken`s. The `<video>` element is wrapped in a `VideoPlayer` adapter, and the components depend only on that adapter.

## TypeScript

- `strict: true`. No `any`. Use `unknown` and narrow it.
- Models are `readonly` interfaces in `models/`.
- Timestamps are numbers in seconds, named with a unit suffix when a name would be ambiguous, such as `startSeconds`.

## Accessibility

- Every interactive element is a native button, link or input with a visible focus state.
- Keyboard works for every control: play, pause, seek, and moving between transcript lines.
- The active transcript line carries `aria-current="true"`.
- Motion respects `prefers-reduced-motion`. If that needs custom CSS, ask for permission (rule 5).
- Icon-only buttons have an `aria-label`.
