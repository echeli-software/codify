import {
  Component,
  ChangeDetectionStrategy,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';

let sheetSeq = 0;

/**
 * Mobile-first sheet: slides up from the bottom on phones and becomes a
 * side panel on desktop (≥ md), per docs/03. Modal semantics — focus is
 * trapped and restored, Esc / backdrop / close button dismiss it.
 *
 * While open, the backdrop + panel are moved to `document.body` (like
 * Ionic's own overlays): inside a page they would share `ion-content`'s
 * stacking context and containing block, so the page header covered the
 * top of the desktop side panel. Angular still removes the nodes on close.
 *
 *   <cdf-bottom-sheet [(open)]="filtersOpen" [title]="'student.filters' | translate">
 *     …filters…
 *     <div sheetFooter>…</div>
 *   </cdf-bottom-sheet>
 */
@Component({
  selector: 'cdf-bottom-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTrapFocus, Icon, TranslatePipe],
  template: `
    @if (open()) {
      <div class="cdf-sheet__portal" #portal>
        <div
          class="cdf-sheet__backdrop"
          aria-hidden="true"
          (click)="dismissable() && close()"
        ></div>
        <section
          class="cdf-sheet"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          (keydown.escape)="dismissable() && close()"
        >
          <div class="cdf-sheet__handle" aria-hidden="true"></div>
          <header class="cdf-sheet__head">
            <h2 class="cdf-sheet__title" [id]="titleId">{{ title() }}</h2>
            @if (dismissable()) {
              <button
                type="button"
                class="cdf-sheet__close"
                [attr.aria-label]="'common.close' | translate"
                (click)="close()"
              >
                <cdf-icon name="close" size="md" />
              </button>
            }
          </header>
          <div class="cdf-sheet__body">
            <ng-content />
          </div>
          <footer class="cdf-sheet__foot">
            <ng-content select="[sheetFooter]" />
          </footer>
        </section>
      </div>
    }
  `,
  styleUrl: './bottom-sheet.scss',
})
export class BottomSheet {
  readonly open = model(false);
  readonly title = input.required<string>();
  /** When false, only an explicit action inside the sheet can close it. */
  readonly dismissable = input(true);

  protected readonly titleId = `cdf-sheet-title-${++sheetSeq}`;

  private readonly portal = viewChild<ElementRef<HTMLDivElement>>('portal');

  constructor() {
    const body = inject(DOCUMENT).body;
    let moved: HTMLElement | null = null;
    const release = () => {
      moved?.remove();
      moved = null;
    };
    effect(() => {
      const el = this.portal()?.nativeElement ?? null;
      if (el === moved) return;
      // Angular removes the nodes when the @if closes, but not always when
      // the whole host goes away (e.g. the app is torn down) — clean up.
      release();
      if (el && body) {
        body.appendChild(el);
        moved = el;
      }
    });
    inject(DestroyRef).onDestroy(release);
  }

  close(): void {
    this.open.set(false);
  }
}
