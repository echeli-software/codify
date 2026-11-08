import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

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

export interface Item {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  slot: ItemSlot;
  categorySlug: string;
  rarity: ItemRarity;
  costCoins: number;
  requiredLevel: number;
  isPremiumOnly: boolean;
  isLimitedDrop: boolean;
  dropStartsAt: string | null;
  dropEndsAt: string | null;
  spriteAssetId: string;
  /**
   * Resolved image URL when the sprite is an uploaded Asset (or a URL);
   * null for inline `emoji:` / `color:` tokens. Optional for older APIs.
   */
  spriteUrl?: string | null;
  thumbnailAssetId: string | null;
  isActive: boolean;
  /** Category name in the caller's locale (shop + inventory). */
  categoryName?: string;
}

export interface ShopItem extends Item {
  owned: boolean;
  canBuy: boolean;
  reason: string;
}

export interface InventoryItem {
  item: Item;
  equipped: boolean;
  acquiredAt: string;
  source: string;
  /** The user's name for this item (pets, docs/08 §10). Optional for older APIs. */
  nickname?: string | null;
}

export interface EquippedRef {
  itemId: string;
  slug: string;
  name: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  spriteAssetId: string;
  /**
   * Resolved image URL when the sprite is an uploaded Asset (or a URL);
   * null for inline `emoji:` / `color:` tokens. Optional for older APIs.
   */
  spriteUrl?: string | null;
  /** The pet's name (PET slot only, docs/08 §10). Optional for older APIs. */
  nickname?: string | null;
}

export interface AvatarResponse {
  config: Record<string, unknown> | null;
  equipped: Partial<Record<ItemSlot, EquippedRef>>;
  /** A queued (clientTimestamp) write lost to a newer change — nothing changed (docs/16 §8). */
  stale?: boolean;
  /** The equipped pet's name (alias of `equipped.PET.nickname`). Optional for older APIs. */
  petName?: string | null;
}

/** `PUT /avatar/pets/:itemId/name` (docs/08 §10). */
export interface PetNameResponse {
  itemId: string;
  /** The stored name; null when cleared. */
  nickname: string | null;
  avatar: AvatarResponse;
}

/** `GET /avatar/starter-pet` (docs/10 §2 first reward). */
export interface StarterPetStatus {
  claimed: boolean;
  /** Not claimed and the first lesson is done → the gift can be opened. */
  eligible: boolean;
  item: Item | null;
  petName: string | null;
}

export interface ClaimStarterPetResponse extends StarterPetStatus {
  alreadyClaimed: boolean;
  avatar: AvatarResponse;
}

/** Offline replay of an avatar edit: last-write-wins by device time. */
export interface AvatarWriteOptions {
  /** ISO-8601 device time of the edit. */
  clientTimestamp?: string;
  /** Pins the Idempotency-Key (the queued event's clientEventId). */
  idempotencyKey?: string;
}

export interface ItemCategory {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface ShopQuery {
  slot?: ItemSlot;
  categorySlug?: string;
  rarity?: ItemRarity;
  affordableOnly?: boolean;
  premiumOnly?: boolean;
}

export interface PurchaseResponse {
  item: Item;
  /** Coin balance after the purchase. */
  coins: number;
  /** True when the purchase also equipped the item. */
  equipped: boolean;
}

export interface CreateItemBody {
  slug: string;
  name: string;
  description?: string;
  slot: ItemSlot;
  categorySlug: string;
  rarity?: ItemRarity;
  costCoins?: number;
  requiredLevel?: number;
  isPremiumOnly?: boolean;
  isLimitedDrop?: boolean;
  dropStartsAt?: string | null;
  dropEndsAt?: string | null;
  spriteAssetId: string;
  thumbnailAssetId?: string;
  isActive?: boolean;
}

/** Typed client for /api/shop, /api/inventory, /api/avatar, and admin items. */
@Injectable({ providedIn: 'root' })
export class ItemsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  shop(query: ShopQuery = {}): Promise<ShopItem[]> {
    let params = new HttpParams();
    if (query.slot) params = params.set('slot', query.slot);
    if (query.categorySlug)
      params = params.set('categorySlug', query.categorySlug);
    if (query.rarity) params = params.set('rarity', query.rarity);
    if (query.affordableOnly) params = params.set('affordableOnly', 'true');
    if (query.premiumOnly) params = params.set('premiumOnly', 'true');
    return firstValueFrom(
      this.http.get<ShopItem[]>(`${this.base}/shop`, { params }),
    );
  }

