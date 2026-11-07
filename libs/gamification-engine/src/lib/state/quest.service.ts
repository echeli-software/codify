import { Injectable, computed, signal } from '@angular/core';

/** Structural mirror of the API's `QuestView` (docs/07 §8). */
export interface QuestState {
  id: string;
  kind: string;
  title: string;
  target: number;
  progress: number;
  completed: boolean;
  xpReward: number;
  coinReward: number;
  slug?: string;
  templateId?: string;
  difficulty?: number;
}

/**
 * Mirrors today's daily quests. The server owns progress; this service
 * holds the latest snapshot (`set`) and applies per-quest updates that come
 * back with reward responses (`applyProgress`). Completion celebrations go
 * through `RewardOrchestrator.grant({ kind: 'dailyQuestComplete' })`.
 */
@Injectable({ providedIn: 'root' })
export class QuestService {
  private readonly questsSig = signal<readonly QuestState[]>([]);

  readonly quests = this.questsSig.asReadonly();
  readonly completedCount = computed(
    () => this.questsSig().filter((q) => q.completed).length,
  );
  readonly allComplete = computed(
    () =>
      this.questsSig().length > 0 && this.questsSig().every((q) => q.completed),
  );
  /** Overall progress across quests, 0–100. */
  readonly progressPct = computed(() => {
    const qs = this.questsSig();
    if (qs.length === 0) return 0;
    const sum = qs.reduce(
      (acc, q) => acc + Math.min(1, q.target > 0 ? q.progress / q.target : 1),
      0,
    );
    return Math.round((sum / qs.length) * 100);
  });

  /** Replace the snapshot (e.g. after `GET /api/quests/today`). */
  set(quests: readonly QuestState[]): void {
    this.questsSig.set(quests.map(normalize));
  }

  /**
   * Merge server-reported progress for some quests. Returns the quests
   * that flipped to completed in this update (for the orchestrator).
   */
  applyProgress(
    updates: readonly (Pick<QuestState, 'id'> & Partial<QuestState>)[],
  ): QuestState[] {
    const byId = new Map(updates.map((u) => [u.id, u]));
    const newlyCompleted: QuestState[] = [];
    this.questsSig.update((qs) =>
      qs.map((q) => {
        const u = byId.get(q.id);
        if (!u) return q;
        const next = normalize({ ...q, ...u });
        if (!q.completed && next.completed) newlyCompleted.push(next);
        return next;
      }),
    );
    return newlyCompleted;
  }

  clear(): void {
    this.questsSig.set([]);
  }
}

function normalize(q: QuestState): QuestState {
  const target = Math.max(0, Math.floor(q.target));
  const progress = Math.max(0, Math.min(target, Math.floor(q.progress)));
  return {
    ...q,
    target,
    progress,
    completed: q.completed || progress >= target,
  };
}
