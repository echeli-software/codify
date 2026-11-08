import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { ItemsService } from './items.service.js';
import {
  ItemDropsService,
  type ScheduledDropView,
} from './item-drops.service.js';
import type { ItemResponse } from './items.dto.js';

export class DropCopyDto {
  @IsString()
  @Length(1, 80)
  title!: string;

  @IsString()
  @Length(1, 200)
  body!: string;
}

/** Copy in both supported locales (docs/04 "set notification copy"). */
export class DropCopyLocalesDto {
  @ValidateNested()
  @Type(() => DropCopyDto)
  'pt-BR'!: DropCopyDto;

  @ValidateNested()
  @Type(() => DropCopyDto)
  'en-US'!: DropCopyDto;
}

/** POST /api/admin/items/drops */
export class ScheduleDropDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  itemIds!: string[];

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  endsAt?: string | null;

  @ValidateNested()
  @Type(() => DropCopyLocalesDto)
  copy!: DropCopyLocalesDto;
}

/**
 * Admin shop endpoints owned by the catalog screens: the read-only item
 * list for SUPPORT (docs/04 §1 "Items / Shop: View") and the limited-drop
 * wizard (ADMIN).
 */
@Controller('admin/items')
export class ItemDropsController {
  constructor(
    private readonly items: ItemsService,
    private readonly drops: ItemDropsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN', 'SUPPORT')
  @Get()
  list(): Promise<ItemResponse[]> {
    return this.items.listItems();
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('categories')
  categories() {
    return this.items.listCategories();
  }

  @Roles('ADMIN')
  @Post('drops')
  async schedule(
    @CurrentUser() actor: ApiUser,
    @Body() body: ScheduleDropDto,
    @Req() req: Request,
  ): Promise<ScheduledDropView> {
    const res = await this.drops.schedule({
      itemIds: body.itemIds,
      startsAt: body.startsAt,
      endsAt: body.endsAt ?? null,
      copy: { 'pt-BR': body.copy['pt-BR'], 'en-US': body.copy['en-US'] },
    });
    void this.audit.record(actor, {
      action: 'item.drop_schedule',
      entity: 'Item',
      diff: { ...res, copy: body.copy },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return res;
  }
}
