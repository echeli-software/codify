import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppSkeleton,
  AvatarRenderer,
  BottomSheet,
  CoinCounter,
  EmptyState,
  Icon,
  ShopGrid,
  type ShopItem as UiShopItem,
} from '@codify/ui-ionic';
import {
  BillingClient,
  GamificationClient,
  ItemsClient,
  ProblemDetailsError,
  type AvatarResponse,
  type ItemSlot,
  type ShopItem,
} from '@codify/api-client';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AppToastService } from '../platform/app-toast.service.js';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { equippedSprites, toUiItem } from './shared/avatar.js';
import { formatCountdown } from './shared/countdown.js';
import { StaleGuard } from './shared/stale-guard.js';

const SLOT_FILTERS: (ItemSlot | null)[] = [
  null,
  'HAT',
  'HAIR',
  'GLASSES',
  'TOP',
  'BOTTOM',
  'SHOES',
  'ACCESSORY',
  'PET',
  'BACKGROUND',
  'FRAME',
];

const REASON_KEYS: Record<string, string> = {
  owned: 'ui.shop.owned',
  insufficient_coins: 'student.shop.reason.coins',
  level_locked: 'student.shop.reason.level',
  premium_required: 'billing.premiumOnly',
  not_available: 'student.shop.reason.unavailable',
};

