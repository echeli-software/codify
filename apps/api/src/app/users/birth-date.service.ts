import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ageGroup,
  checkBirthDate,
  classifyAge,
  localDay,
  MINIMUM_AGE,
  type AgeCheck,
} from '@codify/domain';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnderAgeDeletionService } from '../account/under-age-deletion.service.js';
import { MINOR_RESET, dateOnly } from './age-policy.js';
import type { BirthDateCorrectionResult } from './birth-date.dto.js';
import type { MeResponse } from './users.dto.js';
import { UsersService } from './users.service.js';

const TARGET_SELECT = {
  id: true,
  role: true,
  birthDate: true,
  timezone: true,
  deletedAt: true,
} as const;

/**
 * Date of birth (launch decision 2026-11, docs/14 "Minors"):
 *
 * - the user sets it once (`PUT /me/birth-date`); a second attempt is 409
 *   `BIRTH_DATE_ALREADY_SET`;
 * - staff (ADMIN, SUPPORT) correct it (`POST /admin/users/:id/birth-date`),
 *   audited as `user.birth_date_corrected` with the age groups only;
 * - a date under 12 removes the account at once (UnderAgeDeletionService)
 *   and answers 403 `AGE_BELOW_MINIMUM`;
 * - a date of 12–17 turns the minor defaults on (activity feed and
 *   marketing email opt-ins off).
 *
 * Dates are checked on the user's own calendar day (`User.timezone`).
 * They are never logged or written to the audit trail.
 */
@Injectable()
export class BirthDateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly underAge: UnderAgeDeletionService,
  ) {}

  async setOwn(
    actor: ApiUser,
    birthDate: string,
    now = new Date(),
  ): Promise<MeResponse> {
    const user = await this.load(actor.userId);
    if (user.birthDate)
      throw new ConflictException({
        code: 'BIRTH_DATE_ALREADY_SET',
        message:
          'Your date of birth is already set. Contact support to correct it.',
      });
    const check = this.check(birthDate, user.timezone, now);
    if (check === 'under_minimum') {
      if (user.role === 'ADMIN') throw belowMinimum(false);
      // Awaited before the purge, which strips the network identifiers
      // from the user's own audit rows.
      await this.audit.record(actor, {
        action: 'user.deleted_under_age',
        entity: 'User',
        entityId: actor.userId,
        diff: { by: 'self', minimumAge: MINIMUM_AGE },
      });
      await this.underAge.deleteNow(actor.userId, now);
      throw belowMinimum(true);
    }
    const res = await this.prisma.user.updateMany({
      where: { id: actor.userId, birthDate: null },
      data: {
        birthDate: dateOnly(birthDate),
        ...(check === 'minor' ? MINOR_RESET : {}),
      },
    });
    if (res.count === 0)
      throw new ConflictException({
        code: 'BIRTH_DATE_ALREADY_SET',
        message:
          'Your date of birth is already set. Contact support to correct it.',
      });
    await this.audit.record(actor, {
      action: 'user.birth_date_set',
      entity: 'User',
      entityId: actor.userId,
      diff: { ageGroup: check },
    });
    return this.users.getById(actor.userId);
  }

  async correct(
    actor: ApiUser,
    userId: string,
    birthDate: string,
    reason: string | undefined,
    now = new Date(),
  ): Promise<BirthDateCorrectionResult> {
    if (actor.userId === userId)
      throw new BadRequestException({
        code: 'CANNOT_CORRECT_SELF',
        message: 'Ask another staff member to correct your own date of birth',
      });
    const user = await this.load(userId);
    if (user.deletedAt) throw new NotFoundException('User not found');
    if (
      actor.role === 'SUPPORT' &&
      user.role !== 'STUDENT' &&
      user.role !== 'TEACHER'
    )
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Only an admin can correct a staff account',
        requiredRole: 'ADMIN',
      });
    const before = { ageGroup: ageGroup(user, now) };
    const check = this.check(birthDate, user.timezone, now);
    const note = reason?.trim() || null;

    if (check === 'under_minimum') {
      if (user.role === 'ADMIN') throw belowMinimum(false);
      await this.audit.record(actor, {
        action: 'user.birth_date_corrected',
        entity: 'User',
        entityId: userId,
        before,
        after: { ageGroup: 'under_minimum', accountDeleted: true },
        diff: { reason: note },
      });
      await this.underAge.deleteNow(userId, now);
      return { userId, before, after: { deleted: true } };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        birthDate: dateOnly(birthDate),
        ...(check === 'minor' ? MINOR_RESET : {}),
      },
    });
    const after = { ageGroup: check };
    await this.audit.record(actor, {
      action: 'user.birth_date_corrected',
      entity: 'User',
      entityId: userId,
      before,
      after,
      diff: { reason: note },
    });
    return { userId, before, after };
  }

  /** Validate on the user's local day; 400 `BIRTH_DATE_INVALID` otherwise. */
  private check(
    birthDate: string,
    timezone: string | null,
    now: Date,
  ): AgeCheck {
    const today = localDay(now, timezone);
    const problem = checkBirthDate(birthDate, today);
    if (problem)
      throw new BadRequestException({
        code: 'BIRTH_DATE_INVALID',
        message:
          problem === 'future'
            ? 'The date of birth cannot be in the future'
            : problem === 'too_old'
              ? 'Please check the year of the date of birth'
              : 'The date of birth is not a real date',
        reason: problem,
      });
    return classifyAge(birthDate, today);
  }

  private async load(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: TARGET_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

/** 403 `AGE_BELOW_MINIMUM`; `accountDeleted` tells the client to sign out. */
function belowMinimum(accountDeleted: boolean): ForbiddenException {
  return new ForbiddenException({
    code: 'AGE_BELOW_MINIMUM',
    message: `Codify is for ages ${MINIMUM_AGE} and up`,
    minimumAge: MINIMUM_AGE,
    accountDeleted,
  });
}
