import { Injectable, computed, signal } from '@angular/core';

/** Structural mirror of the API's `LeagueMember`. */
export interface LeagueMemberState {
  userId: string;
  displayName: string;
  weeklyXp: number;
  level: number;
  rank: number;
  isMe: boolean;
}

/** Structural mirror of the API's `CurrentLeague` (docs/07 §9). */
export interface LeagueState {
  tier: string;
  weekStart: string;
  resetAt: string;
  promoteCount: number;
  demoteCount: number;
  cohortSize: number;
  myRank: number;
  myWeeklyXp: number;
  members: readonly LeagueMemberState[];
}

export type LeagueZone = 'promote' | 'safe' | 'demote';

/** Zone for a 1-based rank given the cohort's promote/demote counts. */
export function zoneForRank(
  rank: number,
  cohortSize: number,
  promoteCount: number,
  demoteCount: number,
): LeagueZone {
  if (rank >= 1 && rank <= promoteCount) return 'promote';
  if (demoteCount > 0 && rank > cohortSize - demoteCount) return 'demote';
  return 'safe';
}

/**
 * Mirrors the user's weekly league cohort. Promotion/demotion results are
 * celebrated via `RewardOrchestrator.grant({ kind: 'leaguePromotion' })`;
 * this service only holds the latest server snapshot.
 */
@Injectable({ providedIn: 'root' })
export class LeagueService {
  private readonly leagueSig = signal<LeagueState | null>(null);

  readonly league = this.leagueSig.asReadonly();
  readonly members = computed(() =>
    [...(this.leagueSig()?.members ?? [])].sort((a, b) => a.rank - b.rank),
  );
  readonly me = computed(() => this.members().find((m) => m.isMe) ?? null);
  readonly myZone = computed<LeagueZone | null>(() => {
    const l = this.leagueSig();
    if (!l) return null;
    return zoneForRank(l.myRank, l.cohortSize, l.promoteCount, l.demoteCount);
  });

  set(league: LeagueState | null): void {
    this.leagueSig.set(league);
  }

  /** Optimistically bump my weekly XP after a reward (server re-ranks later). */
  addMyWeeklyXp(delta: number): void {
    const l = this.leagueSig();
    if (!l || !Number.isFinite(delta) || delta <= 0) return;
    this.leagueSig.set({
      ...l,
      myWeeklyXp: l.myWeeklyXp + delta,
      members: l.members.map((m) =>
        m.isMe ? { ...m, weeklyXp: m.weeklyXp + delta } : m,
      ),
    });
  }
}
