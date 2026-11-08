import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import {
  BADGE_EVENTS,
  BADGE_METRICS,
  validateBadgeRule,
} from '../gamification/badges.service.js';
import {
  MultiplierPreviewService,
  type MultiplierPreviewResponse,
} from './multiplier-preview.service.js';

/** POST /api/admin/multipliers/preview */
export class MultiplierPreviewDto {
  @IsString()
  @Length(1, 64)
  userId!: string;

  @IsString()
  @Length(1, 64)
  lessonId!: string;

  /** When to evaluate time windows (default: now). */
  @IsOptional()
  @IsDateString()
  at?: string;
}

/** POST /api/admin/badges/validate-rule */
export class ValidateBadgeRuleDto {
  @IsObject()
  rule!: Record<string, unknown>;
}

export interface BadgeRuleValidation {
  valid: boolean;
  problems: string[];
  events: readonly string[];
  metrics: readonly string[];
}

/**
 * Catalog helpers for the admin screens (docs/04): the Promotions
 * "effective preview" and the badge rule builder's server-side check.
 * Both are read-only, ADMIN only.
 */
@Controller('admin')
@Roles('ADMIN')
export class CatalogToolsController {
  constructor(private readonly preview: MultiplierPreviewService) {}

  @Post('multipliers/preview')
  @HttpCode(200)
  previewMultiplier(
    @Body() body: MultiplierPreviewDto,
  ): Promise<MultiplierPreviewResponse> {
    return this.preview.preview(
      body.userId,
      body.lessonId,
      body.at ? new Date(body.at) : new Date(),
    );
  }

  @Post('badges/validate-rule')
  @HttpCode(200)
  validateRule(@Body() body: ValidateBadgeRuleDto): BadgeRuleValidation {
    const problems = validateBadgeRule(body.rule);
    return {
      valid: problems.length === 0,
      problems,
      events: BADGE_EVENTS,
      metrics: BADGE_METRICS,
    };
  }
}
