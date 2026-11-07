import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/** snake_case, starts with a letter, ≤ 64 chars — the catalogue in docs/10 §14. */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const MAX_EVENTS_PER_BATCH = 50;
/** Serialized `props` cap per event. */
export const MAX_PROPS_BYTES = 4096;

export class AnalyticsEventDto {
  @IsString()
  @Matches(EVENT_NAME_PATTERN, { message: 'name must be snake_case' })
  name!: string;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;

  /** Device time the event happened (ISO-8601). */
  @IsISO8601({ strict: true })
  occurredAt!: string;
}

/** POST /api/analytics/events */
export class AnalyticsBatchDto {
  /** Stable per-install id; required when the caller is not signed in. */
  @IsOptional()
  @IsString()
  @Length(8, 64)
  anonymousId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  platform?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsEventDto)
  events!: AnalyticsEventDto[];
}

export interface AnalyticsSummaryRow {
  name: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
}
