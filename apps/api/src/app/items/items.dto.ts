import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const ITEM_SLOTS = [
  'PET',
  'BACKGROUND',
  'TOP',
  'BOTTOM',
  'SHOES',
  'HAT',
  'HAIR',
  'GLASSES',
  'ACCESSORY',
  'FRAME',
  'EMOTE',
] as const;
export const RARITIES = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
] as const;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/**
 * A sprite/thumbnail reference: a placeholder token (`emoji:🎩`,
 * `color:#88ccff`) or the URL of an uploaded Asset — an absolute https URL
 * (R2 public URL) or the dev provider's `/api/assets/dev/<key>` path.
 */
export const SPRITE_REF =
  /^(?:emoji:\S.*|color:#[0-9a-fA-F]{3,8}|https:\/\/\S+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/\S+|\/api\/assets\/dev\/\S+)$/u;
const SPRITE_REF_MESSAGE =
  'must be an emoji:/color: placeholder or an uploaded asset URL (https://… or /api/assets/dev/…)';

export class CreateItemCategoryDto {
  @IsString()
  @Length(2, 60)
  @Matches(SLUG)
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateItemDto {
  @IsString()
  @Length(2, 60)
  @Matches(SLUG)
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsIn(ITEM_SLOTS)
  slot!: (typeof ITEM_SLOTS)[number];

  @IsString()
  categorySlug!: string;

  @IsOptional()
  @IsIn(RARITIES)
  rarity?: (typeof RARITIES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  costCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  requiredLevel?: number;

  @IsOptional()
  @IsBoolean()
  isPremiumOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  isLimitedDrop?: boolean;

  @IsOptional()
  @IsDateString()
  dropStartsAt?: string | null;

  @IsOptional()
  @IsDateString()
  dropEndsAt?: string | null;

  /** Placeholder token (emoji:/color:) or an uploaded Asset's URL. */
  @IsString()
  @Length(1, 500)
  @Matches(SPRITE_REF, { message: SPRITE_REF_MESSAGE })
  spriteAssetId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Matches(SPRITE_REF, { message: SPRITE_REF_MESSAGE })
  thumbnailAssetId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PurchaseDto {
  /** Equip the item in its slot in the same transaction as the purchase. */
  @IsOptional()
  @IsBoolean()
  equip?: boolean;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsOptional() @IsIn(ITEM_SLOTS) slot?: (typeof ITEM_SLOTS)[number];
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsIn(RARITIES) rarity?: (typeof RARITIES)[number];
  @IsOptional() @IsInt() @Min(0) @Max(1000000) costCoins?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) requiredLevel?: number;
  @IsOptional() @IsBoolean() isPremiumOnly?: boolean;
  @IsOptional() @IsBoolean() isLimitedDrop?: boolean;
  @IsOptional() @IsDateString() dropStartsAt?: string | null;
  @IsOptional() @IsDateString() dropEndsAt?: string | null;
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(SPRITE_REF, { message: SPRITE_REF_MESSAGE })
  spriteAssetId?: string;
  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Matches(SPRITE_REF, { message: SPRITE_REF_MESSAGE })
  thumbnailAssetId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ShopQueryDto {
  @IsOptional() @IsIn(ITEM_SLOTS) slot?: (typeof ITEM_SLOTS)[number];
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsIn(RARITIES) rarity?: (typeof RARITIES)[number];
  @IsOptional() @IsIn(['true', 'false']) affordableOnly?: 'true' | 'false';
  @IsOptional() @IsIn(['true', 'false']) premiumOnly?: 'true' | 'false';
}

export class EquipDto {
  @IsIn(ITEM_SLOTS)
  slot!: (typeof ITEM_SLOTS)[number];

  /** Item to equip in the slot; null/omitted unequips. */
  @IsOptional()
  @IsString()
  itemId?: string | null;
}

export class SaveAvatarConfigDto {
  @IsObject()
  @Type(() => Object)
  config!: Record<string, unknown>;
}

export interface ItemResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  slot: (typeof ITEM_SLOTS)[number];
  categorySlug: string;
  rarity: (typeof RARITIES)[number];
  costCoins: number;
  requiredLevel: number;
  isPremiumOnly: boolean;
  isLimitedDrop: boolean;
  dropStartsAt: string | null;
  dropEndsAt: string | null;
  spriteAssetId: string;
  thumbnailAssetId: string | null;
  isActive: boolean;
}

export interface ShopItem extends ItemResponse {
  owned: boolean;
  canBuy: boolean;
  reason: string;
}

export interface InventoryItem {
  item: ItemResponse;
  equipped: boolean;
  acquiredAt: string;
  source: string;
}

export interface EquippedRef {
  itemId: string;
  slug: string;
  name: string;
  slot: (typeof ITEM_SLOTS)[number];
  rarity: (typeof RARITIES)[number];
  spriteAssetId: string;
}

export interface AvatarResponse {
  config: Record<string, unknown> | null;
  equipped: Partial<Record<(typeof ITEM_SLOTS)[number], EquippedRef>>;
}

export interface PurchaseResponse {
  item: ItemResponse;
  coins: number;
  /** True when the purchase also equipped the item (`{ equip: true }`). */
  equipped: boolean;
}
