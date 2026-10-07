import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  model,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { TranslatePipe } from '@codify/i18n';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

export type DrawerPosition = 'start' | 'end' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg';

let drawerSeq = 0;

/**
 * Side panel for detail / edit surfaces that keep the page context visible.
 * Modal semantics: `role="dialog"` + `aria-modal`, focus is trapped inside
 * (CDK FocusTrap) and moved to the first focusable element on open, Esc and
 * backdrop click close it, and focus returns to the trigger on close.
 *
 *   <cdf-button (click)="open.set(true)">Edit</cdf-button>
 *   <cdf-drawer [(open)]="open" [title]="'admin.course.edit' | translate">
 *     …form…
 *     <ng-container drawerFooter>…buttons…</ng-container>
 *   </cdf-drawer>
 */
@Component({
  selector: 'cdf-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTrapFocus, IconButton, TranslatePipe],
  template: `
    @if (open()) {
      <div
        class="cdf-drawer__backdrop"
        aria-hidden="true"
        (click)="onBackdrop()"
      ></div>
      <div
        [class]="cssClass()"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        (keydown.escape)="close()"
      >
        <header class="cdf-drawer__head">
          <h2 class="cdf-drawer__title" [id]="titleId">{{ title() }}</h2>
          <cdf-icon-button
            icon="x"
            kind="ghost"
            size="sm"
            [ariaLabel]="'common.close' | translate"
            (click)="close()"
          />
        </header>
        <div class="cdf-drawer__body">
          <ng-content />
        </div>
        <footer class="cdf-drawer__foot">
          <ng-content select="[drawerFooter]" />
        </footer>
      </div>
    }
  `,
  styleUrl: './drawer.scss',
})
export class Drawer {
  /** Two-way bindable open state. */
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly position = input<DrawerPosition>('end');
  readonly size = input<DrawerSize>('md');
  /** Close when the backdrop is clicked (default true). */
  readonly closeOnBackdrop = input(true);

  protected readonly titleId = `cdf-drawer-title-${++drawerSeq}`;

  protected readonly cssClass = computed(
    () =>
      `cdf-drawer cdf-drawer--${this.position()} cdf-drawer--${this.size()}`,
  );

  close(): void {
    this.open.set(false);
  }

  protected onBackdrop(): void {
    if (this.closeOnBackdrop()) this.close();
  }
}
