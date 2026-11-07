import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { IonButton, IonSpinner } from '@ionic/angular/standalone';

export type AppButtonKind =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'link';
export type AppButtonSize = 'sm' | 'md' | 'lg';
export type AppButtonType = 'button' | 'submit' | 'reset';

const KIND_TO_FILL: Record<AppButtonKind, 'solid' | 'outline' | 'clear'> = {
  primary: 'solid',
  secondary: 'outline',
  ghost: 'clear',
  danger: 'solid',
  link: 'clear',
};

const KIND_TO_COLOR: Record<AppButtonKind, string> = {
  primary: 'primary',
  secondary: 'medium',
  ghost: 'medium',
  danger: 'danger',
  link: 'primary',
};

const SIZE_TO_ION: Record<AppButtonSize, 'small' | 'default' | 'large'> = {
  sm: 'small',
  md: 'default',
  lg: 'large',
};

/**
 * Branded button. Thin wrapper over `<ion-button>` with our kind/size taxonomy
 * so pages don't reach for ion attributes directly. Also handles `loading`
 * (auto-disables and shows a spinner) and emits a typed `click` output.
 */
@Component({
  selector: 'cdf-app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonSpinner],
  template: `
    <ion-button
      [type]="type()"
      [color]="color()"
      [fill]="fill()"
      [size]="ionSize()"
      [expand]="fullWidth() ? 'block' : null"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() || null"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="ariaExpanded()"
      [attr.aria-controls]="ariaControls()"
      [strong]="kind() === 'primary'"
      (click)="onClick($event)"
    >
      @if (loading()) {
        <ion-spinner slot="start" name="dots" aria-hidden="true" />
      }
      <ng-content />
    </ion-button>
  `,
  styleUrl: './app-button.scss',
})
export class AppButton {
  readonly kind = input<AppButtonKind>('primary');
  readonly size = input<AppButtonSize>('md');
  readonly type = input<AppButtonType>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly fullWidth = input(false);
  /** Accessible name — required for icon-only buttons. */
  readonly ariaLabel = input<string | null>(null);
  /** Disclosure state for buttons that open a sheet / menu. */
  readonly ariaExpanded = input<boolean | null>(null);
  readonly ariaControls = input<string | null>(null);

  readonly buttonClick = output<MouseEvent>();

  protected readonly fill = computed(() => KIND_TO_FILL[this.kind()]);
  protected readonly color = computed(() => KIND_TO_COLOR[this.kind()]);
  protected readonly ionSize = computed(() => SIZE_TO_ION[this.size()]);

  protected onClick(ev: MouseEvent): void {
    if (this.disabled() || this.loading()) return;
    this.buttonClick.emit(ev);
  }
}
