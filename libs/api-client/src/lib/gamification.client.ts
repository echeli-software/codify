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

/** Typed client for /api/gamification, /api/quests*, /api/badges. */
@Injectable({ providedIn: 'root' })
export class GamificationClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  summary(): Promise<GamificationSummary> {
    return firstValueFrom(this.http.get<GamificationSummary>(`${this.base}/gamification/summary`));
  }

  questsToday(): Promise<QuestView[]> {
    return firstValueFrom(this.http.get<QuestView[]>(`${this.base}/quests/today`));
  }

  badges(): Promise<BadgeView[]> {
    return firstValueFrom(this.http.get<BadgeView[]>(`${this.base}/badges`));
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  listQuestTemplates(includeInactive = true): Promise<QuestTemplate[]> {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return firstValueFrom(this.http.get<QuestTemplate[]>(`${this.base}/quest-templates`, { params }));
  }

  createQuestTemplate(body: CreateQuestTemplateBody): Promise<QuestTemplate> {
    return firstValueFrom(
      this.http.post<QuestTemplate>(`${this.base}/quest-templates`, body, { context: withIdempotency() }),
    );
  }

  updateQuestTemplate(id: string, body: Partial<CreateQuestTemplateBody>): Promise<QuestTemplate> {
    return firstValueFrom(
      this.http.patch<QuestTemplate>(`${this.base}/quest-templates/${encodeURIComponent(id)}`, body, {
        context: withIdempotency(),
      }),
    );
  }

  deleteQuestTemplate(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/quest-templates/${encodeURIComponent(id)}`));
  }

  listBadges(includeInactive = true): Promise<BadgeDef[]> {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return firstValueFrom(this.http.get<BadgeDef[]>(`${this.base}/badges/manage`, { params }));
  }

  createBadge(body: CreateBadgeBody): Promise<BadgeDef> {
    return firstValueFrom(this.http.post<BadgeDef>(`${this.base}/badges`, body, { context: withIdempotency() }));
  }

  updateBadge(id: string, body: Partial<CreateBadgeBody>): Promise<BadgeDef> {
    return firstValueFrom(
      this.http.patch<BadgeDef>(`${this.base}/badges/${encodeURIComponent(id)}`, body, { context: withIdempotency() }),
    );
  }

  deleteBadge(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/badges/${encodeURIComponent(id)}`));
  }
}
