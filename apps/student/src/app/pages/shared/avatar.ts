import type { AvatarResponse, Item, ItemSlot } from '@codify/api-client';
import type {
  AvatarSlot,
  AvatarSprite,
  EquippedMap,
  ShopItem,
} from '@codify/ui-ionic';

/** Equipped items as renderer sprites, with an optional try-on item on top. */
export function equippedSprites(
  avatar: AvatarResponse | null,
  tryOn: Pick<Item, 'slot' | 'spriteAssetId' | 'name' | 'rarity'> | null = null,
): Partial<Record<AvatarSlot, AvatarSprite>> {
  const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
  for (const [slot, ref] of Object.entries(avatar?.equipped ?? {})) {
    if (ref)
      out[slot as AvatarSlot] = {
        spriteAssetId: ref.spriteAssetId,
        name: ref.name,
        rarity: ref.rarity,
      };
  }
  if (tryOn) {
    out[tryOn.slot as AvatarSlot] = {
      spriteAssetId: tryOn.spriteAssetId,
      name: tryOn.name,
      rarity: tryOn.rarity,
    };
  }
  return out;
}

/** slot → equipped item id. */
export function equippedMap(avatar: AvatarResponse | null): EquippedMap {
  const out: EquippedMap = {};
  for (const [slot, ref] of Object.entries(avatar?.equipped ?? {})) {
    out[slot as AvatarSlot] = ref?.itemId ?? null;
  }
  return out;
}

/** Slots whose item changed between two equipped maps. */
export function changedSlots(
  before: EquippedMap,
  after: EquippedMap,
): { slot: ItemSlot; itemId: string | null }[] {
  const slots = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]) as Set<AvatarSlot>;
  const out: { slot: ItemSlot; itemId: string | null }[] = [];
  for (const slot of slots) {
    const a = before[slot] ?? null;
    const b = after[slot] ?? null;
    if (a !== b) out.push({ slot, itemId: b });
  }
  return out;
}

/** API item → the ui-ionic ShopItem shape. */
export function toUiItem(
  item: Item,
  extra: { owned?: boolean; equipped?: boolean } = {},
): ShopItem {
  return {
    id: item.id,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    spriteAssetId: item.spriteAssetId,
    costCoins: item.costCoins,
    requiredLevel: item.requiredLevel,
    isPremiumOnly: item.isPremiumOnly,
    owned: extra.owned,
    equipped: extra.equipped,
  };
}
