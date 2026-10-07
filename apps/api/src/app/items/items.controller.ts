import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { ItemsService } from './items.service.js';
import {
  CreateItemCategoryDto,
  CreateItemDto,
  EquipDto,
  PurchaseDto,
  SaveAvatarConfigDto,
  ShopQueryDto,
  UpdateItemDto,
  type AvatarResponse,
  type InventoryItem,
  type ItemResponse,
  type PurchaseResponse,
  type ShopItem,
} from './items.dto.js';

/**
 * Shop + inventory + avatar (student) and item/category management (admin).
 */
@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Student ───────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Get('shop')
  shop(
    @CurrentUser() actor: ApiUser,
    @Query() query: ShopQueryDto,
  ): Promise<ShopItem[]> {
    return this.items.shop(actor.userId, query);
  }

  @Roles('STUDENT')
  @Post('shop/:id/purchase')
  @HttpCode(201)
  async purchase(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: PurchaseDto,
    @Req() req: Request,
  ): Promise<PurchaseResponse> {
    const res = await this.items.purchase(actor.userId, id, {
      equip: body?.equip,
    });
    void this.audit.record(actor, {
      action: 'shop.purchase',
      entity: 'Item',
      entityId: id,
      diff: {
        costCoins: res.item.costCoins,
        balanceAfter: res.coins,
        equipped: res.equipped,
      },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return res;
  }

  @Roles('STUDENT')
  @Get('inventory')
  inventory(@CurrentUser() actor: ApiUser): Promise<InventoryItem[]> {
    return this.items.inventory(actor.userId);
  }

  @Roles('STUDENT')
  @Get('avatar')
  avatar(@CurrentUser() actor: ApiUser): Promise<AvatarResponse> {
    return this.items.getAvatar(actor.userId);
  }

  @Roles('STUDENT')
  @Put('avatar/config')
  saveConfig(
    @CurrentUser() actor: ApiUser,
    @Body() body: SaveAvatarConfigDto,
  ): Promise<AvatarResponse> {
    return this.items.saveConfig(actor.userId, body.config);
  }

  @Roles('STUDENT')
  @Put('avatar/equip')
  equip(
    @CurrentUser() actor: ApiUser,
    @Body() body: EquipDto,
  ): Promise<AvatarResponse> {
    return this.items.equip(actor.userId, body.slot, body.itemId ?? null);
  }

  // ─── Admin ─────────────────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('item-categories')
  listCategories() {
    return this.items.listCategories();
  }

  @Roles('ADMIN')
  @Post('item-categories')
  createCategory(@Body() body: CreateItemCategoryDto) {
    return this.items.createCategory(body);
  }

  @Roles('ADMIN')
  @Get('items')
  listItems(): Promise<ItemResponse[]> {
    return this.items.listItems();
  }

  @Roles('ADMIN')
  @Post('items')
  async createItem(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateItemDto,
  ): Promise<ItemResponse> {
    const created = await this.items.createItem(body);
    void this.audit.record(actor, {
      action: 'item.create',
      entity: 'Item',
      entityId: created.id,
      diff: { ...body },
    });
    return created;
  }

  @Roles('ADMIN')
  @Patch('items/:id')
  async updateItem(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateItemDto,
  ): Promise<ItemResponse> {
    const updated = await this.items.updateItem(id, body);
    void this.audit.record(actor, {
      action: 'item.update',
      entity: 'Item',
      entityId: id,
      diff: { ...body },
    });
    return updated;
  }

  @Roles('ADMIN')
  @Delete('items/:id')
  @HttpCode(204)
  async removeItem(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.items.deleteItem(id);
    void this.audit.record(actor, {
      action: 'item.delete',
      entity: 'Item',
      entityId: id,
    });
  }

  /** Announce limited drops that just went live (also run by the job). */
  @Roles('ADMIN')
  @Post('admin/items/drops/announce')
  announceDrops(): Promise<{ drops: number; pushed: number }> {
    return this.items.announceDrops();
  }
}
