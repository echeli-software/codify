import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  GamificationClient,
  ItemsClient,
  type AvatarResponse,
  type ItemSlot,
  type ShopItem,
} from '@codify/api-client';

const SLOT_FILTERS: { value: ItemSlot | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'HAT', label: 'Hats' },
  { value: 'GLASSES', label: 'Glasses' },
  { value: 'TOP', label: 'Tops' },
  { value: 'PET', label: 'Pets' },
  { value: 'BACKGROUND', label: 'Backgrounds' },
  { value: 'FRAME', label: 'Frames' },
];

const REASON_LABEL: Record<string, string> = {
  owned: 'Owned',
  insufficient_coins: 'Not enough coins',
  level_locked: 'Level locked',
  premium_required: 'Premium only',
  not_available: 'Unavailable',
};

/**
 * Shop — browse cosmetics, try them on against the live avatar, and buy with
 * coins. Eligibility comes from the server (the same @codify/domain rule the
 * API enforces), so the Buy button never lies.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, AppBadge, AppButton, AppCard, AppSkeleton, AvatarRenderer, EmptyState, Icon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Shop</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="coins" data-testid="coin-balance">
        <cdf-icon name="diamond" size="sm" /> {{ coins() }} coins
      </div>

      <!-- Try-on preview -->
      <div class="preview">
        <cdf-avatar-renderer [config]="avatar()?.config ?? null" [equipped]="previewEquipped()" [size]="140" />
        @if (tryOn(); as t) {
        <p class="muted">Trying on: <strong>{{ t.name }}</strong></p>
        }
      </div>

      <!-- Slot filters -->
      <div class="filters" data-testid="slot-filters">
        @for (f of slotFilters; track f.value) {
        <button class="chip" [class.chip--active]="slot() === f.value" (click)="setSlot(f.value)">{{ f.label }}</button>
        }
        <button class="chip" [class.chip--active]="affordableOnly()" (click)="toggleAffordable()">Can buy</button>
      </div>

      @if (loading()) {
      <cdf-app-skeleton shape="rect" />
      } @else if (items().length === 0) {
      <cdf-empty-state icon="cart" title="Nothing here yet" description="Check back as new items drop." />
      } @else {
      <div class="grid" data-testid="shop-grid">
        @for (it of items(); track it.id) {
        <cdf-app-card padding="normal" class="item" [attr.data-item-id]="it.id" (click)="setTryOn(it)">
          <div class="item__sprite" [style.background]="swatch(it)">{{ glyph(it) }}</div>
          <h3>{{ it.name }}</h3>
          <cdf-app-badge [variant]="rarityVariant(it.rarity)" [subtle]="true">{{ it.rarity }}</cdf-app-badge>
          <div class="item__cost"><cdf-icon name="diamond" size="xs" /> {{ it.costCoins }}</div>
          @if (it.owned) {
          <cdf-app-badge variant="success" [subtle]="true">Owned</cdf-app-badge>
          } @else if (it.canBuy) {
          <cdf-app-button kind="primary" size="sm" [fullWidth]="true" [loading]="buyingId() === it.id" (buttonClick)="buy(it, $event)" [attr.data-testid]="'buy-btn'">
            Buy
          </cdf-app-button>
          } @else {
          <span class="item__locked">{{ reasonLabel(it.reason) }}</span>
          }
        </cdf-app-card>
        }
      </div>
      }
    </ion-content>
  `,
  styles: [
    `
      .coins { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: var(--cdf-space-2); }
      .preview { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: var(--cdf-space-3); }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; margin: 0; }
      .filters { display: flex; gap: 6px; overflow-x: auto; padding-bottom: var(--cdf-space-2); margin-bottom: var(--cdf-space-2); }
      .chip { flex: 0 0 auto; border: 1px solid var(--cdf-color-border, #ccc); background: transparent; border-radius: 16px; padding: 4px 12px; font-size: 13px; }
      .chip--active { background: var(--cdf-color-primary, #5b8def); color: #fff; border-color: transparent; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--cdf-space-2); }
      .item { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .item h3 { margin: 2px 0 0; font-size: 14px; }
      .item__sprite { width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; background: var(--cdf-color-surface-2, #eef1f6); }
      .item__cost { display: flex; align-items: center; gap: 4px; font-weight: 600; }
      .item__locked { font-size: 12px; color: var(--cdf-color-text-muted); }
    `,
  ],
})
export class ShopPage {
  private readonly items_ = inject(ItemsClient);
  private readonly gamification = inject(GamificationClient);

  protected readonly slotFilters = SLOT_FILTERS;
  protected readonly loading = signal(true);
  protected readonly items = signal<ShopItem[]>([]);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly coins = signal(0);
  protected readonly slot = signal<ItemSlot | 'ALL'>('ALL');
  protected readonly affordableOnly = signal(false);
  protected readonly buyingId = signal<string | null>(null);
  protected readonly tryOn = signal<ShopItem | null>(null);

  /** Equipped map with the try-on item overlaid into its slot. */
  protected readonly previewEquipped = computed<Partial<Record<AvatarSlot, AvatarSprite>>>(() => {
    const base: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    const eq = this.avatar()?.equipped ?? {};
    for (const [s, ref] of Object.entries(eq)) {
      if (ref) base[s as AvatarSlot] = { spriteAssetId: ref.spriteAssetId, name: ref.name, rarity: ref.rarity };
    }
    const t = this.tryOn();
    if (t) base[t.slot as AvatarSlot] = { spriteAssetId: t.spriteAssetId, name: t.name, rarity: t.rarity };
    return base;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [shop, av, summary] = await Promise.all([
        this.items_.shop(this.queryArgs()),
        this.items_.avatar().catch(() => null),
        this.gamification.summary().catch(() => null),
      ]);
      this.items.set(shop);
      if (av) this.avatar.set(av);
      if (summary) this.coins.set(summary.coins);
    } finally {
      this.loading.set(false);
    }
  }

  private queryArgs() {
    return {
      slot: this.slot() === 'ALL' ? undefined : (this.slot() as ItemSlot),
      affordableOnly: this.affordableOnly() || undefined,
    };
  }

  protected setSlot(s: ItemSlot | 'ALL'): void {
    this.slot.set(s);
    void this.refreshShop();
  }
  protected toggleAffordable(): void {
    this.affordableOnly.update((v) => !v);
    void this.refreshShop();
  }
  private async refreshShop(): Promise<void> {
    this.items.set(await this.items_.shop(this.queryArgs()));
  }

  protected setTryOn(it: ShopItem): void {
    this.tryOn.set(it);
  }

  protected async buy(it: ShopItem, ev: MouseEvent): Promise<void> {
    ev.stopPropagation();
    this.buyingId.set(it.id);
    try {
      const res = await this.items_.purchase(it.id);
      this.coins.set(res.coins);
      // Refresh shop (owned flags) + avatar; keep try-on showing the bought item.
      const [shop, av] = await Promise.all([this.items_.shop(this.queryArgs()), this.items_.avatar()]);
      this.items.set(shop);
      this.avatar.set(av);
    } catch {
      /* surfaced by the global toast interceptor */
    } finally {
      this.buyingId.set(null);
    }
  }

  protected glyph(it: { spriteAssetId: string }): string {
    return it.spriteAssetId.startsWith('emoji:') ? it.spriteAssetId.slice(6) : '';
  }
  protected swatch(it: { spriteAssetId: string }): string {
    return it.spriteAssetId.startsWith('color:') ? it.spriteAssetId.slice(6) : '';
  }
  protected reasonLabel(reason: string): string {
    return REASON_LABEL[reason] ?? 'Unavailable';
  }
  protected rarityVariant(r: string): 'neutral' | 'info' | 'success' | 'warning' {
    if (r === 'LEGENDARY' || r === 'EPIC') return 'warning';
    if (r === 'RARE') return 'info';
    if (r === 'UNCOMMON') return 'success';
    return 'neutral';
  }
}
