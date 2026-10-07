import {
  Component,
  ChangeDetectionStrategy,
  input,
  model,
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

  close(): void {
    this.open.set(false);
  }
}
