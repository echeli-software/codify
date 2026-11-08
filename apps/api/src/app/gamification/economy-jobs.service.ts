import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { currentWeekStart, localDateKey, settleStreak } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { NotificationService } from '../notifications/notification.service.js';
import { recordServerEvent } from '../notifications/server-analytics.js';
import { marketingBirthDateCutoffDate } from '../notifications/marketing-audience.js';
import { promoEmailCopy } from '../email/copy.js';
import { GamificationService, toStreakState } from './gamification.service.js';
import { ENGAGEMENT_CRONS, jobsEnabled } from './jobs.js';

const DEFAULT_TZ = 'America/Sao_Paulo';
const BATCH = 500;
/** A promo that started more than this long ago is no longer announced. */
const PROMO_ANNOUNCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface StreakSettleSummary {
  scanned: number;
  frozen: number;
  lost: number;
}

export interface BonusPayoutSummary {
  pools: number;
  paid: number;
  coins: number;
}

export interface PromoAnnounceSummary {
  promotions: number;
  /** Users who got the inbox entry + push. */
  notified: number;
  /** Campaign emails sent. */
  emailed: number;
}

/**
 * Scheduled economy jobs (all idempotent, behind `jobsEnabled()`):
 *   - streak settlement (hourly): applies banked freezes to missed days and
 *     resets lost streaks to 0 (docs/07 §6), so every reader of the Streak
 *     row — profile, leaderboards, recap, reminders — sees the real count;
 *   - weekly bonus pool payout (hourly; acts once a week has closed): pays
 *     the coins the daily caps held back as WEEKLY_BONUS (docs/07 §5);
 *   - PROMO announcements (every 15 min): a campaign / course promo that
 *     just started notifies the adults who opted into PROMO push (default
 *     off, docs/10 §3) and emails those who gave marketing-email consent.
 */
