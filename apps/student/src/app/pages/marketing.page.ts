import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon, type IconName } from '@codify/ui-ionic';
import { TranslatePipe } from '@codify/i18n';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { usePageMeta } from './shared/seo.js';

interface Highlight {
  icon: IconName;
  key: string;
}

/**
 * Public landing (`/welcome`, and `/` for signed-out visitors). Hero, four
 * feature highlights, a pricing teaser and the sign-up CTA. Lives outside the
 * auth-guarded shell. See docs/18-growth.md.
 */
@Component({
  selector: 'cdf-marketing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe, PublicLayoutComponent],
  template: `
    <cdf-public-layout>
      <section
        class="mk__hero"
        data-testid="hero"
        aria-labelledby="mk-hero-title"
      >
        <h1 id="mk-hero-title">
          {{ 'student.welcome.heroTitle' | translate }}
          <span>{{ 'student.welcome.heroAccent' | translate }}</span>
        </h1>
        <p>{{ 'student.welcome.heroBody' | translate }}</p>
        <div class="mk__cta">
          <a
            routerLink="/login"
            class="btn btn--primary"
            data-testid="cta-start"
            >{{ 'student.welcome.ctaStart' | translate }}</a
          >
          <a
            routerLink="/pricing"
            class="btn btn--ghost"
            data-testid="cta-pricing"
            >{{ 'student.welcome.ctaPricing' | translate }}</a
          >
        </div>
      </section>

      <section
        class="mk__features"
        data-testid="features"
        aria-labelledby="mk-features-title"
      >
        <h2 id="mk-features-title" class="mk__sr">
          {{ 'student.welcome.featuresTitle' | translate }}
        </h2>
        @for (f of highlights; track f.key) {
          <article class="feat">
            <span class="feat__icon" aria-hidden="true"
              ><cdf-icon [name]="f.icon" size="lg"
            /></span>
            <h3>
              {{ 'student.welcome.highlights.' + f.key + '.title' | translate }}
            </h3>
            <p>
              {{ 'student.welcome.highlights.' + f.key + '.body' | translate }}
            </p>
          </article>
        }
      </section>

      <section class="mk__band" aria-labelledby="mk-proof-title">
        <h2 id="mk-proof-title">
          {{ 'student.welcome.proofTitle' | translate }}
        </h2>
        <p>{{ 'student.welcome.proofBody' | translate }}</p>
        <div class="mk__cta">
          <a routerLink="/features" class="btn btn--ghost">{{
            'student.welcome.ctaFeatures' | translate
          }}</a>
          <a
            routerLink="/verify"
            class="btn btn--ghost"
            data-testid="cta-verify"
            >{{ 'student.welcome.ctaVerify' | translate }}</a
          >
        </div>
      </section>
    </cdf-public-layout>
  `,
  styles: [
    `
      :host h1,
      :host h2,
      :host h3 {
        color: #f8fafc;
      }
      :host p {
        color: #cbd5e1;
      }
      .mk__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .mk__hero {
        text-align: center;
        padding: 64px 16px 40px;
        max-width: 780px;
        margin: 0 auto;
      }
      .mk__hero h1 {
        font-size: clamp(34px, 6vw, 58px);
        margin: 0 0 18px;
        line-height: 1.1;
        font-weight: 800;
      }
      .mk__hero h1 span {
        color: #a78bfa;
        display: block;
      }
      .mk__hero p {
        font-size: 18px;
        line-height: 1.6;
        max-width: 620px;
        margin: 0 auto;
      }
      .mk__cta {
        display: flex;
        gap: 14px;
        justify-content: center;
        margin-top: 28px;
        flex-wrap: wrap;
      }
      .btn {
        padding: 13px 24px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 700;
        font-size: 15px;
        display: inline-block;
      }
      .btn--primary {
        background: #7c5cff;
        color: #fff;
      }
      .btn--ghost {
        border: 1px solid #64748b;
        color: #e2e8f0;
      }
      .btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 3px;
      }
      .mk__features {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 18px;
        max-width: 1040px;
        margin: 32px auto;
        padding: 0 16px;
      }
      .feat {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 22px;
      }
      .feat__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        border-radius: 12px;
        background: rgba(124, 92, 255, 0.18);
        color: #a78bfa;
        margin-bottom: 12px;
      }
      .feat h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .feat p {
        margin: 0;
        font-size: 14.5px;
        line-height: 1.55;
      }
      .mk__band {
        max-width: 780px;
        margin: 48px auto;
        padding: 0 16px;
        text-align: center;
      }
      .mk__band h2 {
        font-size: 28px;
        margin: 0 0 10px;
      }
    `,
  ],
})
export class MarketingPage {
  protected readonly highlights: Highlight[] = [
    { icon: 'check-circle', key: 'exercises' },
    { icon: 'star-outline', key: 'ai' },
    { icon: 'chat-ellipses', key: 'scenarios' },
    { icon: 'trophy-outline', key: 'streaks' },
  ];

  constructor() {
    usePageMeta('student.welcome.metaTitle', 'student.welcome.metaDescription');
  }
}
