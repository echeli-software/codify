import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  AuditQueryDto,
  BadgeTestDto,
  CreateItemCategoryAdminDto,
  GrantItemDto,
  LeagueSnapshotQueryDto,
  LedgerQueryDto,
  UpdateItemCategoryAdminDto,
  type AuditEntryView,
  type BadgeTestResponse,
  type DashboardResponse,
  type GrantItemResponse,
  type ItemCategoryAdminView,
  type LeagueDetailResponse,
  type LeagueSnapshotResponse,
  type LedgerPage,
  type Page,
  type SearchResponse,
  type UserInventoryEntry,
} from './admin-ops.dto.js';
import { pickLocale } from './admin-ops.util.js';
import { AuditReadService } from './audit-read.service.js';
import { BadgeTestService } from './badge-test.service.js';
import { DashboardService } from './dashboard.service.js';
import { ItemCategoriesAdminService } from './item-categories-admin.service.js';
import { LeaguesAdminService } from './leagues-admin.service.js';
import { SearchService } from './search.service.js';
import { UserAdminService } from './user-admin.service.js';

function requestMeta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Admin operations (docs/04): dashboard, global search, audit read/export,
 * leagues, user inventory + ledgers, badge test, item categories. Role
 * rules follow docs/04 §1; every mutation is audited.
 */
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly dashboardSvc: DashboardService,
    private readonly searchSvc: SearchService,
    private readonly auditRead: AuditReadService,
    private readonly leagues: LeaguesAdminService,
    private readonly userAdmin: UserAdminService,
    private readonly badgeTest: BadgeTestService,
    private readonly itemCategories: ItemCategoriesAdminService,
    private readonly audit: AuditService,
  ) {}

  // ─── Dashboard + search ──────────────────────────────────────────────

  @Roles('ADMIN', 'SUPPORT', 'TEACHER')
  @Get('dashboard')
  dashboard(
    @CurrentUser() actor: ApiUser,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<DashboardResponse> {
    return this.dashboardSvc.get(actor, pickLocale(acceptLanguage));
  }

  @Roles('ADMIN', 'SUPPORT', 'TEACHER')
  @Get('search')
  search(
    @CurrentUser() actor: ApiUser,
    @Query('q') q?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<SearchResponse> {
    return this.searchSvc.search(actor, q, pickLocale(acceptLanguage));
  }

  // ─── Audit ───────────────────────────────────────────────────────────

  /** TEACHER callers only ever see their own actions (forced filter). */
  @Roles('ADMIN', 'SUPPORT', 'TEACHER')
  @Get('audit')
  auditList(
    @CurrentUser() actor: ApiUser,
    @Query() q: AuditQueryDto,
  ): Promise<Page<AuditEntryView>> {
    return this.auditRead.list(actor, q);
  }

  @Roles('ADMIN', 'SUPPORT', 'TEACHER')
  @Get('audit/export')
  async auditExport(
    @CurrentUser() actor: ApiUser,
    @Query() q: AuditQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const out = await this.auditRead.exportCsv(actor, q);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${stamp}.csv"`,
    );
    res.setHeader('X-Export-Rows', String(out.rows));
    res.setHeader('X-Export-Truncated', String(out.truncated));
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, X-Export-Rows, X-Export-Truncated',
    );
    return out.csv;
  }

  // ─── Leagues ─────────────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('leagues/snapshot')
  leaguesSnapshot(
    @Query() q: LeagueSnapshotQueryDto,
  ): Promise<LeagueSnapshotResponse> {
    return this.leagues.snapshot(q.weekStart);
  }

  @Roles('ADMIN')
  @Get('leagues/:id')
  leagueDetail(@Param('id') id: string): Promise<LeagueDetailResponse> {
    return this.leagues.detail(id);
  }

  // ─── Users: inventory + ledger ───────────────────────────────────────

  @Roles('ADMIN', 'SUPPORT')
  @Get('users/:id/items')
  userItems(@Param('id') id: string): Promise<UserInventoryEntry[]> {
    return this.userAdmin.inventory(id);
  }

  /** docs/04 §1: SUPPORT views items but only ADMIN grants them. */
  @Roles('ADMIN')
  @Post('users/:id/items')
  async grantItem(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: GrantItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GrantItemResponse> {
    const out = await this.userAdmin.grantItem(id, body.itemId);
    if (out.alreadyOwned) {
      res.status(200);
      return out;
    }
    res.status(201);
    void this.audit.record(actor, {
      action: 'user.item_grant',
      entity: 'User',
      entityId: id,
      diff: {
        itemId: body.itemId,
        itemSlug: out.entry.slug,
        source: 'ADMIN_GRANT',
        reason: body.reason.trim(),
      },
      ...requestMeta(req),
    });
    return out;
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('users/:id/ledger')
  userLedger(
    @Param('id') id: string,
    @Query() q: LedgerQueryDto,
  ): Promise<LedgerPage> {
    return this.userAdmin.ledger(id, q.type ?? 'coins', q.cursor, q.limit);
  }

  // ─── Badge test ──────────────────────────────────────────────────────

  @Roles('ADMIN')
  @Post('badges/:id/test')
  @HttpCode(200)
  testBadge(
    @Param('id') id: string,
    @Body() body: BadgeTestDto,
  ): Promise<BadgeTestResponse> {
    return this.badgeTest.test(id, body.userId);
  }

  // ─── Item categories ─────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('item-categories')
  listItemCategories(): Promise<ItemCategoryAdminView[]> {
    return this.itemCategories.list();
  }

  @Roles('ADMIN')
  @Post('item-categories')
  async createItemCategory(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateItemCategoryAdminDto,
    @Req() req: Request,
  ): Promise<ItemCategoryAdminView> {
    const created = await this.itemCategories.create(body);
    void this.audit.record(actor, {
      action: 'item_category.create',
      entity: 'ItemCategory',
      entityId: created.slug,
      diff: { after: { name: created.name, sortOrder: created.sortOrder } },
      ...requestMeta(req),
    });
    return created;
  }

  @Roles('ADMIN')
  @Patch('item-categories/:slug')
  async updateItemCategory(
    @CurrentUser() actor: ApiUser,
    @Param('slug') slug: string,
    @Body() body: UpdateItemCategoryAdminDto,
    @Req() req: Request,
  ): Promise<ItemCategoryAdminView> {
    const { before, after } = await this.itemCategories.update(slug, body);
    void this.audit.record(actor, {
      action: 'item_category.update',
      entity: 'ItemCategory',
      entityId: slug,
      diff: {
        before: { name: before.name, sortOrder: before.sortOrder },
        after: { name: after.name, sortOrder: after.sortOrder },
      },
      ...requestMeta(req),
    });
    return after;
  }

  @Roles('ADMIN')
  @Delete('item-categories/:slug')
  @HttpCode(204)
  async deleteItemCategory(
    @CurrentUser() actor: ApiUser,
    @Param('slug') slug: string,
    @Req() req: Request,
  ): Promise<void> {
    const before = await this.itemCategories.remove(slug);
    void this.audit.record(actor, {
      action: 'item_category.delete',
      entity: 'ItemCategory',
      entityId: slug,
      diff: { before: { name: before.name, sortOrder: before.sortOrder } },
      ...requestMeta(req),
    });
  }
}
