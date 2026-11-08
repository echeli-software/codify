import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  CorrectBirthDateDto,
  SetBirthDateDto,
  type BirthDateCorrectionResult,
} from './birth-date.dto.js';
import { BirthDateService } from './birth-date.service.js';
import type { MeResponse } from './users.dto.js';

/**
 * Date of birth (docs/14 "Minors", docs/05 Onboarding). A dedicated
 * endpoint rather than a PATCH /me field: it is set once, may delete the
 * account (under 12), and must never land in the `user.update_self` audit
 * diff.
 */
@Controller()
export class BirthDateController {
  constructor(private readonly birthDates: BirthDateService) {}

  /**
   * Set your own date of birth, once. 200 → GET /me shape (with `ageGroup`).
   * 400 `BIRTH_DATE_INVALID` (`reason`: invalid | future | too_old), 409
   * `BIRTH_DATE_ALREADY_SET`, 403 `AGE_BELOW_MINIMUM` (under 12: the
   * account was deleted, `accountDeleted: true`).
   */
  @Put('me/birth-date')
  set(
    @CurrentUser() actor: ApiUser,
    @Body() body: SetBirthDateDto,
  ): Promise<MeResponse> {
    return this.birthDates.setOwn(actor, body.birthDate);
  }

  /**
   * Staff correction (typed confirmation "CORRECT"). ADMIN and SUPPORT;
   * SUPPORT only for student / teacher accounts. Audited
   * `user.birth_date_corrected` with the age groups, never the dates. A
   * date under 12 deletes the account (`after: { deleted: true }`).
   */
  @Roles('ADMIN', 'SUPPORT')
  @Post('admin/users/:id/birth-date')
  @HttpCode(200)
  correct(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CorrectBirthDateDto,
  ): Promise<BirthDateCorrectionResult> {
    return this.birthDates.correct(actor, id, body.birthDate, body.reason);
  }
}
