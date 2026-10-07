import type { AvatarSlot } from '../../molecules/avatar-renderer/avatar-renderer.js';

export type ItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export const RARITIES: readonly ItemRarity[] = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
];

/** Slots in display order (docs/08 §2). */
export const SLOT_ORDER: readonly AvatarSlot[] = [
  'HAT',
  'HAIR',
  'GLASSES',
  'TOP',
  'BOTTOM',
  'SHOES',
  'ACCESSORY',
  'EMOTE',
  'PET',
  'BACKGROUND',
  'FRAME',
];

/** Shop / inventory item as the student UI needs it. */
export interface ShopItem {
  id: string;
  name: string;
  slot: AvatarSlot;
  rarity: ItemRarity;
  /** Placeholder token "emoji:🎩" / "color:#hex" (docs/08 §3). */
  spriteAssetId: string;
  costCoins: number;
  requiredLevel?: number;
  isPremiumOnly?: boolean;
  owned?: boolean;
  /** Inventory only. */
  equipped?: boolean;
}

export type Affordability = 'owned' | 'premium' | 'level' | 'short' | 'ok';

/** Why (or whether) the user can buy an item — drives the tile badge + CTA. */
export function affordability(
  item: ShopItem,
  ctx: { balance: number; level: number; isPremium: boolean },
): Affordability {
  if (item.owned) return 'owned';
  if (item.isPremiumOnly && !ctx.isPremium) return 'premium';
  if ((item.requiredLevel ?? 1) > ctx.level) return 'level';
  if (item.costCoins > ctx.balance) return 'short';
  return 'ok';
}

/** Glyph or swatch for a placeholder sprite token. */
export function spriteGlyph(token: string): {
  kind: 'emoji' | 'color';
  value: string;
} {
  if (token.startsWith('emoji:'))
    return { kind: 'emoji', value: token.slice(6) };
  if (token.startsWith('color:'))
    return { kind: 'color', value: token.slice(6) };
  return { kind: 'color', value: 'rgba(0,0,0,0.1)' };
}
