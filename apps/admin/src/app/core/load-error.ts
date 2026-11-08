import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { LoadError as SharedLoadError } from '../shared/load-error';
import { AdminErrors } from './errors';

/**
 * Typed error state with retry for a list or async area (docs/04 §9),
 * taking the thrown value directly: the message is resolved by
 * {@link AdminErrors} from the problem `code` / status (a 403 names the
 * missing permission) and rendered by the shared `cdf-load-error`.
 */
@Component({
  selector: 'cdf-admin-load-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedLoadError],
  template: `
    <cdf-load-error
      [message]="message()"
      (retry)="retry.emit()"
      data-testid="load-error"
    />
  `,
})
export class LoadError {
  private readonly errors = inject(AdminErrors);

  /** The thrown value from the failed load. */
  readonly error = input.required<unknown>();
  /** Translation key naming what failed (default "load failed"). */
  readonly fallbackKey = input('admin.errors.loadFailed');
  readonly retry = output<void>();

  protected readonly message = computed(() =>
    this.errors.message(this.error(), this.fallbackKey()),
  );
}
