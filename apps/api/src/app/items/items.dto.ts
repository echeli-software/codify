import { Type } from 'class-transformer';
import {
  IsBoolean,
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
  @IsString()
  dropStartsAt?: string | null;

  @IsOptional()
  @IsString()
  dropEndsAt?: string | null;

  @IsString()
  @Length(1, 200)
  spriteAssetId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  thumbnailAssetId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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
  @IsOptional() @IsString() dropStartsAt?: string | null;
  @IsOptional() @IsString() dropEndsAt?: string | null;
  @IsOptional() @IsString() @Length(1, 200) spriteAssetId?: string;
  @IsOptional() @IsString() @Length(0, 200) thumbnailAssetId?: string;
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
}
