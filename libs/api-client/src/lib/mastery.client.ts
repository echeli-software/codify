import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

export type MasteryLevel = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
export type SkillNodeState =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'AVAILABLE'
  | 'LOCKED';

export interface SkillNode {
  moduleId: string;
  order: number;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  state: SkillNodeState;
  /** The module that unlocks this one (LOCKED nodes only). */
  prerequisiteModuleId: string | null;
}

export interface MasteryCourse {
  courseId: string;
  slug: string;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  scorePct: number | null;
  mastery: MasteryLevel;
  nodes: SkillNode[];
}

export interface MasteryTopic {
  /** Category id; null groups courses without a category. */
  categoryId: string | null;
  slug: string | null;
  name: string | null;
  iconName: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** Average best quiz / exercise score; null when nothing is graded yet. */
  scorePct: number | null;
  mastery: MasteryLevel;
  courses: MasteryCourse[];
}

export interface MasteryView {
  topics: MasteryTopic[];
  totals: Record<MasteryLevel, number>;
}

/** Typed client for `GET /me/mastery` (skill tree, docs/10 §7). */
@Injectable({ providedIn: 'root' })
export class MasteryClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  mastery(): Promise<MasteryView> {
    return firstValueFrom(
      this.http.get<MasteryView>(`${this.config.baseUrl}/me/mastery`),
    );
  }
}
