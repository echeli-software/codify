import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { StreakInfo } from './progress.client.js';

export type QuestKind =
  | 'LESSON_COUNT'
  | 'CATEGORY_LESSON_COUNT'
  | 'XP_AMOUNT'
  | 'STREAK_MAINTAIN'
  | 'EXERCISE_PASS';

export interface GamificationSummary {
  totalXp: number;
  level: number;
  coins: number;
  streak: StreakInfo;
}

export interface QuestView {
  id: string;
  templateId: string;
  slug: string;
  kind: QuestKind;
  title: string;
  target: number;
  progress: number;
  completed: boolean;
  xpReward: number;
  coinReward: number;
  difficulty: number;
}

export interface QuestTemplate {
  id: string;
  slug: string;
  kind: QuestKind;
  title: string;
  difficulty: number;
  target: number;
  paramsJson: Record<string, unknown> | null;
  xpReward: number;
  coinReward: number;
  isActive: boolean;
}

export interface BadgeView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconName: string | null;
  earned: boolean;
  awardedAt: string | null;
}

export interface BadgeDef {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconName: string | null;
  rule: Record<string, unknown>;
  xpReward: number;
  coinReward: number;
  isHidden: boolean;
  isActive: boolean;
}

export interface CreateQuestTemplateBody {
  slug: string;
  kind: QuestKind;
  title: string;
  difficulty?: number;
  target: number;
  paramsJson?: Record<string, unknown>;
  xpReward?: number;
  coinReward?: number;
  isActive?: boolean;
}

export interface CreateBadgeBody {
  slug: string;
  name: string;
  description?: string;
  iconName?: string;
  rule: Record<string, unknown>;
  xpReward?: number;
  coinReward?: number;
  isHidden?: boolean;
  isActive?: boolean;
}

export type MultiplierKind =
  | 'PREMIUM_DEFAULT'
  | 'COURSE_PROMO'
  | 'LESSON_PROMO'
  | 'STREAK_TIER'
  | 'CAMPAIGN';
export type MultiplierTarget = 'XP' | 'COINS' | 'BOTH';

export interface Multiplier {
  id: string;
  kind: MultiplierKind;
  target: MultiplierTarget;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  courseId: string | null;
  lessonId: string | null;
  streakDaysMin: number | null;
  description: string | null;
  isActive: boolean;
  /** Enabled and inside its [startsAt, endsAt] window right now. */
  activeNow: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListMultipliersQuery {
  /** `now` → only rules enabled and inside their window right now. */
  active?: 'now';
  kind?: MultiplierKind;
}

export interface RewardAmount {
  xp: number;
  coins: number;
}

/** Admin-editable gamification knobs (GET/PUT /admin/gamification/config). */
export interface GamificationConfigValues {
  'multiplier.cap': number;
  'billing.pastDueGraceDays': number;
  'streak.freezeCap': number;
  'streak.milestones': Record<string, RewardAmount>;
  'league.promotionReward': RewardAmount & { freeze: number };
  'league.rank1Reward': RewardAmount;
  'quest.dailyCount': number;
  'referral.reward': RewardAmount;
  'referral.claimWindowDays': number;
}

export type GamificationConfigKey = keyof GamificationConfigValues;

export interface GamificationConfigEntry<
  K extends GamificationConfigKey = GamificationConfigKey,
> {
  key: K;
  value: GamificationConfigValues[K];
  defaultValue: GamificationConfigValues[K];
  /** True when no valid override is stored (the default is in effect). */
  isDefault: boolean;
  updatedAt: string | null;
}

/** PUT body: any subset of keys; `null` resets a key to its default. */
export type GamificationConfigPatch = {
  [K in GamificationConfigKey]?: GamificationConfigValues[K] | null;
};

export interface CreateMultiplierBody {
  kind: MultiplierKind;
  target?: MultiplierTarget;
  value: number;
  startsAt?: string | null;
  endsAt?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  streakDaysMin?: number | null;
  description?: string | null;
  isActive?: boolean;
}

/** Typed client for /api/gamification, /api/quests*, /api/badges. */
@Injectable({ providedIn: 'root' })
export class GamificationClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  summary(): Promise<GamificationSummary> {
    return firstValueFrom(
      this.http.get<GamificationSummary>(`${this.base}/gamification/summary`),
    );
  }

