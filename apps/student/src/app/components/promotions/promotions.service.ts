import { Injectable, computed, inject, signal } from '@angular/core';
import { GamificationClient, type Multiplier } from '@codify/api-client';

/** How long the active-promotions list is reused before refetching. */
export const PROMOTIONS_TTL_MS = 5 * 60_000;

/**
 * The course / lesson promos and campaigns running now (GET
 * /multipliers/active), shared by the catalog corner badges, the lesson
 * header badge and the campaign top banner (docs/07 §3 "Promotional UX").
 * One request per 5 minutes however many badges are on screen; failures
 * just mean "no badges".
 */
@Injectable({ providedIn: 'root' })
export class PromotionsService {
  private readonly client = inject(GamificationClient);
  private readonly list = signal<Multiplier[]>([]);
  private loadedAt = 0;
  private inflight: Promise<void> | null = null;

  readonly active = this.list.asReadonly();

  /** The highest running CAMPAIGN (top banner). */
  readonly campaign = computed(() =>
    pickMax(this.list().filter((m) => m.kind === 'CAMPAIGN' && isRunning(m))),
  );

  /** Fetch if stale; safe to call from every badge. */
  ensureLoaded(now = Date.now()): Promise<void> {
    if (now - this.loadedAt < PROMOTIONS_TTL_MS) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.client
      .activePromotions()
      .then((rows) => {
        this.list.set(rows);
        this.loadedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => (this.inflight = null));
    return this.inflight;
  }

  /** The promo for a lesson (lesson promo wins over its course's, like the resolver). */
  promoFor(
    courseId: string | null,
    lessonId: string | null,
  ): Multiplier | null {
    const rows = this.list().filter(isRunning);
    const lesson = lessonId
      ? pickMax(
          rows.filter(
            (m) => m.kind === 'LESSON_PROMO' && m.lessonId === lessonId,
          ),
        )
      : null;
    if (lesson) return lesson;
    return courseId
      ? pickMax(
          rows.filter(
            (m) => m.kind === 'COURSE_PROMO' && m.courseId === courseId,
          ),
        )
      : null;
  }
}

function isRunning(m: Multiplier, now = Date.now()): boolean {
  if (!m.isActive) return false;
  if (m.startsAt && Date.parse(m.startsAt) > now) return false;
  if (m.endsAt && Date.parse(m.endsAt) < now) return false;
  return m.value > 1;
}

function pickMax(rows: Multiplier[]): Multiplier | null {
  return rows.reduce<Multiplier | null>(
    (best, m) => (!best || m.value > best.value ? m : best),
    null,
  );
}

/** i18n key for what a multiplier boosts. */
export function promoTargetKey(m: Pick<Multiplier, 'target'>): string {
  return m.target === 'XP'
    ? 'gamification.promo.xp'
    : m.target === 'COINS'
      ? 'gamification.promo.coins'
      : 'gamification.promo.both';
}

/** "4" / "1.5" — the factor as shown on badges. */
export function promoValue(m: Pick<Multiplier, 'value'>): string {
  return String(Math.round(m.value * 100) / 100);
}
