import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import type { AvatarSlot } from '../../molecules/avatar-renderer/avatar-renderer.js';
import {
  SLOT_ORDER,
  spriteGlyph,
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

/**
 * The user's owned items grouped by slot, with equip / unequip toggles
 * (`aria-pressed`). One item per slot can be equipped — the server
 * enforces it; the UI just emits intents.
 *
 *   <cdf-inventory [items]="owned" (equip)="equip($event)" (unequip)="unequip($event)" />
 */
@Component({
  selector: 'cdf-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
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
              <button
                type="button"
                class="cdf-inv__item"
                [attr.data-rarity]="item.rarity"
                [attr.aria-pressed]="!!item.equipped"
                [disabled]="busyId() === item.id"
                (click)="item.equipped ? unequip.emit(item) : equip.emit(item)"
              >
                @if (glyph(item).kind === 'emoji') {
                  <span class="cdf-inv__glyph" aria-hidden="true">{{
                    glyph(item).value
                  }}</span>
                } @else {
                  <span
                    class="cdf-inv__swatch"
                    aria-hidden="true"
                    [style.background]="glyph(item).value"
                  ></span>
                }
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
            </li>
          }
        </ul>
      </section>
    } @empty {
      <p class="cdf-inv__empty">{{ 'ui.inventory.empty' | translate }}</p>
    }
  `,
  styleUrl: './inventory.scss',
})
export class Inventory {
  readonly items = input.required<ShopItem[]>();
  /** Item currently being saved (disables its toggle). */
  readonly busyId = input<string | null>(null);

  readonly equip = output<ShopItem>();
  readonly unequip = output<ShopItem>();

  private readonly uid = `cdf-inv-${++inventorySeq}`;
  protected readonly groups = computed(() => groupBySlot(this.items()));

  protected headingId(slot: AvatarSlot): string {
    return `${this.uid}-${slot}`;
  }

  protected glyph(item: ShopItem) {
    return spriteGlyph(item.spriteAssetId);
  }
}
