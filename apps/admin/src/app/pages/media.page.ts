import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  type AssetSummary,
  Button,
  ConfirmDialogService,
  MediaLibrary,
  ToastService,
} from '@codify/ui-bootstrap';
import { AssetsClient } from '@codify/api-client';
import { AdminErrors } from '../core/errors';

/**
 * Media library (docs/14 §3): every uploaded image, cover and sprite through
 * the `MediaLibrary` organism (kind filter, upload with progress, keyboard
 * grid), plus a detail panel to copy the URL or delete an asset.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, MediaLibrary, TranslatePipe, LocalePipe],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.media.title' | translate }}</h1>
          <p class="muted">{{ 'admin.media.subtitle' | translate }}</p>
        </div>
      </header>
      <div class="split">
        <section class="admin-card">
          <cdf-media-library
            accept="image/png,image/jpeg,image/webp,image/gif"
            (selectedChange)="selected.set($event)"
          />
        </section>
        <aside class="admin-card" aria-live="polite">
          <h2>{{ 'admin.media.details' | translate }}</h2>
          @if (selected(); as a) {
            @if (a.mimeType.startsWith('image/')) {
              <img
                class="preview"
                [src]="a.url"
                [alt]="'admin.media.previewAlt' | translate"
              />
            }
            <dl class="kv">
              <dt>{{ 'admin.media.kind' | translate }}</dt>
              <dd>{{ 'admin.media.kinds.' + a.kind | translate }}</dd>
              <dt>{{ 'admin.media.type' | translate }}</dt>
              <dd>{{ a.mimeType }}</dd>
              <dt>{{ 'admin.media.size' | translate }}</dt>
              <dd>
                {{
                  'admin.media.kb'
                    | translate: { kb: (a.sizeBytes / 1024 | locale: 'number') }
                }}
              </dd>
              @if (a.createdAt) {
                <dt>{{ 'admin.common.createdAt' | translate }}</dt>
                <dd>{{ a.createdAt | locale: 'datetime' }}</dd>
              }
              <dt>{{ 'admin.common.id' | translate }}</dt>
              <dd class="mono">{{ a.id }}</dd>
              <dt>{{ 'admin.media.url' | translate }}</dt>
              <dd class="mono url">{{ a.url }}</dd>
            </dl>
            <div class="form-actions">
              <cdf-button kind="secondary" size="sm" (click)="copy(a.url)">
                {{ 'admin.media.copyUrl' | translate }}
              </cdf-button>
              <cdf-button
                kind="danger"
                size="sm"
                [loading]="deleting()"
                (click)="remove(a)"
              >
                {{ 'admin.common.delete' | translate }}
              </cdf-button>
            </div>
          } @else {
            <p class="muted small">{{ 'admin.media.pick' | translate }}</p>
          }
        </aside>
      </div>
    </div>
  `,
  styles: [
    `
      .preview {
        max-width: 100%;
        max-height: 240px;
        object-fit: contain;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        margin-bottom: var(--cdf-space-3);
      }
      .kv {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 4px 12px;
        margin: 0;
        font-size: 14px;
        dt {
          color: var(--cdf-color-text-muted);
        }
        dd {
          margin: 0;
        }
      }
      .url {
        word-break: break-all;
      }
    `,
  ],
})
export class MediaPage {
  private readonly assets = inject(AssetsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly library = viewChild.required(MediaLibrary);

  protected readonly selected = signal<AssetSummary | null>(null);
  protected readonly deleting = signal(false);

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success(this.i18n.t('admin.common.copied'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.media.copyFailed');
    }
  }

  protected async remove(a: AssetSummary): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.media.deleteTitle'),
      message: this.i18n.t('admin.media.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      await this.assets.remove(a.id);
      this.selected.set(null);
      this.library().reload();
      this.toast.success(this.i18n.t('admin.media.deleted'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    } finally {
      this.deleting.set(false);
    }
  }
}
