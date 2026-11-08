import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import {
  consentAllows,
  needsConsentBanner,
  readConsent,
  writeConsent,
} from '../telemetry/consent.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { isNativeRuntime } from '../platform/runtime.js';

/**
 * Cookie / analytics consent (docs/14 §13), web only. As a banner it shows
 * on first visit until the visitor chooses; `mode="settings"` renders the
 * same toggles inline (Data & privacy) so the choice can be changed later.
 * Necessary storage is always on; analytics and error reporting are off
 * until allowed. Error reporting starts on the next launch.
 */
@Component({
  selector: 'cdf-consent-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (!native && (mode() === 'settings' || open())) {
      <section
        class="consent"
        [class.consent--banner]="mode() === 'banner'"
        role="region"
        aria-labelledby="consent-title"
        data-testid="consent-banner"
      >
        <h2 id="consent-title" class="consent__title">
          {{ 'student.consent.title' | translate }}
        </h2>
        <p class="consent__body">
          {{ 'student.consent.body' | translate }}
          <a routerLink="/privacy">{{
            'student.consent.policy' | translate
          }}</a>
        </p>
        @if (customizing() || mode() === 'settings') {
          <fieldset class="consent__toggles">
            <legend class="consent__legend">
              {{ 'student.consent.categories' | translate }}
            </legend>
            <label class="consent__toggle">
              <input type="checkbox" checked disabled />
              <span>
                <strong>{{ 'student.consent.necessary' | translate }}</strong>
                <small>{{ 'student.consent.necessaryHint' | translate }}</small>
              </span>
            </label>
            <label class="consent__toggle">
              <input
                type="checkbox"
                data-testid="consent-analytics"
                [checked]="analytics()"
                (change)="analytics.set($any($event.target).checked)"
              />
              <span>
                <strong>{{ 'student.consent.analytics' | translate }}</strong>
                <small>{{ 'student.consent.analyticsHint' | translate }}</small>
              </span>
            </label>
            <label class="consent__toggle">
              <input
                type="checkbox"
                data-testid="consent-errors"
                [checked]="errors()"
                (change)="errors.set($any($event.target).checked)"
              />
              <span>
                <strong>{{ 'student.consent.errors' | translate }}</strong>
                <small>{{ 'student.consent.errorsHint' | translate }}</small>
              </span>
            </label>
          </fieldset>
        }
        <div class="consent__actions">
          @if (customizing() || mode() === 'settings') {
            <button
              type="button"
              class="consent__btn consent__btn--primary"
              data-testid="consent-save"
              (click)="save(analytics(), errors())"
            >
              {{ 'student.consent.save' | translate }}
            </button>
          } @else {
            <button
              type="button"
              class="consent__btn consent__btn--primary"
              data-testid="consent-accept"
              (click)="save(true, true)"
            >
              {{ 'student.consent.acceptAll' | translate }}
            </button>
            <button
              type="button"
              class="consent__btn"
              data-testid="consent-necessary"
              (click)="save(false, false)"
            >
              {{ 'student.consent.necessaryOnly' | translate }}
            </button>
            <button
              type="button"
              class="consent__btn consent__btn--link"
              data-testid="consent-customize"
              (click)="customizing.set(true)"
            >
              {{ 'student.consent.customize' | translate }}
            </button>
          }
        </div>
        @if (saved()) {
          <p class="consent__saved" role="status">
            {{ 'student.consent.saved' | translate }}
          </p>
        }
      </section>
    }
  `,
  styles: [
    `
      .consent {
        background: var(--cdf-color-surface-elev, #fff);
        color: var(--cdf-color-text, #111);
        border: 1px solid var(--cdf-color-border, #e5e7eb);
        border-radius: 12px;
        padding: 16px;
        max-width: 640px;
      }
      .consent--banner {
        position: fixed;
        z-index: 1000;
        left: 16px;
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        margin: 0 auto;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
      }
      .consent__title {
        margin: 0 0 4px;
        font-size: 16px;
      }
      .consent__body {
        margin: 0 0 12px;
        font-size: 14px;
        line-height: 1.45;
      }
      .consent__body a {
        color: var(--cdf-color-primary, #2563eb);
        margin-inline-start: 4px;
      }
      .consent__toggles {
        border: 0;
        padding: 0;
        margin: 0 0 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .consent__legend {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 6px;
      }
      .consent__toggle {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        font-size: 14px;
      }
      .consent__toggle input {
        width: 20px;
        height: 20px;
        margin-top: 2px;
      }
      .consent__toggle span {
        display: flex;
        flex-direction: column;
      }
      .consent__toggle small {
        color: var(--cdf-color-text-muted, #6b7280);
      }
      .consent__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .consent__btn {
        min-height: 40px;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid var(--cdf-color-border, #d1d5db);
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .consent__btn--primary {
        background: var(--cdf-color-primary, #2563eb);
        border-color: transparent;
        color: var(--cdf-color-on-primary, #fff);
      }
      .consent__btn--link {
        border-color: transparent;
        text-decoration: underline;
      }
      .consent__btn:focus-visible,
      .consent__body a:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      .consent__saved {
        margin: 8px 0 0;
        font-size: 13px;
        color: var(--cdf-color-success, #15803d);
      }
    `,
  ],
})
export class ConsentBanner {
  /** `banner`: first-visit overlay; `settings`: inline toggles. */
  readonly mode = input<'banner' | 'settings'>('banner');

  private readonly telemetry = inject(TelemetryService);
  /** Native apps follow the store privacy disclosure instead (docs/14 §13). */
  protected readonly native = isNativeRuntime();
  protected readonly open = signal(needsConsentBanner());
  protected readonly customizing = signal(false);
  protected readonly analytics = signal(readConsent()?.analytics ?? false);
  protected readonly errors = signal(readConsent()?.errors ?? false);
  protected readonly saved = signal(false);

  protected save(analytics: boolean, errors: boolean): void {
    const before = consentAllows('analytics');
    writeConsent({ analytics, errors });
    this.analytics.set(analytics);
    this.errors.set(errors);
    this.open.set(false);
    this.saved.set(this.mode() === 'settings');
    // Only recorded when analytics is (now) allowed.
    if (analytics || before)
      this.telemetry.track('consent_updated', { analytics, errors });
  }
}
