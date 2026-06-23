import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { CertificatesClient, type VerifyResult } from '@codify/api-client';

/**
 * Public certificate verification page (codify.app/verify/:serial) — the
 * "verifiable URL" a learner shares. Unauthenticated. Renders the branded SVG
 * and confirms authenticity from the serial. See /docs/18-growth.md.
 */
@Component({
  selector: 'cdf-certificate-verify',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonContent],
  template: `
    <ion-content class="vf">
      <nav class="vf__nav"><a routerLink="/welcome" class="vf__brand">CODIFY</a></nav>

      <div class="vf__box">
        <h1>Verify a certificate</h1>
        <form class="vf__form" (submit)="go($event)">
          <input [(ngModel)]="serialInput" name="serial" placeholder="CDFY-XXXX-XXXX" data-testid="verify-input" />
          <button type="submit" class="btn" data-testid="verify-go">Verify</button>
        </form>

        @if (loading()) { <p class="muted">Checking…</p> }
        @else if (result(); as r) {
          @if (r.valid) {
          <div class="vf__ok" data-testid="verify-valid">
            <p class="badge">✓ Verified certificate</p>
            <img [src]="imageUrl()" alt="Certificate" class="vf__img" data-testid="verify-image" />
            <dl>
              <dt>Recipient</dt><dd data-testid="verify-recipient">{{ r.recipientName }}</dd>
              <dt>Course</dt><dd>{{ r.courseTitle }}</dd>
              <dt>Issued</dt><dd>{{ formatDate(r.issuedAt) }}</dd>
              <dt>Serial</dt><dd class="mono">{{ r.serial }}</dd>
            </dl>
          </div>
          } @else {
          <p class="vf__bad" data-testid="verify-invalid">No certificate matches that serial.</p>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .vf { --background: #0f172a; color: #e2e8f0; }
      .vf__nav { padding: 20px 24px; }
      .vf__brand { font-family: Georgia, serif; letter-spacing: 4px; font-weight: 700; color: #7c5cff; text-decoration: none; }
      .vf__box { max-width: 720px; margin: 24px auto; padding: 0 24px; }
      .vf__form { display: flex; gap: 8px; margin: 16px 0 24px; }
      .vf__form input { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid #475569; background: #1e293b; color: #e2e8f0; font-family: monospace; text-transform: uppercase; }
      .btn { padding: 12px 22px; border-radius: 10px; background: #7c5cff; color: #fff; border: none; font-weight: 700; cursor: pointer; }
      .badge { color: #34d399; font-weight: 800; }
      .vf__img { width: 100%; border-radius: 12px; border: 1px solid #334155; }
      dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin-top: 16px; }
      dt { color: #94a3b8; } dd { margin: 0; }
      .mono { font-family: monospace; }
      .vf__bad { color: #f87171; font-weight: 600; }
      .muted { color: #94a3b8; }
    `,
  ],
})
export class CertificateVerifyPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = inject(CertificatesClient);

  protected serialInput = '';
  protected readonly loading = signal(false);
  protected readonly result = signal<VerifyResult | null>(null);

  ngOnInit(): void {
    const serial = this.route.snapshot.paramMap.get('serial');
    if (serial) {
      this.serialInput = serial;
      void this.verify(serial);
    }
  }

  protected go(ev: Event): void {
    ev.preventDefault();
    const s = this.serialInput.trim().toUpperCase();
    if (s) void this.router.navigate(['/verify', s]);
  }

  protected imageUrl(): string {
    return this.client.imageUrl(this.result()?.serial ?? this.serialInput);
  }

  protected formatDate(iso?: string): string {
    return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  }

  private async verify(serial: string): Promise<void> {
    this.loading.set(true);
    try {
      this.result.set(await this.client.verify(serial));
    } catch {
      this.result.set({ valid: false });
    } finally {
      this.loading.set(false);
    }
  }
}
