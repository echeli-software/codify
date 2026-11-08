import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  AppInput,
  AppSkeleton,
  AvatarBuilder,
  AvatarRenderer,
  FormField,
  Icon,
  Inventory,
  type AvatarSlot,
  type EquippedMap,
  type ShopItem as UiShopItem,
} from '@codify/ui-ionic';
import {
  BASE_BODIES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  SKIN_TONE_HEX,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarPose,
} from '@codify/ui-core';
import {
  ItemsClient,
  MeClient,
  type AvatarResponse,
  type InventoryItem,
  type ShopItem,
} from '@codify/api-client';
import { MotionAndSoundService } from '@codify/gamification-engine';
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

/** Look changes are saved 3 s after the last tap (docs/08 §9). */
const LOOK_AUTOSAVE_MS = 3000;

/**
 * Dressing room (docs/08 §9–10): `AvatarBuilder` (every slot browsable,
 * live preview, 3 s auto-save + Save, Random, pose picker, "Browse shop for
 * [slot]"), the free base look (8 skin tones, base body, hair style +
 * colour, eye colour — also auto-saved), pet naming, the grouped
 * `Inventory` with rarity filter / search / bulk equip, and try-on of a
 * shop item (`?tryOn=<itemId>`). Renders from the offline asset cache when
 * there's no connection (editing needs one).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppInput,
    AppSkeleton,
    AvatarBuilder,
    AvatarRenderer,
    FormField,
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
                  [config]="look()"
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
              [config]="look()"
              [saving]="saving()"
              [randomizing]="randomizing()"
              [animate]="!reducedMotion()"
              [autosaveMs]="online() ? 3000 : 0"
              (save)="save($event)"
              (randomize)="randomize()"
              (poseChange)="setLook({ pose: $event })"
              (browseShop)="browseShop($event)"
            />
          </section>

          <section
            aria-labelledby="av-look"
            class="av__section"
            data-testid="look-editor"
          >
            <div class="av__head">
              <h2 id="av-look">{{ 'student.avatar.look' | translate }}</h2>
              <span class="av__muted" role="status" aria-live="polite">
                @if (lookSaving()) {
                  {{ 'student.avatar.lookSaving' | translate }}
                } @else if (lookDirty()) {
                  {{ 'student.avatar.lookPending' | translate }}
                }
              </span>
            </div>

            <h3 id="av-tone">{{ 'student.avatar.skinTone' | translate }}</h3>
            <div
              class="av__swatches"
              role="radiogroup"
              aria-labelledby="av-tone"
              data-testid="skin-tones"
            >
              @for (tone of skinTones; track tone) {
                <button
                  type="button"
                  role="radio"
                  class="av__swatch"
                  [style.background]="skinHex[tone]"
                  [attr.aria-checked]="look().skinTone === tone"
                  [attr.aria-label]="'student.avatar.tones.' + tone | translate"
                  [attr.data-tone]="tone"
                  [disabled]="!online()"
                  (click)="setLook({ skinTone: tone })"
                ></button>
              }
            </div>

            <h3 id="av-body">{{ 'student.avatar.body' | translate }}</h3>
            <div
              class="av__chips"
              role="radiogroup"
              aria-labelledby="av-body"
              data-testid="body-picker"
            >
              @for (b of bodies; track b) {
                <button
                  type="button"
                  role="radio"
                  class="av__chip"
                  [attr.aria-checked]="look().baseBodyId === b"
                  [disabled]="!online()"
                  (click)="setLook({ baseBodyId: b })"
                >
                  {{ 'student.avatar.bodies.' + b | translate }}
                </button>
              }
            </div>

            <h3 id="av-hair">{{ 'student.avatar.hairStyle' | translate }}</h3>
            <div
              class="av__chips"
              role="radiogroup"
              aria-labelledby="av-hair"
              data-testid="hair-picker"
            >
              @for (h of hairStyles; track h) {
                <button
                  type="button"
                  role="radio"
                  class="av__chip"
                  [attr.aria-checked]="look().baseHairStyle === h"
                  [attr.data-hair]="h"
                  [disabled]="!online()"
                  (click)="setLook({ baseHairStyle: h })"
                >
                  {{ 'student.avatar.hair.' + h | translate }}
                </button>
              }
            </div>

            <h3 id="av-hair-color">
              {{ 'student.avatar.hairColor' | translate }}
            </h3>
            <div
              class="av__swatches"
              role="radiogroup"
              aria-labelledby="av-hair-color"
              data-testid="hair-colors"
            >
              @for (c of hairColors; track c; let i = $index) {
                <button
                  type="button"
                  role="radio"
                  class="av__swatch"
                  [style.background]="c"
                  [attr.aria-checked]="look().baseHairColor === c"
                  [attr.aria-label]="
                    'student.avatar.hairColors.c' + i | translate
                  "
                  [disabled]="!online()"
                  (click)="setLook({ baseHairColor: c })"
                ></button>
              }
            </div>

            <h3 id="av-eyes">{{ 'student.avatar.eyeColor' | translate }}</h3>
            <div
              class="av__swatches"
              role="radiogroup"
              aria-labelledby="av-eyes"
              data-testid="eye-colors"
            >
              @for (c of eyeColors; track c; let i = $index) {
                <button
                  type="button"
                  role="radio"
                  class="av__swatch"
                  [style.background]="c"
                  [attr.aria-checked]="look().eyeColor === c"
                  [attr.aria-label]="
                    'student.avatar.eyeColors.c' + i | translate
                  "
                  [disabled]="!online()"
                  (click)="setLook({ eyeColor: c })"
                ></button>
              }
            </div>
          </section>

          @if (hasPet()) {
            <section aria-labelledby="av-pet" class="av__section">
              <h2 id="av-pet">{{ 'student.avatar.petTitle' | translate }}</h2>
              <form
                class="av__pet"
                (submit)="savePetName($event)"
                data-testid="pet-name-form"
              >
                <cdf-form-field
                  [label]="'student.avatar.petName' | translate"
                  class="av__pet-field"
                >
                  <cdf-app-input
                    name="petName"
                    [(ngModel)]="petName"
                    [maxLength]="30"
                    data-testid="pet-name"
                  />
                </cdf-form-field>
                <cdf-app-button
                  kind="secondary"
                  type="submit"
                  [disabled]="!online()"
                  [loading]="savingPet()"
                >
                  {{ 'common.save' | translate }}
                </cdf-app-button>
              </form>
            </section>
          }

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
              [bulk]="online()"
              (equip)="equipOne($event, true)"
              (unequip)="equipOne($event, false)"
              (bulkEquip)="bulkEquip($event)"
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
      h3 {
        margin: var(--cdf-space-3) 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
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
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
      }
      .av__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .av__swatches,
      .av__chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .av__swatch {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 3px solid var(--cdf-color-surface);
        box-shadow: 0 0 0 1px var(--cdf-color-border);
        cursor: pointer;
      }
      .av__swatch[aria-checked='true'] {
        box-shadow: 0 0 0 3px var(--cdf-color-primary);
      }
      .av__chip {
        min-height: 40px;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        font: inherit;
        font-size: var(--cdf-font-size-sm);
        cursor: pointer;
      }
      .av__chip[aria-checked='true'] {
        background: var(--cdf-color-primary);
        border-color: transparent;
        color: var(--cdf-color-on-primary, #fff);
      }
      .av__swatch:focus-visible,
      .av__chip:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 3px;
      }
      .av__swatch:disabled,
      .av__chip:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .av__pet {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .av__pet-field {
        flex: 1 1 220px;
      }
    `,
  ],
})
export class AvatarPage {
  private readonly items = inject(ItemsClient);
  private readonly me = inject(MeClient);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  protected readonly reducedMotion = inject(MotionAndSoundService)
    .reducedMotion;

  protected readonly skinTones = SKIN_TONES;
  protected readonly skinHex = SKIN_TONE_HEX;
  protected readonly bodies = BASE_BODIES;
  protected readonly hairStyles = HAIR_STYLES;
  protected readonly hairColors = HAIR_COLORS;
  protected readonly eyeColors = EYE_COLORS;
  protected readonly online = this.network.online;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly randomizing = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly inventory = signal<InventoryItem[]>([]);
  protected readonly tryOn = signal<ShopItem | null>(null);
  /** Unsaved look edits (auto-saved after 3 s). */
  private readonly lookDraft = signal<Partial<AvatarConfig>>({});
  protected readonly lookSaving = signal(false);
  protected readonly savingPet = signal(false);
  protected petName = '';
  private lookTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly owned = computed<UiShopItem[]>(() =>
    this.inventory().map((i) =>
      toUiItem(i.item, { owned: true, equipped: i.equipped }),
    ),
  );
  protected readonly equipped = computed<EquippedMap>(() =>
    equippedMap(this.avatar()),
  );
  protected readonly look = computed<AvatarConfig>(() => ({
    ...normalizeAvatarConfig(this.avatar()?.config ?? null),
    ...this.lookDraft(),
  }));
  protected readonly lookDirty = computed(
    () => Object.keys(this.lookDraft()).length > 0,
  );
  protected readonly tryOnSprites = computed(() =>
    equippedSprites(this.avatar(), this.tryOn()),
  );
  protected readonly hasPet = computed(() =>
    this.inventory().some((i) => i.item.slot === 'PET'),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.lookTimer) {
        clearTimeout(this.lookTimer);
        void this.flushLook();
      }
    });
    void this.load();
  }

  private setAvatar(av: AvatarResponse): void {
    this.avatar.set(av);
    this.petName = av.petName ?? '';
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
      this.setAvatar(av);
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
    this.setAvatar(cached.avatar as AvatarResponse);
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

  protected browseShop(slot: AvatarSlot): void {
    void this.router.navigate(['/shop'], { queryParams: { slot } });
  }

  /** AvatarBuilder save / auto-save: apply every changed slot. */
  protected async save(next: EquippedMap): Promise<void> {
    const changes = changedSlots(this.equipped(), next);
    if (changes.length === 0 || this.saving()) return;
    this.saving.set(true);
    try {
      for (const c of changes) {
        this.setAvatar(await this.items.equip(c.slot, c.itemId));
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

  /** "Random": the server shuffles equipment from the owned set. */
  protected async randomize(): Promise<void> {
    if (!this.online() || this.randomizing()) return;
    this.randomizing.set(true);
    try {
      this.setAvatar(await this.items.randomize());
      this.telemetry.track('avatar_randomize');
      await this.refreshInventory();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.randomizing.set(false);
    }
  }

  protected async equipOne(item: UiShopItem, on: boolean): Promise<void> {
    this.busyId.set(item.id);
    try {
      this.setAvatar(await this.items.equip(item.slot, on ? item.id : null));
      if (on) this.telemetry.track('item_equip', { itemId: item.id });
      await this.refreshInventory();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busyId.set(null);
    }
  }

  /** Inventory multi-select: one item per slot, applied in turn. */
  protected async bulkEquip(chosen: UiShopItem[]): Promise<void> {
    this.saving.set(true);
    try {
      for (const it of chosen) {
        this.setAvatar(await this.items.equip(it.slot, it.id));
        this.telemetry.track('item_equip', { itemId: it.id });
      }
      await this.refreshInventory();
      this.toast.show({
        message: 'student.avatar.bulkEquipped',
        kind: 'success',
        params: { count: chosen.length },
      });
    } catch (err) {
      this.toast.error(err);
      await this.refreshInventory();
    } finally {
      this.saving.set(false);
    }
  }

  /** Base-look edit: preview now, save 3 s after the last change. */
  protected setLook(patch: Partial<AvatarConfig> | { pose: AvatarPose }): void {
    if (!this.online()) return;
    this.lookDraft.update((d) => ({ ...d, ...patch }));
    if (this.lookTimer) clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => {
      this.lookTimer = null;
      void this.flushLook();
    }, LOOK_AUTOSAVE_MS);
  }

  private async flushLook(): Promise<void> {
    const patch = this.lookDraft();
    if (Object.keys(patch).length === 0) return;
    this.lookSaving.set(true);
    try {
      this.setAvatar(await this.items.saveConfig(patch));
      // Keep edits made while the save was in flight.
      this.lookDraft.update((d) => {
        const rest = { ...d };
        for (const [k, v] of Object.entries(patch))
          if (rest[k as keyof AvatarConfig] === v)
            delete rest[k as keyof AvatarConfig];
        return rest;
      });
    } catch (err) {
      this.lookDraft.set({});
      this.toast.error(err);
    } finally {
      this.lookSaving.set(false);
    }
  }

  protected async savePetName(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.petName.trim();
    this.savingPet.set(true);
    try {
      const me = await this.me.update({ petName: name || null });
      this.avatar.update((a) =>
        a ? { ...a, petName: me.petName ?? null } : a,
      );
      this.petName = me.petName ?? '';
      this.toast.show({
        message: 'student.avatar.petSaved',
        kind: 'success',
        params: { name: me.petName ?? '' },
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.savingPet.set(false);
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
