import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export class CreateBadgeDto {
  @IsString()
  @Length(2, 50)
  @Matches(SLUG)
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  iconName?: string;

  /** BadgeRule DSL — validated structurally by the evaluator. */
  @IsObject()
  rule!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  xpReward?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  coinReward?: number;

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBadgeDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(SLUG)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  iconName?: string;

  @IsOptional()
  @IsObject()
  rule?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  xpReward?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  coinReward?: number;

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