/**
 * Shop (docs/08): limited drops pinned with a countdown, slot filters
 * (aria-pressed chips) and the virtualized `ShopGrid`. Tapping an item
 * opens its detail sheet with a live try-on, "Try on in the dressing
 * room", and Buy / Buy & wear (`{ equip: true }`, atomic server-side).
 * Every API error is surfaced; online-only.
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
    AppSkeleton,
    AvatarRenderer,
    BottomSheet,
    CoinCounter,
    EmptyState,
    Icon,
    ShopGrid,
    OfflineGate,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.shop.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="sh">
        <cdf-offline-gate capability="shop">
          <div class="sh__top">
            <div class="sh__balance" data-testid="coin-balance">
              <span class="sh__label">{{
                'student.shop.balance' | translate
              }}</span>
              <cdf-coin-counter [value]="coins()" size="md" />
            </div>
            <a routerLink="/avatar" class="sh__link">{{
              'student.shop.dressingRoom' | translate
            }}</a>
          </div>

          <div
            class="sh__filters"
            role="group"
            [attr.aria-label]="'student.shop.filterSlot' | translate"
            data-testid="slot-filters"
          >
            @for (s of slotFilters; track s ?? 'all') {
              <button
                type="button"
                class="sh__chip"
                [attr.aria-pressed]="slot() === s"
                (click)="setSlot(s)"
              >
                {{ (s ? 'ui.item.slot.' + s : 'ui.shop.all') | translate }}
              </button>
            }
            <button
              type="button"
              class="sh__chip"
              [attr.aria-pressed]="affordableOnly()"
              (click)="toggleAffordable()"
              data-testid="affordable-filter"
            >
              {{ 'student.shop.canAfford' | translate }}
            </button>
          </div>

          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="320" />
          } @else if (items().length === 0) {
            <cdf-empty-state
              icon="cart"
              [title]="'student.shop.emptyTitle' | translate"
              [description]="'student.shop.emptyBody' | translate"
            />
          } @else {
            @if (limited().length > 0) {
              <section
                class="sh__limited"
                aria-labelledby="sh-limited"
                data-testid="limited-section"
              >
                <h2 id="sh-limited">
                  <cdf-icon name="flame" size="sm" />
                  {{ 'student.shop.limitedTitle' | translate }}
                  @if (countdown(); as c) {
                    <span class="sh__count" data-testid="limited-countdown">{{
                      'student.shop.endsIn' | translate: { time: c }
                    }}</span>
                  }
                </h2>
                <cdf-shop-grid
                  [items]="limitedUi()"
                  [balance]="coins()"
                  [level]="level()"
                  [isPremium]="isPremium()"
                  [height]="260"
                  (buy)="open($event)"
                  (preview)="open($event)"
                />
              </section>
            }
            <section aria-labelledby="sh-all">
              <h2 id="sh-all" class="sh__sr">
                {{ 'student.shop.allItems' | translate }}
              </h2>
              <cdf-shop-grid
                data-testid="shop-grid"
                [items]="regularUi()"
                [balance]="coins()"
                [level]="level()"
                [isPremium]="isPremium()"
                (buy)="open($event)"
                (preview)="open($event)"
              />
            </section>
          }
        </cdf-offline-gate>
      </div>

      @if (selected(); as it) {
        <cdf-bottom-sheet
          [open]="sheetOpen()"
          (openChange)="sheetOpen.set($event)"
          [title]="it.name"
        >
          <div
            class="sh__detail"
            data-testid="item-sheet"
            [attr.data-item-id]="it.id"
          >
            <cdf-avatar-renderer
              [config]="avatar()?.config ?? null"
              [equipped]="previewSprites()"
              [size]="160"
            />
            <p class="sh__muted">{{ 'student.shop.tryingOn' | translate }}</p>
            @if (it.description) {
              <p>{{ it.description }}</p>
            }
            <p class="sh__meta">
              {{ 'ui.item.rarity.' + it.rarity | translate }} ·
              {{ 'ui.item.slot.' + it.slot | translate }} ·
              {{ 'ui.item.cost' | translate: { value: it.costCoins } }}
            </p>
            @if (!it.canBuy && !it.owned) {
              <p class="sh__warn" role="note">
                {{
                  reasonKey(it.reason) | translate: { level: it.requiredLevel }
                }}
              </p>
            }
          </div>
          <div sheetFooter class="sh__actions">
            <cdf-app-button
              kind="ghost"
              (buttonClick)="tryInDressingRoom(it)"
              data-testid="try-on-room"
            >
              {{ 'student.shop.tryInRoom' | translate }}
            </cdf-app-button>
            @if (it.owned) {
              <cdf-app-button
                kind="secondary"
                (buttonClick)="equip(it)"
                data-testid="equip-owned"
              >
                {{ 'student.shop.wear' | translate }}
              </cdf-app-button>
            } @else {
              <cdf-app-button
                kind="secondary"
                [disabled]="!it.canBuy"
                [loading]="buying() === 'plain'"
                (buttonClick)="buy(it, false)"
                data-testid="buy-btn"
              >
                {{ 'student.shop.buy' | translate: { cost: it.costCoins } }}
              </cdf-app-button>
              <cdf-app-button
                kind="primary"
                [disabled]="!it.canBuy"
                [loading]="buying() === 'equip'"
                (buttonClick)="buy(it, true)"
                data-testid="buy-equip-btn"
              >
                {{ 'student.shop.buyAndWear' | translate }}
              </cdf-app-button>
            }
          </div>
        </cdf-bottom-sheet>
      }
    </ion-content>
  `,
  styles: [
    `
      .sh {
        max-width: 1280px;
        margin: 0 auto;
      }
      .sh__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .sh__balance {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .sh__label,
      .sh__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .sh__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
      }
      .sh__filters {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .sh__chip {
        flex: 0 0 auto;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border-radius: 999px;
        padding: 6px 14px;
        font: inherit;
        font-size: var(--cdf-font-size-sm);
        cursor: pointer;
        min-height: 36px;
      }
      .sh__chip[aria-pressed='true'] {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-on-primary, #fff);
        border-color: transparent;
      }
      .sh__chip:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .sh__limited {
        border: 1px solid var(--cdf-color-warning);
        border-radius: 14px;
        padding: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .sh__limited h2 {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .sh__count {
        color: var(--cdf-color-text-muted);
        font-weight: 500;
        font-size: var(--cdf-font-size-sm);
      }
      .sh__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .sh__detail {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 4px;
      }
      .sh__meta {
        font-weight: 600;
      }
      .sh__warn {
        color: var(--cdf-color-warning);
      }
      .sh__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        justify-content: flex-end;
      }
    `,
  ],
})
export class ShopPage {
  private readonly itemsClient = inject(ItemsClient);
  private readonly gamification = inject(GamificationClient);
  private readonly billing = inject(BillingClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly router = inject(Router);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);
  private readonly guard = new StaleGuard();

  protected readonly slotFilters = SLOT_FILTERS;
  protected readonly loading = signal(true);
  protected readonly items = signal<ShopItem[]>([]);
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly coins = signal(0);
  protected readonly level = signal(1);
  protected readonly isPremium = signal(false);
  protected readonly slot = signal<ItemSlot | null>(null);
  protected readonly affordableOnly = signal(false);
  protected readonly selected = signal<ShopItem | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly buying = signal<'plain' | 'equip' | null>(null);
  protected readonly now = signal(Date.now());

  protected readonly limited = computed(() =>
    this.items().filter((i) => i.isLimitedDrop),
  );
  protected readonly limitedUi = computed(() =>
    this.limited().map((i) => toUiItem(i, { owned: i.owned })),
  );
  protected readonly regularUi = computed(() =>
    this.items()
      .filter((i) => !i.isLimitedDrop)
      .map((i) => toUiItem(i, { owned: i.owned })),
  );
  protected readonly previewSprites = computed(() =>
    equippedSprites(this.avatar(), this.selected()),
  );
  protected readonly countdown = computed(() => {
    const ends = this.limited()
      .map((i) => (i.dropEndsAt ? new Date(i.dropEndsAt).getTime() : null))
      .filter((t): t is number => t != null);
    this.i18n.currentLocale();
    if (ends.length === 0) return null;
    return formatCountdown(
      Math.min(...ends) - this.now(),
      (k, p) => this.i18n.t(k, p),
      true,
    );
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.guard.cancel();
    });
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const [, av, summary, mine] = await Promise.allSettled([
      this.loadItems(),
      this.itemsClient.avatar(),
      this.gamification.summary(),
      this.billing.mySubscription(),
    ]);
    if (av.status === 'fulfilled') this.avatar.set(av.value);
    if (summary.status === 'fulfilled') {
      this.coins.set(summary.value.coins);
      this.level.set(summary.value.level);
    }
    if (mine.status === 'fulfilled')
      this.isPremium.set(mine.value.activePlanIds.length > 0);
    this.loading.set(false);
    this.telemetry.track('shop_view');
  }

  /** Filter-driven loads go through a StaleGuard (latest filter wins). */
  private async loadItems(): Promise<void> {
    const res = await this.guard.run(() =>
      this.itemsClient.shop({
        slot: this.slot() ?? undefined,
        affordableOnly: this.affordableOnly() || undefined,
      }),
    );
    if (res.stale) return;
    if (res.ok) this.items.set(res.value);
    else this.toast.error(res.error);
  }

  protected setSlot(s: ItemSlot | null): void {
    if (this.slot() === s) return;
    this.slot.set(s);
    void this.loadItems();
  }

  protected toggleAffordable(): void {
    this.affordableOnly.update((v) => !v);
    void this.loadItems();
  }

  protected open(ui: UiShopItem): void {
    const it = this.items().find((i) => i.id === ui.id) ?? null;
    this.selected.set(it);
    this.sheetOpen.set(!!it);
  }

  protected reasonKey(reason: string): string {
    return REASON_KEYS[reason] ?? 'student.shop.reason.unavailable';
  }

  protected tryInDressingRoom(it: ShopItem): void {
    this.sheetOpen.set(false);
    void this.router.navigate(['/avatar'], { queryParams: { tryOn: it.id } });
  }

  protected async buy(it: ShopItem, equip: boolean): Promise<void> {
    if (this.buying()) return;
    this.buying.set(equip ? 'equip' : 'plain');
    try {
      const res = await this.itemsClient.purchase(it.id, { equip });
      // Coin debit: snap the engine counters to the server's balance.
      this.orchestrator.reconcile({ coins: res.coins });
      this.coins.set(res.coins);
      this.telemetry.track('item_purchase', {
        itemId: it.id,
        rarity: it.rarity,
        costCoins: it.costCoins,
        equipOnPurchase: equip,
      });
      if (res.equipped) this.telemetry.track('item_equip', { itemId: it.id });
      this.sheetOpen.set(false);
      this.toast.show({
        message: res.equipped
          ? 'student.shop.boughtAndWearing'
          : 'student.shop.bought',
        kind: 'success',
        params: { name: it.name },
        ...(res.equipped
          ? {}
          : {
              action: {
                label: 'student.shop.wear',
                handler: () => void this.equip(it),
              },
            }),
      });
      const [, av] = await Promise.all([
        this.loadItems(),
        this.itemsClient.avatar(),
      ]);
      this.avatar.set(av);
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 409) {
        this.toast.show({
          message: 'student.shop.alreadyOwned',
          kind: 'info',
          params: { name: it.name },
        });
        void this.loadItems();
      } else {
        this.toast.error(err);
      }
    } finally {
      this.buying.set(null);
    }
  }

  protected async equip(it: ShopItem): Promise<void> {
    try {
      this.avatar.set(await this.itemsClient.equip(it.slot, it.id));
      this.telemetry.track('item_equip', { itemId: it.id });
      this.sheetOpen.set(false);
      this.toast.show({
        message: 'student.shop.wearing',
        kind: 'success',
        params: { name: it.name },
      });
    } catch (err) {
      this.toast.error(err);
    }
  }
}
