import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';

/**
 * Public marketing landing (codify.app root) — top-of-funnel. Unauthenticated:
 * lives outside the auth-guarded shell. Hero + features + pricing CTA into
 * sign-up. See /docs/18-growth.md.
 */
@Component({
  selector: 'cdf-marketing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonContent],
  template: `
    <ion-content class="mk">
      <nav class="mk__nav">
        <span class="mk__brand">CODIFY</span>
        <a routerLink="/login" class="mk__login" data-testid="nav-login">Log in</a>
      </nav>

      <section class="mk__hero" data-testid="hero">
        <h1>Learn to code. <span>Actually finish.</span></h1>
        <p>Bite-size lessons, real coding exercises, AI-graded practice, and a streak that keeps you coming back — in Portuguese and English.</p>
        <div class="mk__cta">
          <a routerLink="/login" class="btn btn--primary" data-testid="cta-start">Start free</a>
          <a routerLink="/verify" class="btn btn--ghost" data-testid="cta-verify">Verify a certificate</a>
        </div>
      </section>

      <section class="mk__features" data-testid="features">
        @for (f of features; track f.title) {
        <article class="feat">
          <h3>{{ f.title }}</h3>
          <p>{{ f.body }}</p>
        </article>
        }
      </section>

      <section class="mk__pricing" data-testid="pricing">
        <h2>Simple pricing</h2>
        <div class="tiers">
          @for (t of tiers; track t.name) {
          <article class="tier" [class.tier--featured]="t.featured">
            <h3>{{ t.name }}</h3>
            <p class="price">{{ t.price }}</p>
            <p class="muted">{{ t.blurb }}</p>
            <a routerLink="/login" class="btn btn--primary" [attr.data-testid]="'price-' + t.name">Choose</a>
          </article>
          }
        </div>
      </section>

      <footer class="mk__footer">© Codify — learn, build, ship.</footer>
    </ion-content>
  `,
  styles: [
    `
      .mk { --background: #0f172a; color: #e2e8f0; }
      .mk__nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; }
      .mk__brand { font-family: Georgia, serif; letter-spacing: 4px; font-weight: 700; color: #7c5cff; }
      .mk__login { color: #e2e8f0; text-decoration: none; font-weight: 600; }
      .mk__hero { text-align: center; padding: 64px 24px 40px; max-width: 760px; margin: 0 auto; }
      .mk__hero h1 { font-size: clamp(34px, 6vw, 56px); margin: 0 0 16px; line-height: 1.1; }
      .mk__hero h1 span { color: #7c5cff; }
      .mk__hero p { font-size: 18px; color: #94a3b8; }
      .mk__cta { display: flex; gap: 12px; justify-content: center; margin-top: 28px; flex-wrap: wrap; }
      .btn { padding: 12px 22px; border-radius: 10px; text-decoration: none; font-weight: 700; }
      .btn--primary { background: #7c5cff; color: #fff; }
      .btn--ghost { border: 1px solid #475569; color: #e2e8f0; }
      .mk__features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; max-width: 980px; margin: 40px auto; padding: 0 24px; }
      .feat { background: #1e293b; border-radius: 14px; padding: 22px; }
      .feat h3 { margin: 0 0 8px; }
      .feat p { color: #94a3b8; margin: 0; }
      .mk__pricing { max-width: 980px; margin: 56px auto; padding: 0 24px; text-align: center; }
      .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
      .tier { background: #1e293b; border-radius: 14px; padding: 24px; border: 1px solid transparent; }
      .tier--featured { border-color: #7c5cff; }
      .tier .price { font-size: 28px; font-weight: 800; margin: 8px 0; }
      .muted { color: #94a3b8; }
      .mk__footer { text-align: center; color: #64748b; padding: 40px; }
    `,
  ],
})
export class MarketingPage {
  protected readonly features = [
    { title: 'Real exercises', body: 'Write code in the browser and get graded against hidden tests — instantly.' },
    { title: 'AI-graded practice', body: 'Free-text answers scored against a rubric, with feedback on what to improve.' },
    { title: 'Branching scenarios', body: 'Practice soft skills through interactive, replayable dialogue.' },
    { title: 'Streaks & leagues', body: 'XP, coins, streaks and weekly leagues keep momentum going.' },
  ];
  protected readonly tiers = [
    { name: 'Free', price: 'R$0', blurb: 'Free lessons + daily streak.', featured: false },
    { name: 'Pro', price: 'R$29/mo', blurb: 'Every course, offline, XP multiplier.', featured: true },
    { name: 'Teams', price: 'Contact', blurb: 'Seats + progress dashboards.', featured: false },
  ];
}
