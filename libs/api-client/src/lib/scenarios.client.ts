import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type {
  RewardResult,
  CompletedQuest,
  UnlockedBadge,
} from './progress.client.js';

export interface ScenarioChoice {
  id: string;
  label: string;
  to?: string;
  ending?: boolean;
  outcome?: string;
}
export interface ScenarioNode {
  id: string;
  speaker?: string;
  text: string;
  choices: ScenarioChoice[];
}
export interface ScenarioGraph {
  startId: string;
  nodes: Record<string, ScenarioNode>;
}

export interface StudentScenario {
  id: string;
  lessonId: string;
  graph: ScenarioGraph;
  alreadyCompleted: boolean;
}

export interface CompleteResult {
  runId: string;
  completed: boolean;
  depth: number;
  outcome?: string;
  path: string[];
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

export interface AdminScenario {
  id: string;
  graphJson: ScenarioGraph;
}

@Injectable({ providedIn: 'root' })
export class ScenariosClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  // Student
  forLesson(lessonId: string): Promise<StudentScenario> {
    return firstValueFrom(
      this.http.get<StudentScenario>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/scenario`,
      ),
    );
  }
  complete(id: string, path: string[]): Promise<CompleteResult> {
    return firstValueFrom(
      this.http.post<CompleteResult>(
        `${this.base}/scenarios/${encodeURIComponent(id)}/complete`,
        { path },
        { context: withIdempotency() },
      ),
    );
  }

  // Admin
  create(lessonId: string, graph: ScenarioGraph): Promise<AdminScenario> {
    return firstValueFrom(
      this.http.post<AdminScenario>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/scenario`,
        { graph },
        { context: withIdempotency() },
      ),
    );
  }
  update(id: string, graph: ScenarioGraph): Promise<AdminScenario> {
    return firstValueFrom(
      this.http.patch<AdminScenario>(
        `${this.base}/scenarios/${encodeURIComponent(id)}`,
        { graph },
        { context: withIdempotency() },
      ),
    );
  }
  getByLesson(lessonId: string): Promise<AdminScenario | null> {
    return firstValueFrom(
      this.http.get<AdminScenario | null>(
        `${this.base}/lessons/${encodeURIComponent(lessonId)}/scenario/admin`,
      ),
    );
  }
}
