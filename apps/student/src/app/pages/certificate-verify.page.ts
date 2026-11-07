import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CertificatesClient,
  ProblemDetailsError,
  type VerifyResult,
} from '@codify/api-client';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { usePageMeta } from './shared/seo.js';

/**
 * Public certificate verification (`/verify/:serial`) — the shareable,
 * verifiable URL on a learner's certificate. Unauthenticated; renders the
 * branded SVG and confirms authenticity from the serial (docs/18).
 */
@Component({
  selector: 'cdf-certificate-verify',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PublicLayoutComponent, TranslatePipe, LocalePipe],
  template: `
    <cdf-public-layout>
      <div class="vf">
        <h1>{{ 'student.verify.title' | translate }}</h1>
        <p>{{ 'student.verify.subtitle' | translate }}</p>
        <form class="vf__form" (submit)="go($event)">
          <label class="vf__label" for="vf-serial">{{
            'student.verify.serialLabel' | translate
          }}</label>
          <div class="vf__row">
            <input
              id="vf-serial"
              [(ngModel)]="serialInput"
              name="serial"
              autocomplete="off"
              spellcheck="false"
              [placeholder]="'student.verify.placeholder' | translate"
              data-testid="verify-input"
            />
            <button type="submit" class="vf__btn" data-testid="verify-go">
              {{ 'student.verify.submit' | translate }}
            </button>
          </div>
        </form>

        <div aria-live="polite">
          @if (loading()) {
            <p role="status">{{ 'student.verify.checking' | translate }}</p>
          } @else if (failed()) {
            <p class="vf__bad" role="alert">
              {{ 'student.verify.error' | translate }}
            </p>
          } @else if (result(); as r) {
            @if (r.valid) {
              <div class="vf__ok" data-testid="verify-valid">
                <p class="vf__badge">
                  {{ 'student.verify.valid' | translate }}
                </p>
                <img
                  [src]="imageUrl()"
                  [alt]="
                    'student.verify.imageAlt'
                      | translate
                        : { name: r.recipientName, course: r.courseTitle }
                  "
                  class="vf__img"
                  data-testid="verify-image"
                />
                <dl>
                  <dt>{{ 'student.verify.recipient' | translate }}</dt>
                  <dd data-testid="verify-recipient">{{ r.recipientName }}</dd>
                  <dt>{{ 'student.verify.course' | translate }}</dt>
                  <dd>{{ r.courseTitle }}</dd>
                  @if (r.isCapstone) {
                    <dt>{{ 'student.verify.type' | translate }}</dt>
                    <dd>{{ 'student.verify.capstone' | translate }}</dd>
                  }
                  <dt>{{ 'student.verify.issued' | translate }}</dt>
                  <dd>{{ r.issuedAt | locale: 'date' : 'long' }}</dd>
                  <dt>{{ 'student.verify.serial' | translate }}</dt>
                  <dd class="vf__mono">{{ r.serial }}</dd>
                </dl>
              </div>
            } @else {
              <p class="vf__bad" data-testid="verify-invalid">
                {{ 'student.verify.invalid' | translate }}
              </p>
            }
          }
        </div>
      </div>
    </cdf-public-layout>
  `,
  styles: [
    `
      :host h1 {
        color: #f8fafc;
      }
      :host p,
      :host dd {
        color: #e2e8f0;
      }
      .vf {
        max-width: 720px;
        margin: 32px auto;
        padding: 0 16px;
      }
      .vf__label {
        display: block;
        font-weight: 600;
        margin-bottom: 6px;
        color: #e2e8f0;
      }
      .vf__row {
        display: flex;
        gap: 8px;
        margin-bottom: 24px;
        flex-wrap: wrap;
      }
      .vf__row input {
        flex: 1 1 220px;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid #64748b;
        background: #1e293b;
        color: #e2e8f0;
        font-family: monospace;
        text-transform: uppercase;
      }
      .vf__btn {
        padding: 12px 22px;
        border-radius: 10px;
        background: #7c5cff;
        color: #fff;
        border: none;
        font-weight: 700;
        cursor: pointer;
      }
      .vf__row input:focus-visible,
      .vf__btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
      }
      .vf__badge {
        color: #34d399;
        font-weight: 800;
      }
      .vf__img {
        width: 100%;
        border-radius: 12px;
        border: 1px solid #334155;
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 16px;
        margin-top: 16px;
      }
      dt {
        color: #94a3b8;
      }
      dd {
        margin: 0;
      }
      .vf__mono {
        font-family: monospace;
        word-break: break-all;
      }
      .vf__bad {
        color: #fca5a5;
        font-weight: 600;
      }
    `,
  ],
})
export class CertificateVerifyPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = inject(CertificatesClient);

  protected serialInput = '';
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly result = signal<VerifyResult | null>(null);

  constructor() {
    usePageMeta('student.verify.metaTitle', 'student.verify.metaDescription');
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const serial = pm.get('serial');
      this.result.set(null);
      if (serial) {
        this.serialInput = serial;
        void this.verify(serial);
      }
    });
  }

  protected go(ev: Event): void {
    ev.preventDefault();
    const s = this.serialInput.trim().toUpperCase();
    if (s) void this.router.navigate(['/verify', s]);
  }

  protected imageUrl(): string {
    return this.client.imageUrl(this.result()?.serial ?? this.serialInput);
  }

  private async verify(serial: string): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.result.set(await this.client.verify(serial));
    } catch (err) {
      // 404 / 400 → "no certificate matches"; anything else is a real failure.
      if (
        err instanceof ProblemDetailsError &&
        (err.isNotFound || err.isValidation)
      ) {
        this.result.set({ valid: false });
      } else {
        this.failed.set(true);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
