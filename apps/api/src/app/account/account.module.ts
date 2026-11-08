import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccountExportService } from './account-export.service.js';
import { AccountPurgeService } from './account-purge.service.js';
import {
  AccountController,
  AdminAccountController,
} from './account.controller.js';
import { AccountService } from './account.service.js';
import { UnderAgeDeletionService } from './under-age-deletion.service.js';

/**
 * Account lifecycle + privacy (docs/14 §12–13): data export, self-service
 * delete / restore, the daily purge (anonymisation) job, and staff
 * suspension. Request-time enforcement lives in the auth middleware via
 * account-state.ts. BillingService comes from the global BillingModule.
 */
@Module({
  // ClerkService: suspensions are mirrored as Clerk bans.
  // NotificationsModule: SYSTEM notice on suspension (docs/10 §3).
  imports: [AuthModule, NotificationsModule],
  controllers: [AccountController, AdminAccountController],
  providers: [
    AccountService,
    AccountExportService,
    AccountPurgeService,
    UnderAgeDeletionService,
  ],
  // UnderAgeDeletionService: under-12 dates of birth (users/birth-date).
  exports: [AccountService, UnderAgeDeletionService],
})
export class AccountModule {}
