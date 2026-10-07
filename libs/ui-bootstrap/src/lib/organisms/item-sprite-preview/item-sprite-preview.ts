import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  AvatarRenderer,
  type AvatarConfigLike,
  type AvatarSlot,
  type AvatarSprite,
} from '@codify/ui-ionic/avatar-renderer';
import { Badge, type BadgeVariant } from '../../atoms/badge/badge.js';

export type ItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

/** The parts of an `Item` the preview needs (admin form state or API row). */
export interface PreviewItem {
  name: string;
  slot: AvatarSlot;
  rarity?: ItemRarity;
  /** Placeholder token ("emoji:🎩" / "color:#hex") — docs/08 §3. */
  spriteAssetId: string;
  costCoins?: number;
  requiredLevel?: number;
  isPremiumOnly?: boolean;
}

const RARITY_VARIANT: Record<ItemRarity, BadgeVariant> = {
  COMMON: 'neutral',
  UNCOMMON: 'success',
  RARE: 'info',
  EPIC: 'primary',
  LEGENDARY: 'premium',
};

/**
 * Admin preview of an `Item` rendered over the avatar canvas — the same
 * `AvatarRenderer` the student app uses (single source of truth, docs/03
 * "Truly shared visuals"), so what the author sees is what students see.
 * Toggle between "on a sample avatar" and "item only".
 *
 *   <cdf-item-sprite-preview [item]="form.value" [baseEquipped]="sampleOutfit" />
 */
@Component({
  selector: 'cdf-item-sprite-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarRenderer, Badge, TranslatePipe],
  template: `
    <figure class="cdf-item-preview">
      <div class="cdf-item-preview__stage" [style.--stage-size.px]="size()">
        <cdf-avatar-renderer
          [config]="config()"
          [equipped]="equipped()"
          [size]="size()"
        />
      </div>
      <figcaption class="cdf-item-preview__caption">
        <strong class="cdf-item-preview__name">{{
          item().name || ('ui.item.untitled' | translate)
        }}</strong>
        <span class="cdf-item-preview__meta">
          {{ 'ui.item.slot.' + item().slot | translate }}
          @if (item().rarity; as r) {
            <cdf-badge [variant]="rarityVariant(r)" [subtle]="true">{{
              'ui.item.rarity.' + r | translate
            }}</cdf-badge>
          }
          @if (item().isPremiumOnly) {
            <cdf-badge variant="premium">{{
              'billing.premiumOnly' | translate
            }}</cdf-badge>
          }
        </span>
        @if (
          item().costCoins !== undefined || item().requiredLevel !== undefined
        ) {
          <span class="cdf-item-preview__meta">
            @if (item().costCoins !== undefined) {
              {{ 'ui.item.cost' | translate: { value: item().costCoins } }}
            }
            @if (item().requiredLevel !== undefined) {
              ·
              {{
                'gamification.level.label'
                  | translate: { level: item().requiredLevel }
              }}
            }
          </span>
        }
      </figcaption>
      <div
        class="cdf-item-preview__toggle"
        role="group"
        [attr.aria-label]="'ui.item.previewMode' | translate"
      >
        <button
          type="button"
          [attr.aria-pressed]="onAvatar()"
          (click)="onAvatar.set(true)"
        >
          {{ 'ui.item.onAvatar' | translate }}
        </button>
        <button
          type="button"
          [attr.aria-pressed]="!onAvatar()"
          (click)="onAvatar.set(false)"
        >
          {{ 'ui.item.itemOnly' | translate }}
        </button>
      </div>
    </figure>
  `,
  styleUrl: './item-sprite-preview.scss',
})
export class ItemSpritePreview {
  readonly item = input.required<PreviewItem>();
  /** Other equipped items for context (the previewed slot is overridden). */
  readonly baseEquipped = input<Partial<Record<AvatarSlot, AvatarSprite>>>({});
  readonly config = input<AvatarConfigLike | null>({ skinTone: 'tan' });
  readonly size = input(200);

  protected readonly onAvatar = signal(true);

  protected readonly equipped = computed<
    Partial<Record<AvatarSlot, AvatarSprite>>
  >(() => {
    const it = this.item();
    const sprite: AvatarSprite = {
      spriteAssetId: it.spriteAssetId,
      name: it.name,
      rarity: it.rarity,
    };
    return this.onAvatar()
      ? { ...this.baseEquipped(), [it.slot]: sprite }
      : { [it.slot]: sprite };
  });

  protected rarityVariant(r: ItemRarity): BadgeVariant {
    return RARITY_VARIANT[r];
  }
}
