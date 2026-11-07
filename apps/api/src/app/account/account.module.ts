import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountExportService } from './account-export.service.js';
import { AccountPurgeService } from './account-purge.service.js';
import {
  AccountController,
  AdminAccountController,
} from './account.controller.js';
import { AccountService } from './account.service.js';

/**
 * Account lifecycle + privacy (docs/14 §12–13): data export, self-service
 * delete / restore, the daily purge (anonymisation) job, and staff
 * suspension. Request-time enforcement lives in the auth middleware via
 * account-state.ts. BillingService comes from the global BillingModule.
 */
@Module({
  // ClerkService: suspensions are mirrored as Clerk bans.
  imports: [AuthModule],
  controllers: [AccountController, AdminAccountController],
  providers: [AccountService, AccountExportService, AccountPurgeService],
  exports: [AccountService],
})
export class AccountModule {}
