import { Module } from '@nestjs/common';
import { TranslationsModule } from '../translations/translations.module.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AuditReadService } from './audit-read.service.js';
import { BadgeTestService } from './badge-test.service.js';
import { DashboardService } from './dashboard.service.js';
import { ItemCategoriesAdminService } from './item-categories-admin.service.js';
import { LeaguesAdminService } from './leagues-admin.service.js';
import { SearchService } from './search.service.js';
import { UserAdminService } from './user-admin.service.js';

/**
 * Admin-app operations that span feature areas (docs/04): dashboard KPIs,
 * global search, audit read/export, leagues snapshot, user inventory and
 * ledgers, badge "Test", item-category management. Gamification and audit
 * writers come from their global modules.
 */
@Module({
  imports: [TranslationsModule],
  controllers: [AdminOpsController],
  providers: [
    AuditReadService,
    BadgeTestService,
    DashboardService,
    ItemCategoriesAdminService,
    LeaguesAdminService,
    SearchService,
    UserAdminService,
  ],
})
export class AdminOpsModule {}
