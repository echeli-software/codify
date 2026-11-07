import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { usePageMeta } from './shared/seo.js';

export type LegalDoc = 'privacy' | 'terms';

/**
 * Sections per document; the text lives in `student.legal.<doc>.sections.N`
 * (both locales). Keep these counts in sync with the string files —
 * `legal.page.spec.ts` checks every section has a title and a body.
 */
export const LEGAL_SECTION_COUNT: Record<LegalDoc, number> = {
  privacy: 12,
  terms: 14,
};

/**
 * Public `/privacy` and `/terms` (docs/14 §Privacy: "Privacy Policy + Terms
 * linked from sign-up and Settings"). The text is a DRAFT pending legal
 * review — the page says so until `student.legal.draftNotice` is removed.
 * Bracketed `[…]` values are facts only the company/legal can supply.
 */
@Component({
  selector: 'cdf-legal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, PublicLayoutComponent],
  template: `
    <cdf-public-layout>
      <article class="lg" [attr.data-doc]="doc">
        <header class="lg__head">
          <h1>{{ 'student.legal.' + doc + '.title' | translate }}</h1>
          <p class="lg__updated">
            {{ 'student.legal.updated' | translate }}
          </p>
          <p class="lg__draft" role="note" data-testid="legal-draft-notice">
            {{ 'student.legal.draftNotice' | translate }}
          </p>
          <p>{{ 'student.legal.' + doc + '.intro' | translate }}</p>
        </header>

        <nav
          class="lg__toc"
          [attr.aria-label]="'student.legal.contents' | translate"
        >
          <ol>
            @for (i of sections; track i) {
              <li>
                <a [href]="'#' + doc + '-' + i">{{
                  'student.legal.' + doc + '.sections.' + i + '.title'
                    | translate
                }}</a>
              </li>
            }
          </ol>
        </nav>

        @for (i of sections; track i) {
          <section [id]="doc + '-' + i" class="lg__section">
            <h2>
              {{ i + 1 }}.
              {{
                'student.legal.' + doc + '.sections.' + i + '.title' | translate
              }}
            </h2>
            <p>
              {{
                'student.legal.' + doc + '.sections.' + i + '.body' | translate
              }}
            </p>
          </section>
        }

        <p class="lg__other">
          @if (doc === 'privacy') {
            <a routerLink="/terms">{{
              'student.legal.terms.title' | translate
            }}</a>
          } @else {
            <a routerLink="/privacy">{{
              'student.legal.privacy.title' | translate
            }}</a>
          }
        </p>
      </article>
    </cdf-public-layout>
  `,
  styles: [
    `
      .lg {
        max-width: 760px;
        margin: 0 auto;
        padding: 40px 16px 56px;
        color: #cbd5e1;
        line-height: 1.65;
      }
      .lg h1,
      .lg h2 {
        color: #f8fafc;
      }
      .lg h1 {
        font-size: clamp(28px, 5vw, 40px);
        margin: 0 0 8px;
      }
      .lg h2 {
        font-size: 19px;
        margin: 28px 0 8px;
        scroll-margin-top: 80px;
      }
      .lg__updated {
        margin: 0 0 16px;
        color: #94a3b8;
        font-size: 14px;
      }
      .lg__draft {
        margin: 0 0 20px;
        padding: 12px 14px;
        border: 1px solid #f59e0b;
        border-radius: 10px;
        background: rgba(245, 158, 11, 0.12);
        color: #fde68a;
        font-weight: 600;
      }
      .lg__toc {
        margin: 20px 0 8px;
        padding: 16px 20px;
        border: 1px solid #334155;
        border-radius: 12px;
        background: #1e293b;
      }
      .lg__toc ol {
        margin: 0;
        padding-left: 20px;
      }
      .lg a {
        color: #a5b4fc;
      }
      .lg a:focus-visible {
        outline: 2px solid #a5b4fc;
        outline-offset: 2px;
      }
      .lg__section p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .lg__other {
        margin-top: 36px;
      }
    `,
  ],
})
export class LegalPage {
  protected readonly doc: LegalDoc =
    inject(ActivatedRoute).snapshot.data['doc'] === 'terms'
      ? 'terms'
      : 'privacy';
  protected readonly sections = Array.from(
    { length: LEGAL_SECTION_COUNT[this.doc] },
    (_, i) => i,
  );

  constructor() {
    usePageMeta(
      `student.legal.${this.doc}.title`,
      `student.legal.${this.doc}.metaDescription`,
    );
  }
}
