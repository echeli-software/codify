import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { reportException } from '../common/sentry.js';
import { NotificationService } from '../notifications/notification.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const TERMS_NOTICE_SCOPE = 'system_terms_notice';
/** Users claimed + notified per batch. */
export const TERMS_BATCH_SIZE = 200;
/** Notifications in flight at once inside a batch. */
const CONCURRENCY = 8;

export interface TermsAnnouncementView {
  version: string;
  /** Active accounts the notice is for (not deleted / suspended / purged). */
  audience: number;
  /** Accounts already notified for this version (all API instances). */
  notified: number;
  /** A run for this version is in progress on this API instance. */
  running: boolean;
}

/** SYSTEM copy (pt-* → pt-BR, else en-US). */
export function termsUpdateCopy(
  locale: string,
  effectiveDate: string | null,
): { title: string; body: string } {
  const pt = (locale || 'pt-BR').toLowerCase().startsWith('pt');
  const when = effectiveDate ? formatDay(effectiveDate, pt) : null;
  if (pt)
    return {
      title: 'Atualizamos nossos Termos de Uso',
      body: when
        ? `Os novos Termos de Uso e a Política de Privacidade valem a partir de ${when}. Leia as mudanças no app.`
        : 'Os Termos de Uso e a Política de Privacidade foram atualizados. Leia as mudanças no app.',
    };
  return {
    title: 'We updated our Terms of Use',
    body: when
      ? `The new Terms of Use and Privacy Policy apply from ${when}. Read what changed in the app.`
      : 'Our Terms of Use and Privacy Policy have been updated. Read what changed in the app.',
  };
}

function formatDay(iso: string, pt: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(pt ? 'pt-BR' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * SYSTEM announcements (docs/10 §3 "terms update"): a SYSTEM notification
 * (inbox + push + email — no caps, no quiet hours, can't be turned off) to
 * every active account, in batches. Each recipient is claimed first
 * (IdempotencyRecord `system_terms_notice:<version>:<userId>`), so a rerun
 * of the same version — after a restart, or on another instance — only
 * reaches the accounts not yet notified, and nobody gets it twice.
 */
@Injectable()
export class SystemNoticesService {
  private readonly logger = new Logger(SystemNoticesService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async status(version: string): Promise<TermsAnnouncementView> {
    const [audience, notified] = await Promise.all([
      this.prisma.user.count({ where: activeWhere() }),
      this.prisma.idempotencyRecord.count({
        where: { key: { startsWith: `${TERMS_NOTICE_SCOPE}:${version}:` } },
      }),
    ]);
    return {
      version,
      audience,
      notified,
      running: this.running.has(version),
    };
  }

  /**
   * Start (or resume) the announcement in the background and return the
   * current counts. 409 while a run for the version is already going here.
   */
  async announceTerms(
    version: string,
    effectiveDate: string | null,
  ): Promise<TermsAnnouncementView> {
    if (this.running.has(version))
      throw new ConflictException({
        code: 'ANNOUNCEMENT_RUNNING',
        message: `The terms update ${version} is already being sent`,
      });
    this.running.add(version);
    const view = await this.status(version);
    void this.run(version, effectiveDate)
      .catch((err) => {
        this.logger.error(
          `terms notice ${version} stopped: ${(err as Error).message}`,
        );
        reportException(err, { tags: { job: 'system-terms-notice' } });
      })
      .finally(() => this.running.delete(version));
    return { ...view, running: true };
  }

  /** Claim the recipient, then notify; false when someone else already did. */
  private async notifyOnce(
    userId: string,
    version: string,
    effectiveDate: string | null,
  ): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: `${TERMS_NOTICE_SCOPE}:${version}:${userId}`,
          scope: TERMS_NOTICE_SCOPE,
          userId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
    await this.notifications.notify(userId, ({ locale }) => ({
      kind: 'SYSTEM',
      ...termsUpdateCopy(locale, effectiveDate),
      deepLink: '/terms',
      action: null,
      data: { type: 'terms_update', version },
    }));
    return true;
  }

  /** Exposed for tests: the whole run, awaited. */
  async run(version: string, effectiveDate: string | null): Promise<number> {
    let cursor: string | undefined;
    let sent = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { ...activeWhere(), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: TERMS_BATCH_SIZE,
        select: { id: true },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;
      for (let i = 0; i < users.length; i += CONCURRENCY) {
        const results = await Promise.all(
          users
            .slice(i, i + CONCURRENCY)
            .map((u) => this.notifyOnce(u.id, version, effectiveDate)),
        );
        sent += results.filter(Boolean).length;
      }
      if (users.length < TERMS_BATCH_SIZE) break;
    }
    this.logger.log(`terms notice ${version}: ${sent} notified`);
    return sent;
  }
}

function activeWhere() {
  return { deletedAt: null, suspendedAt: null, purgedAt: null };
}
