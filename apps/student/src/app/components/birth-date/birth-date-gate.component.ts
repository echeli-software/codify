import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '@codify/auth';
import { TranslatePipe } from '@codify/i18n';
import { BirthDateFormComponent } from './birth-date-form.component.js';
import { AgeGateService, showBirthDateGate } from './birth-date.js';

/**
 * One-time blocking prompt for signed-in users with no date of birth
 * (docs/05 Onboarding, docs/14 "Minors"): a modal `<dialog>` over the
 * shell — focus stays inside, Escape does not close it — until the date
 * is saved. New accounts get the same form as the first onboarding step on
 * Today instead (see `showBirthDateGate`).
 */
@Component({
  selector: 'cdf-birth-date-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BirthDateFormComponent, TranslatePipe],
  template: `
    <dialog
      #dialog
      class="gate"
      aria-labelledby="gate-title"
      data-testid="birth-date-gate"
      (cancel)="$event.preventDefault()"
    >
      @if (show()) {
        <div class="gate__panel">
          <span class="gate__sr" id="gate-title">{{
            'student.age.gateLabel' | translate
          }}</span>
          <cdf-birth-date-form idPrefix="gate" />
        </div>
      }
    </dialog>
  `,
  styles: [
    `
      .gate {
        border: 0;
        padding: 16px;
        margin: 0;
        width: 100%;
        max-width: none;
        height: 100%;
        max-height: none;
        background: var(--cdf-color-bg);
        color: var(--cdf-color-text);
        box-sizing: border-box;
      }
      .gate[open] {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* The dialog itself takes focus on open; its fields show focus. */
      .gate:focus {
        outline: none;
      }
      .gate::backdrop {
        background: var(--cdf-color-bg);
      }
      .gate__panel {
        width: min(520px, 100%);
      }
      .gate__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
})
export class BirthDateGateComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly gate = inject(AgeGateService);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly show = computed(() =>
    showBirthDateGate({
      birthDate: this.gate.birthDate(),
      onboarded: this.gate.onboarded(),
      onToday: /^\/today(?:[/?#]|$)/.test(this.url() ?? ''),
      todayOnboarding: this.gate.todayOnboarding(),
    }),
  );

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id;
      if (id) untracked(() => void this.gate.load(id));
    });
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.show()) {
        if (!el.open) el.showModal?.();
      } else if (el.open) {
        el.close();
      }
    });
  }
}
