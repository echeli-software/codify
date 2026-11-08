import { ItemSprite } from '../../atoms/item-sprite/item-sprite.js';
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import type { AvatarSlot } from '../../molecules/avatar-renderer/avatar-renderer.js';
import {
  RARITIES,
  SLOT_ORDER,
  type ItemRarity,
  type ShopItem,
} from '../shop-grid/shop-item.js';

let inventorySeq = 0;

export interface InventoryGroup {
  slot: AvatarSlot;
  items: ShopItem[];
}

/** Owned items grouped by slot in display order (empty slots dropped). */
export function groupBySlot(items: readonly ShopItem[]): InventoryGroup[] {
  return SLOT_ORDER.map((slot) => ({
    slot,
    items: items.filter((i) => i.slot === slot),
  })).filter((g) => g.items.length > 0);
}

/** Items matching a rarity (null = any) and a case-insensitive name query. */
export function filterInventory(
  items: readonly ShopItem[],
  opts: { rarity?: ItemRarity | null; query?: string },
): ShopItem[] {
  const q = (opts.query ?? '').trim().toLocaleLowerCase();
  return items.filter(
    (i) =>
      (!opts.rarity || i.rarity === opts.rarity) &&
      (!q || i.name.toLocaleLowerCase().includes(q)),
  );
}

/**
 * The user's owned items grouped by slot (docs/08 §8), with equip /
 * unequip toggles (`aria-pressed`), a rarity filter and name search, and —
 * with `bulk` — a multi-select mode that equips one chosen item per slot
 * in one go (`bulkEquip`). One item per slot can be equipped; the server
 * enforces it, the UI just emits intents.
 *
 *   <cdf-inventory [items]="owned" [bulk]="true" (equip)="equip($event)"
 *     (unequip)="unequip($event)" (bulkEquip)="equipAll($event)" />
 */
@Component({
  selector: 'cdf-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ItemSprite, TranslatePipe],
  template: `
    @if (filterable() && items().length > 0) {
      <div class="cdf-inv__toolbar" role="search">
        <div class="cdf-inv__field">
          <label [for]="uid + '-q'">{{
            'ui.inventory.search' | translate
          }}</label>
          <input
            [id]="uid + '-q'"
            type="search"
            class="cdf-inv__input"
            data-testid="inventory-search"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </div>
        <div class="cdf-inv__field">
          <label [for]="uid + '-r'">{{
            'ui.inventory.rarity' | translate
          }}</label>
          <select
            [id]="uid + '-r'"
            class="cdf-inv__input"
            data-testid="inventory-rarity"
            (change)="setRarity($any($event.target).value)"
          >
            <option value="" [selected]="!rarity()">
              {{ 'ui.inventory.anyRarity' | translate }}
            </option>
            @for (r of rarities; track r) {
              <option [value]="r" [selected]="rarity() === r">
                {{ 'ui.item.rarity.' + r | translate }}
              </option>
            }
          </select>
        </div>
        @if (bulk()) {
          <button
            type="button"
            class="cdf-inv__mode"
            data-testid="inventory-select-mode"
            [attr.aria-pressed]="selecting()"
            (click)="toggleSelecting()"
          >
            {{ 'ui.inventory.selectMany' | translate }}
          </button>
        }
      </div>
    }

    @if (selecting()) {
      <div class="cdf-inv__bulkbar" role="status" aria-live="polite">
        <span>{{
          'ui.inventory.selected' | translate: { count: selectedItems().length }
        }}</span>
        <button
          type="button"
          class="cdf-inv__bulk-btn"
          data-testid="inventory-bulk-equip"
          [disabled]="selectedItems().length === 0 || !!busyId()"
          (click)="applyBulk()"
        >
          {{ 'ui.inventory.equipSelected' | translate }}
        </button>
      </div>
    }

    @for (group of groups(); track group.slot) {
      <section
        class="cdf-inv__group"
        [attr.aria-labelledby]="headingId(group.slot)"
      >
        <h3 class="cdf-inv__slot" [id]="headingId(group.slot)">
          {{ 'ui.item.slot.' + group.slot | translate }}
          <span class="cdf-inv__count">({{ group.items.length }})</span>
        </h3>
        <ul class="cdf-inv__list">
          @for (item of group.items; track item.id) {
            <li>
              @if (selecting()) {
                <button
                  type="button"
                  role="checkbox"
                  class="cdf-inv__item"
                  [attr.data-rarity]="item.rarity"
                  [attr.aria-checked]="isSelected(item)"
                  [attr.data-item-id]="item.id"
                  (click)="toggleSelect(item)"
                >
                  <cdf-item-sprite
                    [token]="item.spriteAssetId"
                    [url]="item.spriteUrl"
                    [rarity]="item.rarity"
                    [size]="36"
                  />
                  <span class="cdf-inv__name">{{ item.name }}</span>
                  <span class="cdf-inv__state">
                    {{
                      (isSelected(item)
                        ? 'ui.inventory.chosen'
                        : 'ui.inventory.choose'
                      ) | translate
                    }}
                  </span>
                </button>
              } @else {
                <button
                  type="button"
                  class="cdf-inv__item"
                  [attr.data-rarity]="item.rarity"
                  [attr.aria-pressed]="!!item.equipped"
                  [attr.data-item-id]="item.id"
                  [disabled]="busyId() === item.id"
                  (click)="
                    item.equipped ? unequip.emit(item) : equip.emit(item)
                  "
                >
                  <cdf-item-sprite
                    [token]="item.spriteAssetId"
                    [url]="item.spriteUrl"
                    [rarity]="item.rarity"
                    [size]="36"
                  />
                  <span class="cdf-inv__name">{{ item.name }}</span>
                  <span class="cdf-inv__state">
                    {{
                      (item.equipped
                        ? 'ui.inventory.equipped'
                        : 'ui.inventory.equip'
                      ) | translate
                    }}
                  </span>
                </button>
              }
            </li>
          }
        </ul>
      </section>
    } @empty {
      <p class="cdf-inv__empty">
        {{
          (items().length ? 'ui.inventory.noMatch' : 'ui.inventory.empty')
            | translate
        }}
      </p>
    }
  `,
  styleUrl: './inventory.scss',
})
export class Inventory {
  readonly items = input.required<ShopItem[]>();
  /** Item currently being saved (disables its toggle). */
  readonly busyId = input<string | null>(null);
  /** Show the rarity filter + name search. */
  readonly filterable = input(true);
  /** Offer multi-select bulk equip. */
  readonly bulk = input(false);

