import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon, type IconName } from '@codify/ui-ionic';
import { TranslatePipe } from '@codify/i18n';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { usePageMeta } from './shared/seo.js';

interface FeatureSection {
  key: string;
  icon: IconName;
  points: number;
}

/** Public `/features` page — what a learner gets, section by section. */
@Component({
  selector: 'cdf-features-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe, PublicLayoutComponent],
  template: `
    <cdf-public-layout>
      <header class="ft__head">
        <h1>{{ 'student.features.title' | translate }}</h1>
        <p>{{ 'student.features.subtitle' | translate }}</p>
      </header>
      <div class="ft__list" data-testid="feature-sections">
        @for (s of sections; track s.key) {
          <section class="ft__section" [attr.aria-labelledby]="'ft-' + s.key">
            <span class="ft__icon" aria-hidden="true"
              ><cdf-icon [name]="s.icon" size="lg"
            /></span>
            <div>
              <h2 [id]="'ft-' + s.key">
                {{
                  'student.features.sections.' + s.key + '.title' | translate
                }}
              </h2>
              <p>
                {{ 'student.features.sections.' + s.key + '.body' | translate }}
              </p>
              <ul>
                @for (i of range(s.points); track i) {
                  <li>
                    {{
                      'student.features.sections.' + s.key + '.points.' + i
                        | translate
                    }}
                  </li>
                }
              </ul>
            </div>
          </section>
        }
      </div>
      <div class="ft__cta">
        <a routerLink="/login" class="btn btn--primary">{{
          'student.welcome.ctaStart' | translate
        }}</a>
        <a routerLink="/pricing" class="btn btn--ghost">{{
          'student.welcome.ctaPricing' | translate
        }}</a>
      </div>
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
      .ft__head {
        max-width: 780px;
        margin: 0 auto;
        padding: 48px 16px 16px;
        text-align: center;
      }
      .ft__head h1 {
        font-size: clamp(30px, 5vw, 46px);
        margin: 0 0 12px;
      }
      .ft__list {
        max-width: 880px;
        margin: 0 auto;
        padding: 0 16px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .ft__section {
        display: flex;
        gap: 18px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 22px;
      }
      .ft__section h2 {
        margin: 0 0 6px;
        font-size: 20px;
      }
      .ft__section ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }
      .ft__icon {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        border-radius: 12px;
        background: rgba(124, 92, 255, 0.18);
        color: #a78bfa;
      }
      .ft__cta {
        display: flex;
        gap: 14px;
        justify-content: center;
        flex-wrap: wrap;
        margin: 36px 16px;
      }
      .btn {
        padding: 13px 24px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 700;
      }
      .btn--primary {
        background: #7c5cff;
        color: #fff;
      }
      .btn--ghost {
        border: 1px solid #64748b;
        color: #e2e8f0;
      }
      @media (max-width: 480px) {
        .ft__section {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class FeaturesPage {
  protected readonly sections: FeatureSection[] = [
    { key: 'lessons', icon: 'school', points: 3 },
    { key: 'practice', icon: 'chip', points: 3 },
    { key: 'motivation', icon: 'flame', points: 3 },
    { key: 'offline', icon: 'download', points: 2 },
    { key: 'certificates', icon: 'ribbon', points: 2 },
  ];

  constructor() {
    usePageMeta(
      'student.features.metaTitle',
      'student.features.metaDescription',
    );
  }

  protected range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }
}
