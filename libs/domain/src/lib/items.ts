/**
 * Pure shop/item eligibility logic — shared by the API (purchase enforcement)
 * and the client (shop affordability badges). See /docs/08-avatar-and-shop.md
 * §6–§7. Same rule both sides → the "Buy" button never lies.
 */

export type ItemSlot =
  | 'PET'
  | 'BACKGROUND'
  | 'TOP'
  | 'BOTTOM'
  | 'SHOES'
  | 'HAT'
  | 'HAIR'
  | 'GLASSES'
  | 'ACCESSORY'
  | 'FRAME'
  | 'EMOTE';

export type ItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export interface ItemEligibilityLike {
  costCoins: number;
  requiredLevel: number;
  isPremiumOnly: boolean;
  isLimitedDrop: boolean;
  dropStartsAt?: Date | string | null;
  dropEndsAt?: Date | string | null;
}

export type PurchaseReason =
  | 'ok'
  | 'owned'
  | 'not_available'
  | 'level_locked'
  | 'premium_required'
  | 'insufficient_coins';

export interface PurchaseEligibility {
  canBuy: boolean;
  reason: PurchaseReason;
}

export interface EvaluatePurchaseInput {
  item: ItemEligibilityLike;
  userCoins: number;
  userLevel: number;
  isPremium: boolean;
  owned: boolean;
  now?: Date;
}

function ms(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Whether a limited-drop item is inside its sale window (non-limited = always). */
export function isItemAvailable(item: ItemEligibilityLike, now: Date = new Date()): boolean {
  if (!item.isLimitedDrop) return true;
  const t = now.getTime();
  const s = ms(item.dropStartsAt);
  const e = ms(item.dropEndsAt);
  if (s != null && t < s) return false;
  if (e != null && t > e) return false;
  return true;
}

/**
 * Can the user buy this item right now? Evaluated in priority order so the
 * surfaced reason is the most actionable one:
 *   owned → not_available (drop window) → level_locked → premium_required →
 *   insufficient_coins → ok.
 */
export function evaluatePurchase(input: EvaluatePurchaseInput): PurchaseEligibility {
  const now = input.now ?? new Date();
  if (input.owned) return { canBuy: false, reason: 'owned' };
  if (!isItemAvailable(input.item, now)) return { canBuy: false, reason: 'not_available' };
  if (input.userLevel < input.item.requiredLevel) return { canBuy: false, reason: 'level_locked' };
  if (input.item.isPremiumOnly && !input.isPremium) return { canBuy: false, reason: 'premium_required' };
  if (input.userCoins < input.item.costCoins) return { canBuy: false, reason: 'insufficient_coins' };
  return { canBuy: true, reason: 'ok' };
}
