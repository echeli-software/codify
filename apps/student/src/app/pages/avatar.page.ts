import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';
import {
  ItemsClient,
  type AvatarResponse,
  type InventoryItem,
  type ItemSlot,
} from '@codify/api-client';

const SKIN_TONES: { value: string; emoji: string }[] = [
  { value: 'porcelain', emoji: '🧑🏻' },
  { value: 'light', emoji: '🧑🏼' },
  { value: 'tan', emoji: '🧑🏽' },
  { value: 'brown', emoji: '🧑🏾' },
  { value: 'deep', emoji: '🧑🏿' },
];

const SLOTS: { value: ItemSlot; label: string }[] = [
  { value: 'HAT', label: 'Hat' },
  { value: 'GLASSES', label: 'Glasses' },
  { value: 'TOP', label: 'Top' },
  { value: 'BOTTOM', label: 'Bottom' },
  { value: 'SHOES', label: 'Shoes' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'PET', label: 'Pet' },
  { value: 'BACKGROUND', label: 'Background' },
  { value: 'FRAME', label: 'Frame' },
];

/**
 * Dressing room — live-rendered avatar + per-slot equip from the user's
 * inventory. Tap a slot to see owned items for it; tap an item to equip
 * (or "None" to unequip). "Surprise me" shuffles a random owned look.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, AppBadge, AppButton, AppCard, AppSkeleton, AvatarRenderer, EmptyState, Icon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Dressing room</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <cdf-app-skeleton shape="rect" />
      } @else {
      <div class="stage">
        <cdf-avatar-renderer [config]="avatar()?.config ?? null" [equipped]="equippedSprites()" [size]="180" [showLevelRing]="true" [level]="null" data-testid="dressing-avatar" />
        <div class="stage__actions">
          <cdf-app-button kind="secondary" size="sm" (buttonClick)="surprise()" data-testid="surprise-btn">
            <cdf-icon name="sparkles" size="sm" /> Surprise me
          </cdf-app-button>
          <cdf-app-button kind="ghost" size="sm" [routerLink]="['/shop']">Browse shop</cdf-app-button>
        </div>
      </div>

      <!-- Free customization: skin tone -->
      <h3 class="muted">Skin tone</h3>
      <div class="tones" data-testid="skin-tones">
        @for (t of skinTones; track t.value) {
        <button
          class="tone"
          [class.tone--active]="currentTone() === t.value"
          [attr.data-tone]="t.value"
          (click)="setSkinTone(t.value)"
        >{{ t.emoji }}</button>
        }
      </div>

      <!-- Slot picker -->
      <div class="filters" data-testid="slot-picker">
        @for (s of slots; track s.value) {
        <button class="chip" [class.chip--active]="slot() === s.value" (click)="slot.set(s.value)">{{ s.label }}</button>
        }
      </div>

      <h3 class="muted">{{ slotLabel() }} — owned</h3>
      <div class="grid" data-testid="owned-grid">
        <cdf-app-card padding="normal" class="item" (click)="equip(null)">
          <div class="item__sprite">∅</div>
          <span>None</span>
        </cdf-app-card>
        @for (it of ownedForSlot(); track it.item.id) {
        <cdf-app-card padding="normal" class="item" [class.item--on]="it.equipped" [attr.data-item-id]="it.item.id" (click)="equip(it.item.id)">
          <div class="item__sprite" [style.background]="swatch(it.item.spriteAssetId)">{{ glyph(it.item.spriteAssetId) }}</div>
          <span>{{ it.item.name }}</span>
          @if (it.equipped) { <cdf-app-badge variant="success" [subtle]="true">On</cdf-app-badge> }
        </cdf-app-card>
        }
        @if (ownedForSlot().length === 0) {
        <cdf-empty-state icon="cart" title="Nothing in this slot" description="Buy items in the shop to fill it." />
        }
      </div>
      }
    </ion-content>
  `,
  styles: [
    `
      .stage { display: flex; flex-direction: column; align-items: center; gap: var(--cdf-space-2); margin-bottom: var(--cdf-space-3); }
      .stage__actions { display: flex; gap: var(--cdf-space-2); }
      .muted { color: var(--cdf-color-text-muted); }
      .tones { display: flex; gap: 6px; margin-bottom: var(--cdf-space-2); }
      .tone { font-size: 26px; line-height: 1; border: 2px solid transparent; border-radius: 50%; background: var(--cdf-color-surface-2, #eef1f6); width: 44px; height: 44px; }
      .tone--active { border-color: var(--cdf-color-primary, #5b8def); }
      .filters { display: flex; gap: 6px; overflow-x: auto; padding-bottom: var(--cdf-space-2); }
      .chip { flex: 0 0 auto; border: 1px solid var(--cdf-color-border, #ccc); background: transparent; border-radius: 16px; padding: 4px 12px; font-size: 13px; }
      .chip--active { background: var(--cdf-color-primary, #5b8def); color: #fff; border-color: transparent; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: var(--cdf-space-2); }
      .item { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; }
      .item--on { outline: 2px solid var(--cdf-color-primary, #5b8def); }
      .item__sprite { width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; background: var(--cdf-color-surface-2, #eef1f6); }
    `,
  ],
})
export class AvatarPage {
  private readonly items = inject(ItemsClient);

  protected readonly slots = SLOTS;
  protected readonly skinTones = SKIN_TONES;
  protected readonly loading = signal(true);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly inventory = signal<InventoryItem[]>([]);
  protected readonly slot = signal<ItemSlot>('HAT');

  protected readonly currentTone = computed(() => (this.avatar()?.config?.['skinTone'] as string | undefined) ?? null);

  protected readonly equippedSprites = computed<Partial<Record<AvatarSlot, AvatarSprite>>>(() => {
    const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    const eq = this.avatar()?.equipped ?? {};
    for (const [s, ref] of Object.entries(eq)) {
      if (ref) out[s as AvatarSlot] = { spriteAssetId: ref.spriteAssetId, name: ref.name, rarity: ref.rarity };
    }
    return out;
  });

  protected readonly ownedForSlot = computed(() => this.inventory().filter((i) => i.item.slot === this.slot()));
  protected readonly slotLabel = computed(() => SLOTS.find((s) => s.value === this.slot())?.label ?? '');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [av, inv] = await Promise.all([this.items.avatar(), this.items.inventory()]);
      this.avatar.set(av);
      this.inventory.set(inv);
    } catch {
      /* offline — leave empty */
    } finally {
      this.loading.set(false);
    }
  }

  /** Free customization — persists AvatarConfig and live-updates the renderer. */
  protected async setSkinTone(tone: string): Promise<void> {
    const config = { ...(this.avatar()?.config ?? {}), skinTone: tone };
    // Optimistic local update so the avatar changes instantly.
    this.avatar.update((a) => (a ? { ...a, config } : a));
    try {
      const av = await this.items.saveConfig(config);
      this.avatar.set(av);
    } catch {
      /* surfaced by interceptor; optimistic value stays */
    }
  }

  protected async equip(itemId: string | null): Promise<void> {
    try {
      const av = await this.items.equip(this.slot(), itemId);
      this.avatar.set(av);
      await this.refreshInventory();
    } catch {
      /* surfaced by interceptor */
    }
  }

  /** Shuffle a random owned item (or none) into each slot. */
  protected async surprise(): Promise<void> {
    const bySlot = new Map<ItemSlot, InventoryItem[]>();
    for (const i of this.inventory()) {
      const arr = bySlot.get(i.item.slot) ?? [];
      arr.push(i);
      bySlot.set(i.item.slot, arr);
    }
    for (const [slot, arr] of bySlot) {
      // +1 so "none" is also a possible roll.
      const pick = arr[Math.floor(Math.random() * (arr.length + 1))];
      const av = await this.items.equip(slot, pick ? pick.item.id : null);
      this.avatar.set(av);
    }
    await this.refreshInventory();
  }

  private async refreshInventory(): Promise<void> {
    this.inventory.set(await this.items.inventory());
  }

  protected glyph(token: string): string {
    return token.startsWith('emoji:') ? token.slice(6) : '';
  }
  protected swatch(token: string): string {
    return token.startsWith('color:') ? token.slice(6) : '';
  }
}
