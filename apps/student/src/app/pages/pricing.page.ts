import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  PlansClient,
  ProblemDetailsError,
  type Plan,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AppSkeleton, PlanCard } from '@codify/ui-ionic';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { usePageMeta } from './shared/seo.js';
import { planCardView, type PlanCardView } from './shared/plan-view.js';

/**
 * Public `/pricing`: the free tier plus the real active plans from
 * `GET /plans`. Signed-out visitors get the plans too when the API allows
 * it; when it answers 401 we show the free tier and a "sign up to see
 * prices" note instead of made-up numbers.
 */
@Component({
  selector: 'cdf-pricing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AppSkeleton,
    PlanCard,
    TranslatePipe,
    PublicLayoutComponent,
  ],
  template: `
    <cdf-public-layout>
      <header class="pr__head">
        <h1>{{ 'student.pricing.title' | translate }}</h1>
        <p>{{ 'student.pricing.subtitle' | translate }}</p>
      </header>

      <div class="pr__grid" data-testid="pricing-plans">
        <article class="pr__free" aria-labelledby="pr-free">
          <h2 id="pr-free">{{ 'student.pricing.free.name' | translate }}</h2>
          <p class="pr__free-price">
            {{ 'student.pricing.free.price' | translate }}
          </p>
          <ul>
            <li>{{ 'student.pricing.free.perk1' | translate }}</li>
            <li>{{ 'student.pricing.free.perk2' | translate }}</li>
            <li>{{ 'student.pricing.free.perk3' | translate }}</li>
          </ul>
          <a
            routerLink="/login"
            class="btn btn--ghost"
            data-testid="pricing-free-cta"
            >{{ 'student.welcome.ctaStart' | translate }}</a
          >
        </article>

        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="320" />
        } @else {
          @for (p of cards(); track p.id) {
            <cdf-plan-card
              class="pr__plan"
              [attr.data-plan-id]="p.id"
              [name]="p.name"
              [description]="p.description"
              [amountCents]="p.amountCents"
              [currency]="p.currency"
              [period]="p.period"
              [installments]="p.installments"
              [features]="p.features"
              [highlight]="p.highlight"
              [badge]="p.trialLabel"
              [ctaLabel]="'student.pricing.choose' | translate"
              (choose)="choose()"
            />
          }
        }
      </div>

      @if (state() === 'signin') {
        <p class="pr__note" role="status" data-testid="pricing-signin">
          {{ 'student.pricing.signInForPrices' | translate }}
          <a routerLink="/login">{{
            'student.public.nav.signup' | translate
          }}</a>
        </p>
      } @else if (state() === 'error') {
        <p class="pr__note" role="alert">
          {{ 'student.pricing.loadError' | translate }}
        </p>
      } @else if (state() === 'empty') {
        <p class="pr__note" role="status">
          {{ 'student.pricing.empty' | translate }}
        </p>
      }
      <p class="pr__fine">{{ 'student.pricing.fineprint' | translate }}</p>
    </cdf-public-layout>
  `,
  styles: [
    `
      :host h1,
      :host h2 {
        color: #f8fafc;
      }
      :host p,
      :host li {
        color: #cbd5e1;
      }
      .pr__head {
        text-align: center;
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 16px 8px;
      }
      .pr__head h1 {
        font-size: clamp(30px, 5vw, 46px);
        margin: 0 0 10px;
      }
      .pr__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 18px;
        max-width: 1100px;
        margin: 24px auto;
        padding: 0 16px;
        align-items: start;
      }
      .pr__free {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pr__free h2 {
        margin: 0;
        font-size: 20px;
      }
      .pr__free-price {
        font-size: 28px;
        font-weight: 800;
        margin: 0;
      }
      .pr__free ul {
        padding-left: 18px;
        margin: 0 0 8px;
      }
      .pr__plan {
        --cdf-color-surface: #ffffff;
        border-radius: 16px;
      }
      .pr__note,
      .pr__fine {
        text-align: center;
        max-width: 720px;
        margin: 8px auto;
        padding: 0 16px;
      }
      .pr__note a {
        color: #c4b5fd;
        font-weight: 700;
      }
      .pr__fine {
        font-size: 13px;
        color: #94a3b8;
      }
      .btn {
        padding: 11px 20px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 700;
        text-align: center;
      }
      .btn--ghost {
        border: 1px solid #64748b;
        color: #e2e8f0;
      }
    `,
  ],
})
export class PricingPage {
  private readonly plans = inject(PlansClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  protected readonly loading = signal(true);
  protected readonly state = signal<'ok' | 'signin' | 'error' | 'empty'>('ok');
  private readonly items = signal<Plan[]>([]);

  protected readonly cards = computed<PlanCardView[]>(() => {
    this.i18n.currentLocale();
    return this.items()
      .map((p) => planCardView(p, (k, params) => this.i18n.t(k, params)))
      .filter((v): v is PlanCardView => v !== null);
  });

  constructor() {
    usePageMeta('student.pricing.metaTitle', 'student.pricing.metaDescription');
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await this.plans.list();
      this.items.set(res.items.filter((p) => p.isActive));
      this.state.set(this.items().length ? 'ok' : 'empty');
    } catch (err) {
      this.state.set(
        err instanceof ProblemDetailsError && err.isUnauthorized
          ? 'signin'
          : 'error',
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected choose(): void {
    void this.router.navigateByUrl(
      this.auth.isAuthenticated()
        ? '/subscription'
        : '/login?redirect=%2Fsubscription',
    );
  }
}
