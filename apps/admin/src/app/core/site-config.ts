import { Injectable, inject, signal } from '@angular/core';
import { AdminCatalogClient, type SiteConfig } from '@codify/api-client';
import { I18nService } from '@codify/i18n';
import { applyBrandingVars } from '@codify/ui-core/color';

/**
 * Applies the environment's site settings (docs/04 Settings) to the admin:
 * branding colour overrides become `--cdf-color-*` variables on `<html>`,
 * disabled locales leave the language switchers, and the optional label
 * (e.g. "STAGING") is exposed for the shell badge. Never blocks start-up —
 * a failed fetch keeps the built-in tokens and every locale.
 */
@Injectable({ providedIn: 'root' })
export class SiteConfigService {
  private readonly client = inject(AdminCatalogClient);
  private readonly i18n = inject(I18nService);
  private applied: string[] = [];

  readonly config = signal<SiteConfig | null>(null);
  readonly label = signal<string | null>(null);

  async load(): Promise<void> {
    try {
      this.apply(await this.client.siteConfig());
    } catch {
      /* keep defaults */
    }
  }

  apply(config: SiteConfig): void {
    this.config.set(config);
    this.label.set(config.branding.label);
    if (typeof document !== 'undefined')
      this.applied = applyBrandingVars(
        document.documentElement.style,
        config.branding.tokens,
        this.applied,
      );
    void this.i18n.restrictLocales(config.locales.enabled);
  }
}
