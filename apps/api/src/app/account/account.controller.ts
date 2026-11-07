import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Equals, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  RateLimitedException,
  RetryAfterInterceptor,
} from '../exercises/rate-limit.js';
import {
  AccountExportService,
  EXPORT_AUDIT_ACTION,
} from './account-export.service.js';
import {
  AccountService,
  type AccountStatusView,
  type AdminAccountStatusView,
  type DeleteAccountResult,
} from './account.service.js';

export class DeleteAccountDto {
  /** Typed confirmation — must be exactly "DELETE". */
  @IsString()
  @Equals('DELETE', { message: 'confirm must be "DELETE"' })
  confirm!: string;
}

export class SuspendUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

function reqMeta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Self-service privacy endpoints (docs/14 §13, Settings → Data & privacy).
 * Any authenticated role. `account-status` and `restore` are the only
 * routes the auth middleware lets a deleted account reach.
 */
@Controller('me')
@UseInterceptors(RetryAfterInterceptor)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly exporter: AccountExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('account-status')
  status(@CurrentUser() actor: ApiUser): Promise<AccountStatusView> {
    return this.account.status(actor.userId);
  }

  /**
   * JSON download of everything we hold about the caller. Once per
   * EXPORT_COOLDOWN_MS (429 RATE_LIMITED + Retry-After).
   */
  @Get('export')
  async export(
    @CurrentUser() actor: ApiUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const wait = await this.exporter.retryAfter(actor.userId);
    if (wait > 0) {
      throw new RateLimitedException(
        'You can export your data once every 10 minutes',
        wait,
        'EXPORT_RATE_LIMITED',
      );
    }
    const now = new Date();
    const data = await this.exporter.build(actor.userId, now);
    // Awaited: the audit row is also the throttle record.
    await this.audit.record(actor, {
      action: EXPORT_AUDIT_ACTION,
      entity: 'User',
      entityId: actor.userId,
      ...reqMeta(req),
    });
    const day = now.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="codify-data-${day}.json"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  /** Soft-delete (14-day restore window, anonymised after 30 days). */
  @Post('delete')
  @HttpCode(200)
  async delete(
    @CurrentUser() actor: ApiUser,
    @Body() _body: DeleteAccountDto,
    @Req() req: Request,
  ): Promise<DeleteAccountResult> {
    const res = await this.account.requestDeletion(actor);
    await this.audit.record(actor, {
      action: 'user.deleted',
      entity: 'User',
      entityId: actor.userId,
      diff: {
        selfService: true,
        restorableUntil: res.restorableUntil,
        autoRenewStopped: res.autoRenewStopped.map((s) => s.id),
        storeSubscriptions: res.storeSubscriptions.map((s) => s.id),
      },
      ...reqMeta(req),
    });
    return res;
  }

  @Post('restore')
  @HttpCode(200)
  async restore(
    @CurrentUser() actor: ApiUser,
    @Req() req: Request,
  ): Promise<AccountStatusView> {
    const res = await this.account.restore(actor.userId);
    await this.audit.record(actor, {
      action: 'user.restored',
      entity: 'User',
      entityId: actor.userId,
      ...reqMeta(req),
    });
    return res;
  }
}

/**
 * Staff moderation (docs/04 Users → Suspend / unsuspend). ADMIN and
 * SUPPORT (docs/04 §1: SUPPORT may suspend); SUPPORT is limited to
 * student/teacher accounts — see AccountService.suspend.
 */
@Controller('admin/users')
export class AdminAccountController {
  constructor(
    private readonly account: AccountService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN', 'SUPPORT')
  @Get(':id/account-status')
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminAccountStatusView> {
    return this.account.adminStatus(id);
  }

  @Roles('ADMIN', 'SUPPORT')
  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SuspendUserDto,
    @Req() req: Request,
  ): Promise<AdminAccountStatusView> {
    const { before, after } = await this.account.suspend(
      actor,
      id,
      body.reason.trim(),
    );
    await this.audit.record(actor, {
      action: 'user.suspended',
      entity: 'User',
      entityId: id,
      diff: {
        before: {
          suspendedAt: before.suspendedAt,
          suspendedReason: before.suspendedReason,
        },
        after: {
          suspendedAt: after.suspendedAt,
          suspendedReason: after.suspendedReason,
        },
      },
      ...reqMeta(req),
    });
    return after;
  }

  @Roles('ADMIN', 'SUPPORT')
  @Post(':id/unsuspend')
  @HttpCode(200)
  async unsuspend(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<AdminAccountStatusView> {
    const { before, after } = await this.account.unsuspend(actor, id);
    await this.audit.record(actor, {
      action: 'user.unsuspended',
      entity: 'User',
      entityId: id,
      diff: {
        before: {
          suspendedAt: before.suspendedAt,
          suspendedReason: before.suspendedReason,
        },
        after: { suspendedAt: null, suspendedReason: null },
      },
      ...reqMeta(req),
    });
    return after;
  }
}