  /** Buy an item; `{ equip: true }` also wears it, atomically. */
  purchase(
    itemId: string,
    opts: { equip?: boolean } = {},
  ): Promise<PurchaseResponse> {
    return firstValueFrom(
      this.http.post<PurchaseResponse>(
        `${this.base}/shop/${encodeURIComponent(itemId)}/purchase`,
        opts.equip ? { equip: true } : {},
        { context: withIdempotency() },
      ),
    );
  }

  inventory(): Promise<InventoryItem[]> {
    return firstValueFrom(
      this.http.get<InventoryItem[]>(`${this.base}/inventory`),
    );
  }

  avatar(): Promise<AvatarResponse> {
    return firstValueFrom(this.http.get<AvatarResponse>(`${this.base}/avatar`));
  }

  saveConfig(
    config: Record<string, unknown>,
    opts: AvatarWriteOptions = {},
  ): Promise<AvatarResponse> {
    return firstValueFrom(
      this.http.put<AvatarResponse>(
        `${this.base}/avatar/config`,
        opts.clientTimestamp
          ? { config, clientTimestamp: opts.clientTimestamp }
          : { config },
        { context: withIdempotency(undefined, opts.idempotencyKey) },
      ),
    );
  }

  equip(
    slot: ItemSlot,
    itemId: string | null,
    opts: AvatarWriteOptions = {},
  ): Promise<AvatarResponse> {
    return firstValueFrom(
      this.http.put<AvatarResponse>(
        `${this.base}/avatar/equip`,
        opts.clientTimestamp
          ? { slot, itemId, clientTimestamp: opts.clientTimestamp }
          : { slot, itemId },
        { context: withIdempotency(undefined, opts.idempotencyKey) },
      ),
    );
  }

  /** "Random": equip a random owned item per slot (`look` also shuffles the base look). */
  randomize(
    opts: { slots?: ItemSlot[]; look?: boolean } = {},
  ): Promise<AvatarResponse> {
    return firstValueFrom(
      this.http.post<AvatarResponse>(`${this.base}/avatar/random`, opts, {
        context: withIdempotency(),
      }),
    );
  }

  /** Starter-pet gift state (claimed / eligible). */
  starterPet(): Promise<StarterPetStatus> {
    return firstValueFrom(
      this.http.get<StarterPetStatus>(`${this.base}/avatar/starter-pet`),
    );
  }

  /**
   * Open the starter-pet gift (idempotent) and optionally name it. 409
   * `starter_pet.locked` before the first lesson is completed.
   */
  claimStarterPet(petName?: string): Promise<ClaimStarterPetResponse> {
    return firstValueFrom(
      this.http.post<ClaimStarterPetResponse>(
        `${this.base}/avatar/starter-pet`,
        petName ? { petName } : {},
        { context: withIdempotency() },
      ),
    );
  }

  /**
   * Name an owned pet (max 30 chars; null or "" clears it). 404
   * `pet.not_owned`, 400 `pet.not_a_pet`.
   */
  namePet(itemId: string, name: string | null): Promise<PetNameResponse> {
    return firstValueFrom(
      this.http.put<PetNameResponse>(
        `${this.base}/avatar/pets/${encodeURIComponent(itemId)}/name`,
        { name },
        { context: withIdempotency() },
      ),
    );
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  listItems(): Promise<Item[]> {
    return firstValueFrom(this.http.get<Item[]>(`${this.base}/items`));
  }

  createItem(body: CreateItemBody): Promise<Item> {
    return firstValueFrom(
      this.http.post<Item>(`${this.base}/items`, body, {
        context: withIdempotency(),
      }),
    );
  }

  updateItem(id: string, body: Partial<CreateItemBody>): Promise<Item> {
    return firstValueFrom(
      this.http.patch<Item>(
        `${this.base}/items/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  deleteItem(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/items/${encodeURIComponent(id)}`),
    );
  }

  listCategories(): Promise<ItemCategory[]> {
    return firstValueFrom(
      this.http.get<ItemCategory[]>(`${this.base}/item-categories`),
    );
  }

  createCategory(body: {
    slug: string;
    name: string;
    sortOrder?: number;
  }): Promise<ItemCategory> {
    return firstValueFrom(
      this.http.post<ItemCategory>(`${this.base}/item-categories`, body, {
        context: withIdempotency(),
      }),
    );
  }

  /** ADMIN: announce limited drops that just went live (the job does this every 15 min). */
  announceDrops(): Promise<{ drops: number; pushed: number }> {
    return firstValueFrom(
      this.http.post<{ drops: number; pushed: number }>(
        `${this.base}/admin/items/drops/announce`,
        {},
        { context: withIdempotency() },
      ),
    );
  }
}
