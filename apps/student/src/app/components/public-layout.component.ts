import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AuthService } from '@codify/auth';
import { LanguageSwitcher } from '@codify/ui-ionic';
import { TranslatePipe } from '@codify/i18n';

/**
 * Shared chrome for the public (signed-out) pages: `/welcome`, `/pricing`,
 * `/features` and certificate verification. Brand + primary nav, a language
 * switcher, the projected page body and a footer with the legal / verify
 * links. Fixed dark palette so the landing reads the same in both themes.
 */
@Component({
  selector: 'cdf-public-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonContent,
    LanguageSwitcher,
    TranslatePipe,
  ],
  template: `
    <ion-content class="pub">
      <a class="pub__skip" href="#pub-main">{{
        'student.public.skipToContent' | translate
      }}</a>
      <header class="pub__bar">
        <nav
          class="pub__nav"
          [attr.aria-label]="'student.public.navLabel' | translate"
        >
          <a routerLink="/welcome" class="pub__brand" data-testid="pub-brand"
            >Codify</a
          >
          <ul class="pub__links">
            <li>
              <a
                routerLink="/features"
                routerLinkActive="is-active"
                ariaCurrentWhenActive="page"
                >{{ 'student.public.nav.features' | translate }}</a
              >
            </li>
            <li>
              <a
                routerLink="/pricing"
                routerLinkActive="is-active"
                ariaCurrentWhenActive="page"
                data-testid="nav-pricing"
                >{{ 'student.public.nav.pricing' | translate }}</a
              >
            </li>
            <li>
              <a
                routerLink="/verify"
                routerLinkActive="is-active"
                ariaCurrentWhenActive="page"
                >{{ 'student.public.nav.verify' | translate }}</a
              >
            </li>
          </ul>
          <div class="pub__actions">
            <cdf-language-switcher class="pub__lang" [showLabel]="false" />
            @if (signedIn()) {
              <a
                routerLink="/today"
                class="pub__btn pub__btn--primary"
                data-testid="nav-app"
                >{{ 'student.public.nav.openApp' | translate }}</a
              >
            } @else {
              <a
                routerLink="/login"
                class="pub__login"
                data-testid="nav-login"
                >{{ 'student.public.nav.login' | translate }}</a
              >
              <a
                routerLink="/login"
                class="pub__btn pub__btn--primary"
                data-testid="nav-signup"
                >{{ 'student.public.nav.signup' | translate }}</a
              >
            }
          </div>
        </nav>
      </header>

      <main id="pub-main" class="pub__main" tabindex="-1">
        <ng-content />
      </main>

      <footer class="pub__footer">
        <p>{{ 'student.public.footer.tagline' | translate }}</p>
        <nav
          class="pub__footer-links"
          [attr.aria-label]="'student.public.footer.label' | translate"
        >
          <a routerLink="/features">{{
            'student.public.nav.features' | translate
          }}</a>
          <a routerLink="/pricing">{{
            'student.public.nav.pricing' | translate
          }}</a>
          <a routerLink="/verify">{{
            'student.public.nav.verify' | translate
          }}</a>
        </nav>
      </footer>
    </ion-content>
  `,
  styles: [
    `
      .pub {
        --background: #0f172a;
        --color: #e2e8f0;
        color: #e2e8f0;
      }
      .pub__skip {
        position: absolute;
        left: -9999px;
        top: 8px;
        z-index: 10;
        background: #7c5cff;
        color: #fff;
        padding: 8px 14px;
        border-radius: 8px;
      }
      .pub__skip:focus {
        left: 16px;
      }
      .pub__bar {
        border-bottom: 1px solid #1e293b;
      }
      .pub__nav {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding: 14px 16px;
        max-width: 1100px;
        margin: 0 auto;
      }
      .pub__brand {
        font-family: Georgia, serif;
        letter-spacing: 4px;
        text-transform: uppercase;
        font-weight: 700;
        color: #a78bfa;
        text-decoration: none;
      }
      .pub__links {
        display: flex;
        gap: 16px;
        list-style: none;
        margin: 0;
        padding: 0;
        flex-wrap: wrap;
      }
      .pub__links a,
      .pub__login,
      .pub__footer-links a {
        color: #cbd5e1;
        text-decoration: none;
        font-weight: 600;
        font-size: 14px;
      }
      .pub__links a.is-active {
        color: #fff;
        text-decoration: underline;
        text-underline-offset: 6px;
      }
      .pub a:focus-visible,
      .pub button:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 3px;
        border-radius: 6px;
      }
      .pub__actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .pub__btn {
        padding: 9px 16px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 700;
        font-size: 14px;
      }
      .pub__btn--primary {
        background: #7c5cff;
        color: #fff;
      }
      .pub__main {
        outline: none;
        min-height: 60vh;
      }
      .pub__footer {
        text-align: center;
        color: #94a3b8;
        padding: 40px 16px;
        border-top: 1px solid #1e293b;
      }
      .pub__footer p {
        color: #94a3b8;
        margin: 0 0 10px;
      }
      .pub__footer-links {
        display: flex;
        gap: 16px;
        justify-content: center;
        flex-wrap: wrap;
      }
      @media (max-width: 600px) {
        .pub__links {
          order: 3;
          width: 100%;
        }
        .pub__lang {
          display: none;
        }
      }
    `,
  ],
})
export class PublicLayoutComponent {
  private readonly auth = inject(AuthService);
  protected readonly signedIn = this.auth.isAuthenticated;
}
