import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { CoinBadge } from '../../atoms/coin-badge/coin-badge.js';
import {
  RARITIES,
  affordability,
  spriteGlyph,
  type Affordability,
  type ItemRarity,
  type ShopItem,
} from './shop-item.js';

/**
 * Shop catalog (docs/08): rarity filter (toggle chips), affordability per
 * tile (owned / premium / level-locked / not enough coins / buy), and a
 * virtualized grid — rows of tiles rendered through CDK virtual scroll, the
 * column count follows the container width.
 *
 *   <cdf-shop-grid [items]="items" [balance]="coins" [level]="level" (buy)="purchase($event)" />
 */
@Component({
  selector: 'cdf-shop-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, AppButton, CoinBadge, TranslatePipe],
  template: `
    <div
      class="cdf-shop__filters"
      role="group"
      [attr.aria-label]="'ui.shop.filterRarity' | translate"
    >
      <button
        type="button"
        class="cdf-shop__filter"
        [attr.aria-pressed]="rarity() === null"
        (click)="rarity.set(null)"
      >
        {{ 'ui.shop.all' | translate }}
      </button>
      @for (r of rarities; track r) {
        <button
          type="button"
          class="cdf-shop__filter"
          [attr.data-rarity]="r"
          [attr.aria-pressed]="rarity() === r"
          (click)="rarity.set(rarity() === r ? null : r)"
        >
          {{ 'ui.item.rarity.' + r | translate }}
        </button>
      }
    </div>

    @if (filtered().length === 0) {
      <p class="cdf-shop__empty" role="status">
        {{ 'ui.shop.empty' | translate }}
      </p>
    } @else {
      <cdk-virtual-scroll-viewport
        class="cdf-shop__viewport"
        [itemSize]="rowHeight()"
        [style.height.px]="height()"
        role="list"
        [attr.aria-label]="
          'ui.shop.items' | translate: { count: filtered().length }
        "
      >
        <div
          *cdkVirtualFor="let row of rows(); trackBy: trackRow"
          class="cdf-shop__row"
          [style.grid-template-columns]="
            'repeat(' + columns() + ', minmax(0, 1fr))'
          "
          [style.height.px]="rowHeight()"
        >
          @for (item of row; track item.id) {
            <div
              class="cdf-shop__tile"
              role="listitem"
              [attr.data-rarity]="item.rarity"
              [attr.data-state]="stateOf(item)"
            >
              <button
                type="button"
                class="cdf-shop__art"
                [attr.aria-label]="
                  'ui.shop.preview' | translate: { name: item.name }
                "
                (click)="preview.emit(item)"
              >
                @if (glyph(item).kind === 'emoji') {
                  <span class="cdf-shop__glyph" aria-hidden="true">{{
                    glyph(item).value
                  }}</span>
                } @else {
                  <span
                    class="cdf-shop__swatch"
                    aria-hidden="true"
                    [style.background]="glyph(item).value"
                  ></span>
                }
              </button>
              <h3 class="cdf-shop__name">{{ item.name }}</h3>
              <span class="cdf-shop__rarity">{{
                'ui.item.rarity.' + item.rarity | translate
              }}</span>
              @switch (stateOf(item)) {
                @case ('owned') {
                  <span class="cdf-shop__status">{{
                    'ui.shop.owned' | translate
                  }}</span>
                }
                @case ('premium') {
                  <span class="cdf-shop__status">{{
                    'billing.premiumOnly' | translate
                  }}</span>
                }
                @case ('level') {
                  <span class="cdf-shop__status">{{
                    'ui.shop.needsLevel'
                      | translate: { level: item.requiredLevel }
                  }}</span>
                }
                @default {
                  <cdf-coin-badge [value]="item.costCoins" size="sm" />
                  <cdf-app-button
                    size="sm"
                    [kind]="stateOf(item) === 'ok' ? 'primary' : 'secondary'"
                    [disabled]="stateOf(item) !== 'ok'"
                    [ariaLabel]="
                      'ui.shop.buyNamed'
                        | translate: { name: item.name, cost: item.costCoins }
                    "
                    (buttonClick)="buy.emit(item)"
                  >
                    {{
                      (stateOf(item) === 'ok'
                        ? 'ui.shop.buy'
                        : 'ui.shop.notEnough'
                      ) | translate: { count: item.costCoins - balance() }
                    }}
                  </cdf-app-button>
                }
              }
            </div>
          }
        </div>
      </cdk-virtual-scroll-viewport>
    }
  `,
  styleUrl: './shop-grid.scss',
})
export class ShopGrid {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly items = input.required<ShopItem[]>();
  readonly balance = input(0);
  readonly level = input(1);
  readonly isPremium = input(false);
  readonly height = input(560);
  readonly rowHeight = input(232);
  /** Minimum tile width used to derive the column count. */
  readonly minTileWidth = input(160);

  readonly buy = output<ShopItem>();
  readonly preview = output<ShopItem>();

  protected readonly rarities = RARITIES;
  protected readonly rarity = signal<ItemRarity | null>(null);
  protected readonly width = signal(640);

  protected readonly columns = computed(() =>
    Math.max(1, Math.floor(this.width() / this.minTileWidth())),
  );
  protected readonly filtered = computed(() => {
    const r = this.rarity();
    return r ? this.items().filter((i) => i.rarity === r) : this.items();
  });
  protected readonly rows = computed(() => {
    const cols = this.columns();
    const list = this.filtered();
    const out: ShopItem[][] = [];
    for (let i = 0; i < list.length; i += cols)
      out.push(list.slice(i, i + cols));
    return out;
  });

  protected readonly trackRow = (i: number, row: ShopItem[]) =>
    `${i}:${row[0]?.id ?? ''}`;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      this.width.set(el.clientWidth || 640);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w) this.width.set(w);
      });
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected stateOf(item: ShopItem): Affordability {
    return affordability(item, {
      balance: this.balance(),
      level: this.level(),
      isPremium: this.isPremium(),
    });
  }

  protected glyph(item: ShopItem) {
    return spriteGlyph(item.spriteAssetId);
  }
}
