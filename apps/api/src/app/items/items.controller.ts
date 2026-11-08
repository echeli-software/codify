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
import { ItemsService, itemAuditSnapshot } from './items.service.js';
import { StarterPetService } from './starter-pet.service.js';
import { PetNamesService } from './pet-names.service.js';
import { validateClientTimestamp } from '../progress/progress.service.js';
import {
  CreateItemCategoryDto,
  ClaimStarterPetDto,
  CreateItemDto,
  EquipDto,
  NamePetDto,
  RandomizeAvatarDto,
  PurchaseDto,
  SaveAvatarConfigDto,
  ShopQueryDto,
  UpdateItemDto,
  type AvatarResponse,
  type ClaimStarterPetResponse,
  type StarterPetStatus,
  type InventoryItem,
  type ItemResponse,
  type PetNameResponse,
  type PurchaseResponse,
  type ShopItem,
} from './items.dto.js';
import { RewardThrottle } from '../common/throttling/throttle.decorators.js';
import { RequireFeature } from '../flags/feature.guard.js';

/**
 * Shop + inventory + avatar (student) and item/category management (admin).
 */
@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly audit: AuditService,
    private readonly starterPets: StarterPetService,
    private readonly petNames: PetNamesService,
  ) {}

  // ─── Student ───────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @RequireFeature('shop.enabled')
  @Get('shop')
  shop(
    @CurrentUser() actor: ApiUser,
    @Query() query: ShopQueryDto,
  ): Promise<ShopItem[]> {
    return this.items.shop(actor.userId, query);
  }

  @RewardThrottle()
  @Roles('STUDENT')
  @RequireFeature('shop.enabled')
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
    return this.items.saveConfig(
      actor.userId,
      body.config,
      validateClientTimestamp(body.clientTimestamp),
    );
  }

  @Roles('STUDENT')
  @Put('avatar/equip')
  equip(
    @CurrentUser() actor: ApiUser,
    @Body() body: EquipDto,
  ): Promise<AvatarResponse> {
    return this.items.equip(
      actor.userId,
      body.slot,
      body.itemId ?? null,
      validateClientTimestamp(body.clientTimestamp),
    );
  }

  /** "Random" in the dressing room: shuffle equipment from the owned set. */
  @Roles('STUDENT')
  @Post('avatar/random')
  @HttpCode(200)
  randomize(
    @CurrentUser() actor: ApiUser,
    @Body() body: RandomizeAvatarDto,
  ): Promise<AvatarResponse> {
    return this.items.randomize(actor.userId, {
      slots: body?.slots,
      look: body?.look,
    });
  }

  /** The onboarding starter pet: claimed / eligible (docs/10 §2). */
  @Roles('STUDENT')
  @Get('avatar/starter-pet')
  starterPet(@CurrentUser() actor: ApiUser): Promise<StarterPetStatus> {
    return this.starterPets.status(actor.userId);
  }

  /** Open the starter-pet gift (idempotent) and optionally name it. */
  @Roles('STUDENT')
  @Post('avatar/starter-pet')
  @HttpCode(200)
  claimStarterPet(
    @CurrentUser() actor: ApiUser,
    @Body() body: ClaimStarterPetDto,
  ): Promise<ClaimStarterPetResponse> {
    return this.starterPets.claim(actor.userId, { petName: body?.petName });
  }

  /**
   * Name an owned pet (docs/08 §10); null / "" clears the name. 404
   * `pet.not_owned`, 400 `pet.not_a_pet`.
   */
  @Roles('STUDENT')
  @Put('avatar/pets/:itemId/name')
  namePet(
    @CurrentUser() actor: ApiUser,
    @Param('itemId') itemId: string,
    @Body() body: NamePetDto,
  ): Promise<PetNameResponse> {
    return this.petNames.rename(actor.userId, itemId, body.name);
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
      after: itemAuditSnapshot(created),
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
    const { before, after } = await this.items.updateItem(id, body);
    void this.audit.record(actor, {
      action: 'item.update',
      entity: 'Item',
      entityId: id,
      before: itemAuditSnapshot(before),
      after: itemAuditSnapshot(after),
    });
    return after;
  }

  @Roles('ADMIN')
  @Delete('items/:id')
  @HttpCode(204)
  async removeItem(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<void> {
    const removed = await this.items.deleteItem(id);
    void this.audit.record(actor, {
      action: 'item.delete',
      entity: 'Item',
      entityId: id,
      before: itemAuditSnapshot(removed),
    });
  }

  /** Announce limited drops that just went live (also run by the job). */
  @Roles('ADMIN')
  @Post('admin/items/drops/announce')
  announceDrops(): Promise<{ drops: number; pushed: number }> {
    return this.items.announceDrops();
  }
}
