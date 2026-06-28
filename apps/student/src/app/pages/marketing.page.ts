import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Icon, type IconName } from '@codify/ui-ionic';

/**
 * Public marketing landing (codify.app root) — top-of-funnel. Unauthenticated:
 * lives outside the auth-guarded shell. Hero + features + pricing CTA into
 * sign-up. See /docs/18-growth.md.
 *
 * NOTE: this is a fixed dark landing. Ionic's typography.css sets `color`
 * directly on h1–h6, which beats inherited color — so every heading here sets
 * its colour explicitly (don't rely on inheritance from `.mk`).
 */
@Component({
  selector: 'cdf-marketing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonContent, Icon],
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
          <span class="feat__icon"><cdf-icon [name]="f.icon" size="lg" /></span>
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
            @if (t.featured) { <span class="tier__tag">Most popular</span> }
            <h3>{{ t.name }}</h3>
            <p class="price">{{ t.price }}</p>
            <p class="tier__blurb">{{ t.blurb }}</p>
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
      .mk { --background: #0f172a; }
      /* Headings must be coloured explicitly — Ionic's typography.css sets a
         dark color on h1–h6 that would otherwise win over inheritance. */
      .mk h1, .mk h2, .mk h3 { color: #f8fafc; }
      .mk p { color: #cbd5e1; }

      .mk__nav { display: flex; justify-content: space-between; align-items: center; padding: 22px 28px; max-width: 1100px; margin: 0 auto; }
      .mk__brand { font-family: Georgia, serif; letter-spacing: 4px; font-weight: 700; color: #a78bfa; }
      .mk__login { color: #e2e8f0; text-decoration: none; font-weight: 600; }
      .mk__login:hover { color: #fff; }

      .mk__hero { text-align: center; padding: 72px 24px 48px; max-width: 780px; margin: 0 auto; }
      .mk__hero h1 { font-size: clamp(36px, 6vw, 60px); margin: 0 0 18px; line-height: 1.1; font-weight: 800; }
      .mk__hero h1 span { color: #a78bfa; }
      .mk__hero p { font-size: 19px; line-height: 1.6; color: #cbd5e1; max-width: 620px; margin: 0 auto; }
      .mk__cta { display: flex; gap: 14px; justify-content: center; margin-top: 32px; flex-wrap: wrap; }

      .btn { padding: 13px 26px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block; transition: transform .08s ease, background .15s ease; }
      .btn:active { transform: translateY(1px); }
      .btn--primary { background: #7c5cff; color: #fff; }
      .btn--primary:hover { background: #8f73ff; }
      .btn--ghost { border: 1px solid #475569; color: #e2e8f0; }
      .btn--ghost:hover { border-color: #7c5cff; color: #fff; }

      .mk__features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; max-width: 1040px; margin: 48px auto; padding: 0 24px; }
      .feat { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; }
      .feat__icon { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 12px; background: rgba(124, 92, 255, 0.18); color: #a78bfa; margin-bottom: 14px; font-size: 22px; }
      .feat h3 { margin: 0 0 8px; font-size: 18px; }
      .feat p { margin: 0; font-size: 14.5px; line-height: 1.55; color: #cbd5e1; }

      .mk__pricing { max-width: 1040px; margin: 64px auto; padding: 0 24px; text-align: center; }
      .mk__pricing h2 { font-size: 30px; margin: 0 0 8px; }
      .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 18px; margin-top: 28px; }
      .tier { position: relative; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 28px 24px; }
      .tier--featured { border-color: #7c5cff; box-shadow: 0 0 0 1px #7c5cff, 0 12px 32px rgba(124, 92, 255, 0.18); }
      .tier__tag { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #7c5cff; color: #fff; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px; }
      .tier h3 { margin: 0; font-size: 20px; color: #e2e8f0; }
      .tier .price { font-size: 30px; font-weight: 800; margin: 10px 0 4px; color: #f8fafc; }
      .tier__blurb { color: #cbd5e1; margin: 0 0 18px; min-height: 40px; }

      .mk__footer { text-align: center; color: #94a3b8; padding: 48px 24px; }
    `,
  ],
})
export class MarketingPage {
  protected readonly features: { icon: IconName; title: string; body: string }[] = [
    { icon: 'check-circle', title: 'Real exercises', body: 'Write code in the browser and get graded against hidden tests — instantly.' },
    { icon: 'star-outline', title: 'AI-graded practice', body: 'Free-text answers scored against a rubric, with feedback on what to improve.' },
    { icon: 'chat-ellipses', title: 'Branching scenarios', body: 'Practice soft skills through interactive, replayable dialogue.' },
    { icon: 'trophy-outline', title: 'Streaks & leagues', body: 'XP, coins, streaks and weekly leagues keep momentum going.' },
  ];
  protected readonly tiers = [
    { name: 'Free', price: 'R$0', blurb: 'Free lessons + daily streak.', featured: false },
    { name: 'Pro', price: 'R$29/mo', blurb: 'Every course, offline, XP multiplier.', featured: true },
    { name: 'Teams', price: 'Contact', blurb: 'Seats + progress dashboards.', featured: false },
  ];
}