  questsToday(): Promise<QuestView[]> {
    return firstValueFrom(
      this.http.get<QuestView[]>(`${this.base}/quests/today`),
    );
  }

  badges(): Promise<BadgeView[]> {
    return firstValueFrom(this.http.get<BadgeView[]>(`${this.base}/badges`));
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  listQuestTemplates(includeInactive = true): Promise<QuestTemplate[]> {
    const params = new HttpParams().set(
      'includeInactive',
      String(includeInactive),
    );
    return firstValueFrom(
      this.http.get<QuestTemplate[]>(`${this.base}/quest-templates`, {
        params,
      }),
    );
  }

  createQuestTemplate(body: CreateQuestTemplateBody): Promise<QuestTemplate> {
    return firstValueFrom(
      this.http.post<QuestTemplate>(`${this.base}/quest-templates`, body, {
        context: withIdempotency(),
      }),
    );
  }

  updateQuestTemplate(
    id: string,
    body: Partial<CreateQuestTemplateBody>,
  ): Promise<QuestTemplate> {
    return firstValueFrom(
      this.http.patch<QuestTemplate>(
        `${this.base}/quest-templates/${encodeURIComponent(id)}`,
        body,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  deleteQuestTemplate(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/quest-templates/${encodeURIComponent(id)}`,
      ),
    );
  }

  listBadges(includeInactive = true): Promise<BadgeDef[]> {
    const params = new HttpParams().set(
      'includeInactive',
      String(includeInactive),
    );
    return firstValueFrom(
      this.http.get<BadgeDef[]>(`${this.base}/badges/manage`, { params }),
    );
  }

  createBadge(body: CreateBadgeBody): Promise<BadgeDef> {
    return firstValueFrom(
      this.http.post<BadgeDef>(`${this.base}/badges`, body, {
        context: withIdempotency(),
      }),
    );
  }

  updateBadge(id: string, body: Partial<CreateBadgeBody>): Promise<BadgeDef> {
    return firstValueFrom(
      this.http.patch<BadgeDef>(
        `${this.base}/badges/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  deleteBadge(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/badges/${encodeURIComponent(id)}`),
    );
  }

  /** ADMIN. `{ active: 'now' }` for the Promotions screen's "running now". */
  listMultipliers(query: ListMultipliersQuery = {}): Promise<Multiplier[]> {
    let params = new HttpParams();
    if (query.active) params = params.set('active', query.active);
    if (query.kind) params = params.set('kind', query.kind);
    return firstValueFrom(
      this.http.get<Multiplier[]>(`${this.base}/multipliers`, { params }),
    );
  }

  /** Any signed-in user: promos/campaigns running now (banners, catalog badges). */
  activePromotions(): Promise<Multiplier[]> {
    return firstValueFrom(
      this.http.get<Multiplier[]>(`${this.base}/multipliers/active`),
    );
  }

  /** ADMIN: every known config key with its value and default. */
  getConfig(): Promise<GamificationConfigEntry[]> {
    return firstValueFrom(
      this.http.get<GamificationConfigEntry[]>(
        `${this.base}/admin/gamification/config`,
      ),
    );
  }

  /** ADMIN: validate + save a subset of keys (null resets). Returns the full list. */
  updateConfig(
    patch: GamificationConfigPatch,
  ): Promise<GamificationConfigEntry[]> {
    return firstValueFrom(
      this.http.put<GamificationConfigEntry[]>(
        `${this.base}/admin/gamification/config`,
        patch,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  createMultiplier(body: CreateMultiplierBody): Promise<Multiplier> {
    return firstValueFrom(
      this.http.post<Multiplier>(`${this.base}/multipliers`, body, {
        context: withIdempotency(),
      }),
    );
  }

  updateMultiplier(
    id: string,
    body: Partial<CreateMultiplierBody>,
  ): Promise<Multiplier> {
    return firstValueFrom(
      this.http.patch<Multiplier>(
        `${this.base}/multipliers/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  deleteMultiplier(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/multipliers/${encodeURIComponent(id)}`,
      ),
    );
  }
}