  readonly equip = output<ShopItem>();
  readonly unequip = output<ShopItem>();
  /** Bulk equip: at most one item per slot. */
  readonly bulkEquip = output<ShopItem[]>();

  protected readonly uid = `cdf-inv-${++inventorySeq}`;
  protected readonly rarities = RARITIES;
  protected readonly query = signal('');
  protected readonly rarity = signal<ItemRarity | null>(null);
  protected readonly selecting = signal(false);
  /** slot → selected item id. */
  private readonly selection = signal<Partial<Record<AvatarSlot, string>>>({});

  protected readonly groups = computed(() =>
    groupBySlot(
      filterInventory(this.items(), {
        rarity: this.rarity(),
        query: this.query(),
      }),
    ),
  );
  protected readonly selectedItems = computed(() => {
    const sel = this.selection();
    return this.items().filter((i) => sel[i.slot] === i.id);
  });

  protected headingId(slot: AvatarSlot): string {
    return `${this.uid}-${slot}`;
  }

  protected setRarity(v: string): void {
    this.rarity.set(
      (RARITIES as readonly string[]).includes(v) ? (v as ItemRarity) : null,
    );
  }

  protected toggleSelecting(): void {
    this.selecting.update((v) => !v);
    this.selection.set({});
  }

  protected isSelected(item: ShopItem): boolean {
    return this.selection()[item.slot] === item.id;
  }

  /** One per slot: choosing another item in a slot replaces the choice. */
  protected toggleSelect(item: ShopItem): void {
    this.selection.update((s) => {
      const next = { ...s };
      if (next[item.slot] === item.id) delete next[item.slot];
      else next[item.slot] = item.id;
      return next;
    });
  }

  protected applyBulk(): void {
    const chosen = this.selectedItems();
    if (chosen.length === 0) return;
    this.bulkEquip.emit(chosen);
    this.selecting.set(false);
    this.selection.set({});
  }
}