@Injectable()
export class EconomyJobsService {
  private readonly logger = new Logger(EconomyJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── Streak settlement ─────────────────────────────────────────────────

  /**
   * Settle every live streak whose last covered day is before the user's
   * local yesterday. A conditional update (on the values read) makes a
   * concurrent lesson completion win: the job then simply skips the row.
   */
  async settleStreaks(now: Date = new Date()): Promise<StreakSettleSummary> {
    // No zone is more than 14 h ahead of UTC, so "before local yesterday"
    // implies "before UTC today" — a cheap superset; the pure rule decides.
    const utcToday = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    let scanned = 0;
    let frozen = 0;
    let lost = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.streak.findMany({
        where: { currentDays: { gt: 0 }, lastActivityDate: { lt: utcToday } },
        include: { user: { select: { timezone: true } } },
        orderBy: { userId: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        scanned += 1;
        const today = localDateKey(now, row.user.timezone || DEFAULT_TZ);
        const s = settleStreak(toStreakState(row), today);
        if (!s.changed) continue;
        const res = await this.prisma.streak.updateMany({
          where: {
            userId: row.userId,
            currentDays: row.currentDays,
            freezesAvailable: row.freezesAvailable,
            lastActivityDate: row.lastActivityDate,
          },
          data: {
            currentDays: s.currentDays,
            freezesAvailable: s.freezesAvailable,
            lastActivityDate: new Date(`${s.lastActivityKey}T00:00:00Z`),
          },
        });
        if (res.count === 0) continue; // the user was active meanwhile
        if (s.freezesUsed > 0) {
          frozen += 1;
          await recordServerEvent(
            this.prisma,
            row.userId,
            'streak_freeze_used',
            {
              days: s.currentDays,
              freezesLeft: s.freezesAvailable,
              used: s.freezesUsed,
            },
            now,
          );
        }
        if (s.lost) {
          lost += 1;
          await recordServerEvent(
            this.prisma,
            row.userId,
            'streak_lost',
            { days: row.currentDays, freezesLeft: 0 },
            now,
          );
        }
      }
      cursor = rows[rows.length - 1].userId;
      if (rows.length < BATCH) break;
    }
    return { scanned, frozen, lost };
  }

  @Cron(ENGAGEMENT_CRONS.streakSettle, {
    name: 'runScheduledStreakSettle',
    timeZone: 'UTC',
  })
  async runScheduledStreakSettle(): Promise<StreakSettleSummary | null> {
    if (!jobsEnabled()) return null;
    return this.guard('streak settlement', () => this.settleStreaks());
  }

  // ─── Weekly bonus pool ──────────────────────────────────────────────────

  /**
   * Pay every unpaid CoinBonusPool of a closed week (weekStart before the
   * current UTC week) as a WEEKLY_BONUS grant. Stamping `paidAt` with a
   * conditional update in the grant's transaction makes reruns and
   * concurrent replicas pay each pool once.
   */
  async payWeeklyBonusPools(
    now: Date = new Date(),
  ): Promise<BonusPayoutSummary> {
    const before = currentWeekStart(now);
    const pools = await this.prisma.coinBonusPool.findMany({
      where: { paidAt: null, weekStart: { lt: before } },
      orderBy: [{ weekStart: 'asc' }, { userId: 'asc' }],
      take: 5000,
    });
    let paid = 0;
    let coins = 0;
    for (const p of pools) {
      const out = await this.prisma.$transaction(async (tx) => {
        const stamp = await tx.coinBonusPool.updateMany({
          where: { userId: p.userId, weekStart: p.weekStart, paidAt: null },
          data: { paidAt: now },
        });
        if (stamp.count === 0 || p.coins <= 0) return 0;
        const r = await this.gamification.grantReward(
          {
            userId: p.userId,
            baseXp: 0,
            baseCoins: p.coins,
            xpSource: 'ADMIN_GRANT',
            coinSource: 'WEEKLY_BONUS',
            refType: 'weekly_bonus',
            refId: p.weekStart.toISOString(),
            idempotencyKey: `weekly_bonus:${p.userId}:${p.weekStart.toISOString()}`,
            flat: true,
            uncapped: true,
          },
          tx,
        );
        return r.coins;
      });
      if (out > 0) {
        paid += 1;
        coins += out;
      }
    }
    return { pools: pools.length, paid, coins };
  }

  @Cron(ENGAGEMENT_CRONS.weeklyBonusPayout, {
    name: 'runScheduledBonusPayout',
    timeZone: 'UTC',
  })
  async runScheduledBonusPayout(): Promise<BonusPayoutSummary | null> {
    if (!jobsEnabled()) return null;
    return this.guard('weekly bonus payout', () => this.payWeeklyBonusPools());
  }

  // ─── PROMO announcements ────────────────────────────────────────────────

  /**
   * Announce campaigns and course promos that started within the last 24 h:
   *   - inbox entry + push to users who turned PROMO push on (off by
   *     default);
   *   - the campaign email to users with `marketingEmailOptIn` whose PROMO
   *     email is not switched off.
   * Known adults only (a date of birth 18+ years ago; no date → nothing).
   * Each channel is claimed once per (promotion, user) on its own
   * IdempotencyRecord (`promo_announce:` / `promo_email:`), so reruns and
   * replicas never repeat it; a failed email releases its claim for the
   * next run. Push rules (quiet hours, caps) apply in PushService, the
   * campaign email caps and consent check in NotificationService.
   */
  async announcePromotions(
    now: Date = new Date(),
  ): Promise<PromoAnnounceSummary> {
    const since = new Date(now.getTime() - PROMO_ANNOUNCE_WINDOW_MS);
    const promos = await this.prisma.multiplier.findMany({
      where: {
        isActive: true,
        userId: null,
        kind: { in: ['CAMPAIGN', 'COURSE_PROMO'] },
        AND: [
          {
            OR: [
              { startsAt: { gte: since, lte: now } },
              { startsAt: null, createdAt: { gte: since, lte: now } },
            ],
          },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    });
    let notified = 0;
    let emailed = 0;
    const adultCutoff = marketingBirthDateCutoffDate(now);
    for (const promo of promos) {
      // Course titles live in ContentTranslation (one row per locale).
      const titles = promo.courseId
        ? new Map(
            (
              await this.prisma.contentTranslation.findMany({
                where: {
                  entityType: 'COURSE',
                  entityId: promo.courseId,
                  field: 'title',
                },
                select: { locale: true, value: true },
              })
            ).map((t) => [t.locale, t.value]),
          )
        : null;
      const titleFor = (locale: string) =>
        titles ? (titles.get(locale) ?? [...titles.values()][0] ?? null) : null;
      let cursor: string | undefined;
      for (;;) {
        const users = await this.prisma.user.findMany({
          where: {
            deletedAt: null,
            dormantAt: null,
            suspendedAt: null,
            // Adults only; a null birthDate never matches (fail closed).
            birthDate: { lte: adultCutoff },
            OR: [
              {
                notificationPrefs: {
                  some: { kind: 'PROMO', pushEnabled: true },
                },
              },
              {
                marketingEmailOptIn: true,
                notificationPrefs: {
                  none: { kind: 'PROMO', emailEnabled: false },
                },
              },
            ],
          },
          select: {
            id: true,
            timezone: true,
            marketingEmailOptIn: true,
            notificationPrefs: {
              where: { kind: 'PROMO' },
              select: { pushEnabled: true, emailEnabled: true },
            },
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (users.length === 0) break;
        const value = Number(promo.value);
        const deepLink = promo.kind === 'COURSE_PROMO' ? '/catalog' : '/today';
        for (const u of users) {
          const pref = u.notificationPrefs?.[0];
          const wantsPush = pref?.pushEnabled === true;
          const wantsEmail =
            u.marketingEmailOptIn && (pref?.emailEnabled ?? true);
          if (
            wantsPush &&
            (await this.claim(`promo_announce:${promo.id}:${u.id}`, u.id))
          ) {
            const res = await this.notifications.notify(
              u.id,
              ({ locale }) => ({
                kind: 'PROMO',
                ...promoCopy(locale, {
                  value,
                  target: promo.target,
                  courseTitle: titleFor(locale),
                  endsAt: promo.endsAt,
                }),
                deepLink,
                action: null,
                data: {
                  type: 'promo',
                  multiplierId: promo.id,
                  promoKind: promo.kind,
                },
              }),
              { now, channels: { email: false } },
            );
            if (res.status === 'ok') notified += 1;
          }
          const emailKey = `promo_email:${promo.id}:${u.id}`;
          if (wantsEmail && (await this.claim(emailKey, u.id, 'promo_email'))) {
            const res = await this.notifications.notify(
              u.id,
              ({ locale }) => {
                const c = promoEmailCopy(locale, {
                  value,
                  target: promo.target,
                  courseTitle: titleFor(locale),
                  endsAt: promo.endsAt,
                  timezone: u.timezone,
                });
                return {
                  kind: 'PROMO',
                  title: c.title,
                  body: c.body,
                  emailLines: c.lines,
                  deepLink,
                  action: null,
                };
              },
              { now, channels: { inApp: false, push: false, email: true } },
            );
            if (res.email.status === 'sent') emailed += 1;
            else if (res.email.status === 'error') await this.release(emailKey);
          }
        }
        cursor = users[users.length - 1].id;
        if (users.length < BATCH) break;
      }
    }
    return { promotions: promos.length, notified, emailed };
  }

  @Cron(ENGAGEMENT_CRONS.promoAnnouncements, {
    name: 'runScheduledPromoAnnouncements',
    timeZone: 'UTC',
  })
  async runScheduledPromoAnnouncements(): Promise<PromoAnnounceSummary | null> {
    if (!jobsEnabled()) return null;
    return this.guard('promo announcements', () => this.announcePromotions());
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async claim(
    key: string,
    userId: string,
    scope = 'promo_announce',
  ): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key, scope, userId },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  /** Give a claim back (the send failed) so the next run retries it. */
  private async release(key: string): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.deleteMany({ where: { key } });
    } catch (err) {
      this.logger.warn(`promo claim release failed: ${(err as Error).message}`);
    }
  }

  private async guard<T extends object>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      const res = await fn();
      this.logger.log(`${name}: ${JSON.stringify(res)}`);
      return res;
    } catch (err) {
      this.logger.error(`${name} failed: ${(err as Error).message}`);
      return null;
    }
  }
}

/** PROMO copy (pt-BR / en-US). */
export function promoCopy(
  locale: string,
  p: {
    value: number;
    target: 'XP' | 'COINS' | 'BOTH';
    courseTitle: string | null;
    endsAt: Date | null;
  },
): { title: string; body: string } {
  const pt = locale.startsWith('pt');
  const v = `${Math.round(p.value * 100) / 100}x`;
  const what =
    p.target === 'XP'
      ? 'XP'
      : p.target === 'COINS'
        ? pt
          ? 'moedas'
          : 'coins'
        : pt
          ? 'XP e moedas'
          : 'XP and coins';
  const title = p.courseTitle
    ? pt
      ? `${v} ${what} em ${p.courseTitle}`
      : `${v} ${what} on ${p.courseTitle}`
    : pt
      ? `Evento: ${v} ${what}!`
      : `Event: ${v} ${what}!`;
  // The end time is shown in the app banner, in the user's own zone.
  const body = p.endsAt
    ? pt
      ? 'Por tempo limitado — aproveite!'
      : 'For a limited time — make the most of it!'
    : pt
      ? 'Aproveite enquanto durar.'
      : 'Make the most of it while it lasts.';
  return { title, body };
}
