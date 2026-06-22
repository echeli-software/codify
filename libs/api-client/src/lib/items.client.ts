import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type ItemSlot =
  | 'PET' | 'BACKGROUND' | 'TOP' | 'BOTTOM' | 'SHOES'
  | 'HAT' | 'HAIR' | 'GLASSES' | 'ACCESSORY' | 'FRAME' | 'EMOTE';
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
  thumbnailAssetId: string | null;
  isActive: boolean;
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
}

export interface EquippedRef {
  itemId: string;
  slug: string;
  name: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  spriteAssetId: string;
}

export interface AvatarResponse {
  config: Record<string, unknown> | null;
  equipped: Partial<Record<ItemSlot, EquippedRef>>;
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
    if (query.categorySlug) params = params.set('categorySlug', query.categorySlug);
    if (query.rarity) params = params.set('rarity', query.rarity);
    if (query.affordableOnly) params = params.set('affordableOnly', 'true');
    if (query.premiumOnly) params = params.set('premiumOnly', 'true');
    return firstValueFrom(this.http.get<ShopItem[]>(`${this.base}/shop`, { params }));
  }

  purchase(itemId: string): Promise<{ item: Item; coins: number }> {
    return firstValueFrom(
      this.http.post<{ item: Item; coins: number }>(`${this.base}/shop/${encodeURIComponent(itemId)}/purchase`, {}, { context: withIdempotency() }),
    );
  }

  inventory(): Promise<InventoryItem[]> {
    return firstValueFrom(this.http.get<InventoryItem[]>(`${this.base}/inventory`));
  }

  avatar(): Promise<AvatarResponse> {
    return firstValueFrom(this.http.get<AvatarResponse>(`${this.base}/avatar`));
  }

  saveConfig(config: Record<string, unknown>): Promise<AvatarResponse> {
    return firstValueFrom(this.http.put<AvatarResponse>(`${this.base}/avatar/config`, { config }, { context: withIdempotency() }));
  }

  equip(slot: ItemSlot, itemId: string | null): Promise<AvatarResponse> {
    return firstValueFrom(this.http.put<AvatarResponse>(`${this.base}/avatar/equip`, { slot, itemId }, { context: withIdempotency() }));
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  listItems(): Promise<Item[]> {
    return firstValueFrom(this.http.get<Item[]>(`${this.base}/items`));
  }

  createItem(body: CreateItemBody): Promise<Item> {
    return firstValueFrom(this.http.post<Item>(`${this.base}/items`, body, { context: withIdempotency() }));
  }

  updateItem(id: string, body: Partial<CreateItemBody>): Promise<Item> {
    return firstValueFrom(this.http.patch<Item>(`${this.base}/items/${encodeURIComponent(id)}`, body, { context: withIdempotency() }));
  }

  deleteItem(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/items/${encodeURIComponent(id)}`));
  }

  listCategories(): Promise<ItemCategory[]> {
    return firstValueFrom(this.http.get<ItemCategory[]>(`${this.base}/item-categories`));
  }

  createCategory(body: { slug: string; name: string; sortOrder?: number }): Promise<ItemCategory> {
    return firstValueFrom(this.http.post<ItemCategory>(`${this.base}/item-categories`, body, { context: withIdempotency() }));
  }
}
