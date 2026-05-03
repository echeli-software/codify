import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { NgbActiveModal, NgbModal, type NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { Button, type ButtonKind } from '../../atoms/button/button.js';
import { Icon, type IconName } from '../../atoms/icon/icon.js';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmKind?: ButtonKind;
  /** Optional icon shown beside the title. */
  icon?: IconName;
  /**
   * If set, the user must type this exact string into a confirmation input
   * before the confirm button enables. Used for destructive ops like
   * "Delete user — type the email to confirm".
   */
  typeToConfirm?: string;
}

/**
 * Internal modal component. Use `ConfirmDialogService.open()` instead of
 * mounting this directly.
 */
@Component({
  selector: 'cdf-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon],
  template: `
    <div class="cdf-confirm">
      <header class="cdf-confirm__head">
        @if (opts().icon; as i) {
        <cdf-icon [name]="i" size="lg" />
        }
        <h2 class="cdf-confirm__title">{{ opts().title }}</h2>
      </header>

      <p class="cdf-confirm__message">{{ opts().message }}</p>

      @if (opts().typeToConfirm; as expected) {
      <p class="cdf-confirm__hint">
        Type <code>{{ expected }}</code> to confirm.
      </p>
      <input
        type="text"
        class="cdf-confirm__input"
        (input)="typed.set($any($event.target).value)"
      />
      }

      <footer class="cdf-confirm__footer">
        <cdf-button kind="ghost" (click)="modal.dismiss(false)">
          {{ opts().cancelLabel ?? 'Cancel' }}
        </cdf-button>
        <cdf-button
          [kind]="opts().confirmKind ?? 'primary'"
          [disabled]="!canConfirm()"
          (click)="modal.close(true)"
        >
          {{ opts().confirmLabel ?? 'Confirm' }}
        </cdf-button>
      </footer>
    </div>
  `,
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  protected readonly modal = inject(NgbActiveModal);
  protected readonly opts = signal<ConfirmDialogOptions>({ title: '', message: '' });
  protected readonly typed = signal('');

  protected readonly canConfirm = computed(() => {
    const expected = this.opts().typeToConfirm;
    if (!expected) return true;
    return this.typed().trim() === expected;
  });

  /** Called by the service after instantiating. */
  setOptions(opts: ConfirmDialogOptions): void {
    this.opts.set(opts);
  }
}

/**
 * Imperative API for opening confirmation prompts. Returns a Promise that
 * resolves to `true` (confirmed), `false` (cancelled), or `null` (closed
 * via Esc / backdrop).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly modal = inject(NgbModal);

  async open(opts: ConfirmDialogOptions, modalOpts?: NgbModalOptions): Promise<boolean | null> {
    const ref = this.modal.open(ConfirmDialog, {
      centered: true,
      animation: true,
      ...modalOpts,
    });
    (ref.componentInstance as ConfirmDialog).setOptions(opts);
    try {
      return (await ref.result) ?? null;
    } catch {
      // Dismissed via Esc / backdrop / programmatic dismiss
      return null;
    }
  }
}
