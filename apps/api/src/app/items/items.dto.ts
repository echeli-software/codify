import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
 * `color:#88ccff`), an uploaded Asset's id (UUID — responses resolve it to
 * `spriteUrl`), or an uploaded Asset's URL — an absolute https URL (R2
 * public URL) or the dev provider's `/api/assets/dev/<key>` path.
 */
export const SPRITE_REF =
  /^(?:emoji:\S.*|color:#[0-9a-fA-F]{3,8}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|https:\/\/\S+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/\S+|\/api\/assets\/dev\/\S+)$/u;
const SPRITE_REF_MESSAGE =
  'must be an emoji:/color: placeholder, an uploaded asset id or an uploaded asset URL (https://… or /api/assets/dev/…)';

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

  /** Offline edit time (docs/16 §8 last-write-wins); ISO-8601. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  clientTimestamp?: string;
}

export class SaveAvatarConfigDto {
  /**
   * A (partial) AvatarConfig patch (docs/08 §5): `baseBodyId`, `skinTone`,
   * `baseHairStyle`, `baseHairColor`, `eyeColor`, `pose`, each from its
   * curated palette (`@codify/ui-core` avatar). Unknown keys / values →
   * 400 `avatar.config_invalid`. Merged over the stored config.
   */
  @IsObject()
  @Type(() => Object)
  config!: Record<string, unknown>;

  /** Offline edit time (docs/16 §8 last-write-wins); ISO-8601. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  clientTimestamp?: string;
}

/** `POST /avatar/random` — shuffle equipment from the owned set. */
export class RandomizeAvatarDto {
  /** Only these slots (default: every slot except EMOTE). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEM_SLOTS.length)
  @IsIn(ITEM_SLOTS, { each: true })
  slots?: (typeof ITEM_SLOTS)[number][];

  /** Also shuffle the free base look (skin tone is kept). */
  @IsOptional()
  @IsBoolean()
  look?: boolean;
}

/** `POST /avatar/starter-pet` — claim the onboarding gift (docs/10 §2). */
export class ClaimStarterPetDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  petName?: string;
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
  /** Resolved image URL for an uploaded sprite; null for `emoji:`/`color:` tokens. */
  spriteUrl: string | null;
  thumbnailAssetId: string | null;
  isActive: boolean;
  /** Item category name, in the caller's locale (shop + inventory only). */
  categoryName?: string;
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
  /** Resolved image URL for an uploaded sprite; null for `emoji:`/`color:` tokens. */
  spriteUrl: string | null;
}

export interface AvatarResponse {
  /** The full AvatarConfig (stored values, defaults for missing ones). */
  config: Record<string, unknown> | null;
  equipped: Partial<Record<(typeof ITEM_SLOTS)[number], EquippedRef>>;
  /** The user's name for their pet (`User.petName`), if set. */
  petName?: string | null;
  /** A `clientTimestamp` write lost to a newer change (LWW); nothing changed. */
  stale?: boolean;
}

export interface StarterPetStatus {
  /** The ONBOARDING gift was already given. */
  claimed: boolean;
  /** Not claimed yet and the first lesson is done → the gift can be opened. */
  eligible: boolean;
  item: ItemResponse | null;
  petName: string | null;
}

export interface ClaimStarterPetResponse extends StarterPetStatus {
  /** True when this call did nothing new (already claimed earlier). */
  alreadyClaimed: boolean;
  avatar: AvatarResponse;
}

export interface PurchaseResponse {
  item: ItemResponse;
  coins: number;
  /** True when the purchase also equipped the item (`{ equip: true }`). */
  equipped: boolean;
}
