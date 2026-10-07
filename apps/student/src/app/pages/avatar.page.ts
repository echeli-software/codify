import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  AvatarBuilder,
  AvatarRenderer,
  Icon,
  Inventory,
  type EquippedMap,
  type ShopItem as UiShopItem,
} from '@codify/ui-ionic';
import {
  ItemsClient,
  type AvatarResponse,
  type InventoryItem,
  type ShopItem,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  changedSlots,
  equippedMap,
  equippedSprites,
  toUiItem,
} from './shared/avatar.js';

const SKIN_TONES: { value: string; emoji: string }[] = [
  { value: 'porcelain', emoji: '🧑🏻' },
  { value: 'light', emoji: '🧑🏼' },
  { value: 'tan', emoji: '🧑🏽' },
  { value: 'brown', emoji: '🧑🏾' },
  { value: 'deep', emoji: '🧑🏿' },
];

/**
 * Dressing room (docs/08): `AvatarBuilder` (slot tabs + owned items with a
 * live preview, saved in one go), the grouped `Inventory` with equip /
 * unequip toggles, free skin-tone customisation, and try-on of a shop item
 * (`?tryOn=<itemId>`) without buying. Renders from the offline asset cache
 * when there's no connection (equipping needs one).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppSkeleton,
    AvatarBuilder,
    AvatarRenderer,
    Icon,
    Inventory,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.avatar.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="av">
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="280" />
        } @else {
          @if (!online()) {
            <p class="av__muted" role="status">
              <cdf-icon name="cloud-offline" size="xs" />
              {{ 'student.avatar.offline' | translate }}
            </p>
          }

          @if (tryOn(); as t) {
            <cdf-app-card
              padding="normal"
              class="av__tryon"
              data-testid="try-on-panel"
            >
              <div class="av__tryon-row">
                <cdf-avatar-renderer
                  [config]="avatar()?.config ?? null"
                  [equipped]="tryOnSprites()"
                  [size]="140"
                />
                <div>
                  <h2>
                    {{
                      'student.avatar.tryingOn' | translate: { name: t.name }
                    }}
                  </h2>
                  <p class="av__muted">
                    {{ 'student.avatar.tryOnHint' | translate }}
                  </p>
                  <div class="av__actions">
                    <cdf-app-button
                      kind="primary"
                      size="sm"
                      [routerLink]="['/shop']"
                      data-testid="try-on-shop"
                    >
                      {{ 'student.avatar.backToShop' | translate }}
                    </cdf-app-button>
                    <cdf-app-button
                      kind="ghost"
                      size="sm"
                      (buttonClick)="clearTryOn()"
                    >
                      {{ 'student.avatar.stopTryOn' | translate }}
                    </cdf-app-button>
                  </div>
                </div>
              </div>
            </cdf-app-card>
          }

          <section aria-labelledby="av-builder">
            <h2 id="av-builder" class="av__sr">
              {{ 'student.avatar.builderTitle' | translate }}
            </h2>
            <cdf-avatar-builder
              data-testid="avatar-builder"
              [items]="owned()"
              [equipped]="equipped()"
              [config]="avatar()?.config ?? null"
              [saving]="saving()"
              (save)="save($event)"
            />
          </section>

          <section aria-labelledby="av-tone" class="av__section">
            <h2 id="av-tone">{{ 'student.avatar.skinTone' | translate }}</h2>
            <div
              class="av__tones"
              role="radiogroup"
              aria-labelledby="av-tone"
              data-testid="skin-tones"
            >
              @for (tone of skinTones; track tone.value) {
                <button
                  type="button"
                  role="radio"
                  class="av__tone"
                  [attr.aria-checked]="currentTone() === tone.value"
                  [attr.aria-label]="
                    'student.avatar.tones.' + tone.value | translate
                  "
                  [attr.data-tone]="tone.value"
                  [disabled]="!online()"
                  (click)="setSkinTone(tone.value)"
                >
                  <span aria-hidden="true">{{ tone.emoji }}</span>
                </button>
              }
            </div>
          </section>

          <section aria-labelledby="av-inventory" class="av__section">
            <div class="av__head">
              <h2 id="av-inventory">
                {{ 'student.avatar.inventory' | translate }}
              </h2>
              <a routerLink="/shop" class="av__link">{{
                'student.avatar.browseShop' | translate
              }}</a>
            </div>
            <cdf-inventory
              data-testid="inventory"
              [items]="owned()"
              [busyId]="busyId()"
              (equip)="equipOne($event, true)"
              (unequip)="equipOne($event, false)"
            />
          </section>
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .av {
        max-width: 1024px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-4);
      }
      h2 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .av__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .av__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .av__tryon-row {
        display: flex;
        gap: var(--cdf-space-3);
        align-items: center;
        flex-wrap: wrap;
      }
      .av__actions {
        display: flex;
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
      }
      .av__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .av__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .av__tones {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .av__tone {
        font-size: 26px;
        line-height: 1;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid transparent;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.05));
        cursor: pointer;
      }
      .av__tone[aria-checked='true'] {
        border-color: var(--cdf-color-primary);
      }
      .av__tone:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class AvatarPage {
  private readonly items = inject(ItemsClient);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly skinTones = SKIN_TONES;
  protected readonly online = this.network.online;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly inventory = signal<InventoryItem[]>([]);
  protected readonly tryOn = signal<ShopItem | null>(null);

  protected readonly owned = computed<UiShopItem[]>(() =>
    this.inventory().map((i) =>
      toUiItem(i.item, { owned: true, equipped: i.equipped }),
    ),
  );
  protected readonly equipped = computed<EquippedMap>(() =>
    equippedMap(this.avatar()),
  );
  protected readonly tryOnSprites = computed(() =>
    equippedSprites(this.avatar(), this.tryOn()),
  );
  protected readonly currentTone = computed(
    () => (this.avatar()?.config?.['skinTone'] as string | undefined) ?? null,
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    if (!this.network.online()) {
      await this.loadFromCache();
      this.loading.set(false);
      return;
    }
    try {
      const [av, inv] = await Promise.all([
        this.items.avatar(),
        this.items.inventory(),
      ]);
      this.avatar.set(av);
      this.inventory.set(inv);
      void this.downloads.prefetchAssets({ avatar: av, inventory: inv });
      await this.loadTryOn();
    } catch (err) {
      if (!(await this.loadFromCache())) this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFromCache(): Promise<boolean> {
    const cached = await this.downloads.getCachedAssets().catch(() => null);
    if (!cached) return false;
    this.avatar.set(cached.avatar as AvatarResponse);
    this.inventory.set((cached.inventory as InventoryItem[]) ?? []);
    return true;
  }

  /** `?tryOn=<itemId>` from the shop: preview without buying. */
  private async loadTryOn(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get('tryOn');
    if (!id) return;
    try {
      const shop = await this.items.shop();
      this.tryOn.set(shop.find((i) => i.id === id) ?? null);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected clearTryOn(): void {
    this.tryOn.set(null);
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  /** AvatarBuilder "Save": apply every changed slot. */
  protected async save(next: EquippedMap): Promise<void> {
    const changes = changedSlots(this.equipped(), next);
    if (changes.length === 0) return;
    this.saving.set(true);
    try {
      for (const c of changes) {
        this.avatar.set(await this.items.equip(c.slot, c.itemId));
        if (c.itemId) this.telemetry.track('item_equip', { itemId: c.itemId });
      }
      await this.refreshInventory();
      this.toast.show({ message: 'student.avatar.saved', kind: 'success' });
    } catch (err) {
      this.toast.error(err);
      await this.refreshInventory();
    } finally {
      this.saving.set(false);
    }
  }

  protected async equipOne(item: UiShopItem, on: boolean): Promise<void> {
    this.busyId.set(item.id);
    try {
      this.avatar.set(await this.items.equip(item.slot, on ? item.id : null));
      if (on) this.telemetry.track('item_equip', { itemId: item.id });
      await this.refreshInventory();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async setSkinTone(tone: string): Promise<void> {
    const previous = this.avatar();
    const config = { ...(previous?.config ?? {}), skinTone: tone };
    this.avatar.update((a) => (a ? { ...a, config } : a));
    try {
      this.avatar.set(await this.items.saveConfig(config));
    } catch (err) {
      this.avatar.set(previous);
      this.toast.error(err);
    }
  }

  private async refreshInventory(): Promise<void> {
    try {
      this.inventory.set(await this.items.inventory());
    } catch (err) {
      this.toast.error(err);
    }
  }
}
