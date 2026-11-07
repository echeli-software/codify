import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { NotificationKind } from '@prisma/client';
import {
  MAX_DAILY_PUSH_CAP,
  MAX_FEWER_LEVEL,
  NOTIFICATION_KINDS,
  type NotificationAction,
} from './notification-kinds.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /me/notifications?cursor=&limit= */
export class InboxQueryDto {
  /** `nextCursor` of the previous page (a notification id). */
  @IsOptional()
  @IsString()
  @Matches(UUID, { message: 'cursor must be a notification id' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class KindPreferenceDto {
  @IsIn(NOTIFICATION_KINDS)
  kind!: NotificationKind;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FEWER_LEVEL)
  fewerLevel?: number;
}

/**
 * PUT /me/notification-preferences. Every field is optional; `null`
 * resets `pushDailyCap` / `reminderMinute` to their defaults (2/day;
 * learned session time, fallback 20:00).
 */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAILY_PUSH_CAP)
  pushDailyCap?: number | null;

  @IsOptional()
  @IsBoolean()
  pushWeeklyOptIn?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  reminderMinute?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_KINDS.length)
  @ValidateNested({ each: true })
  @Type(() => KindPreferenceDto)
  kinds?: KindPreferenceDto[];
}

export interface InboxItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  deepLink: string | null;
  action: NotificationAction | null;
  createdAt: string;
  readAt: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  /** Pass as `cursor` for the next (older) page; null at the end. */
  nextCursor: string | null;
}

export interface KindPreferenceView {
  kind: NotificationKind;
  pushEnabled: boolean;
  emailEnabled: boolean;
  fewerLevel: number;
  /** SYSTEM / BILLING: push + email can't be turned off. */
  locked: boolean;
  /** Which channels this kind uses at all. */
  channels: { push: boolean; email: boolean };
}

export interface NotificationPreferencesView {
  /** Null = default (2/day). 0 = no non-SYSTEM push. */
  pushDailyCap: number | null;
  pushWeeklyOptIn: boolean;
  /** Daily-quest reminder, user-local minutes; null = learned / 20:00. */
  reminderMinute: number | null;
  kinds: KindPreferenceView[];
}
