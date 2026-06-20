import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const PERIODS = ['MONTHLY', 'ANNUAL'] as const;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** A price line on a plan. `(currency, period)` is unique within a plan. */
export class PlanPriceInputDto {
  @Matches(CURRENCY_PATTERN, { message: 'currency must be a 3-letter ISO-4217 code' })
  currency!: string;

  @IsInt()
  @Min(0)
  @Max(100_000_00)
  amountCents!: number;

  @IsIn(PERIODS)
  period!: (typeof PERIODS)[number];

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  maxInstallments?: number;
}

export class CreatePlanDto {
  @IsString()
  @Length(2, 40)
  @Matches(SLUG_PATTERN, { message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-40 chars' })
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  tagline?: string;

  @IsOptional()
  @IsBoolean()
  isAllAccess?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PlanPriceInputDto)
  prices?: PlanPriceInputDto[];
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(SLUG_PATTERN, { message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-40 chars' })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  tagline?: string;

  @IsOptional()
  @IsBoolean()
  isAllAccess?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  categoryIds?: string[];
}

export class ListPlansQueryDto {
  /** Admin-only: include inactive + soft-deleted plans. Ignored for STUDENT. */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: 'true' | 'false';

  /** Filter to plans that include this course (plans-including-this-course). */
  @IsOptional()
  @IsString()
  courseId?: string;
}

export interface PlanPriceResponse {
  id: string;
  currency: string;
  amountCents: number;
  period: 'MONTHLY' | 'ANNUAL';
  maxInstallments: number | null;
  isActive: boolean;
  stripePriceId: string | null;
}

export interface PlanResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tagline: string | null;
  isAllAccess: boolean;
  isActive: boolean;
  trialDays: number;
  sortOrder: number;
  categoryIds: string[];
  prices: PlanPriceResponse[];
  stripeProductId: string | null;
  syncedToStripe: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanListResponse {
  items: PlanResponse[];
  total: number;
}
