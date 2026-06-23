import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { RewardResult, CompletedQuest, UnlockedBadge } from './progress.client.js';

export interface RubricCriterion {
  id: string;
  label: string;
  weight: number;
  kind: 'keyword' | 'regex' | 'minWords' | 'maxWords' | 'llm';
  config?: Record<string, unknown>;
}

export interface CriterionResult {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  detail?: string;
}

export interface StudentAiPrompt {
  id: string;
  lessonId: string;
  promptText: string;
  contextText: string | null;
  passThreshold: number;
  maxAttempts: number;
  attemptsUsed: number;
  alreadyPassed: boolean;
  rubric: { id: string; label: string; weight: number }[];
}

export interface GradeResult {
  submissionId: string;
  scorePct: number;
  passed: boolean;
  gradedBy: 'HEURISTIC' | 'LLM';
  cached: boolean;
  results: CriterionResult[];
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

export interface AdminAiPrompt {
  id: string;
  promptText: string;
  contextText: string | null;
  rubricJson: RubricCriterion[];
  passThreshold: number;
  maxAttempts: number;
}

export interface AiPromptBody {
  promptText: string;
  contextText?: string | null;
  rubric: RubricCriterion[];
  passThreshold?: number;
  maxAttempts?: number;
}

@Injectable({ providedIn: 'root' })
export class AiPromptsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  // Student
  forLesson(lessonId: string): Promise<StudentAiPrompt> {
    return firstValueFrom(this.http.get<StudentAiPrompt>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/ai-prompt`));
  }
  submit(id: string, response: string): Promise<GradeResult> {
    return firstValueFrom(this.http.post<GradeResult>(`${this.base}/ai-prompts/${encodeURIComponent(id)}/submit`, { response }, { context: withIdempotency() }));
  }

  // Admin
  create(lessonId: string, body: AiPromptBody): Promise<AdminAiPrompt> {
    return firstValueFrom(this.http.post<AdminAiPrompt>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/ai-prompt`, body, { context: withIdempotency() }));
  }
  update(id: string, body: Partial<AiPromptBody>): Promise<AdminAiPrompt> {
    return firstValueFrom(this.http.patch<AdminAiPrompt>(`${this.base}/ai-prompts/${encodeURIComponent(id)}`, body, { context: withIdempotency() }));
  }
  getByLesson(lessonId: string): Promise<AdminAiPrompt | null> {
    return firstValueFrom(this.http.get<AdminAiPrompt | null>(`${this.base}/lessons/${encodeURIComponent(lessonId)}/ai-prompt/admin`));
  }
  preview(id: string, response: string): Promise<{ scorePct: number; passed: boolean; results: CriterionResult[] }> {
    return firstValueFrom(this.http.post<{ scorePct: number; passed: boolean; results: CriterionResult[] }>(`${this.base}/ai-prompts/${encodeURIComponent(id)}/preview`, { response }, { context: withIdempotency() }));
  }
}
