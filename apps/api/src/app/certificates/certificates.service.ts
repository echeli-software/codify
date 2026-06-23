import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Certificate } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { formatSerial, isCourseComplete } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CertificateView {
  serial: string;
  recipientName: string;
  courseTitle: string;
  isCapstone: boolean;
  issuedAt: string;
  courseId: string;
}

export interface ReferralView {
  code: string;
  shareUrl: string;
  referredCount: number;
}

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issue (idempotently) a certificate when the user has completed the course. */
  async claim(userId: string, courseId: string): Promise<CertificateView> {
    const existing = await this.prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (existing) return this.toView(existing);

    const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course || course.status !== 'PUBLISHED') throw new NotFoundException('Course not found');

    const lessonIds = (
      await this.prisma.lesson.findMany({ where: { deletedAt: null, module: { courseId } }, select: { id: true } })
    ).map((l) => l.id);
    const completed = await this.prisma.progress.count({ where: { userId, lessonId: { in: lessonIds } } });
    if (!isCourseComplete(lessonIds.length, completed)) {
      throw new BadRequestException('Course is not complete yet');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    const courseTitle = await this.resolveCourseTitle(courseId, course.sourceLocale, course.slug);

    // Retry on the (tiny) chance of a serial collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const cert = await this.prisma.certificate.create({
          data: {
            userId,
            courseId,
            serial: this.newSerial(),
            recipientName: user.displayName,
            courseTitle,
            isCapstone: course.isCapstone,
          },
        });
        return this.toView(cert);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // userId+courseId conflict → another request issued it; return that.
          const dup = await this.prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
          if (dup) return this.toView(dup);
          continue; // serial collision → retry with a fresh serial
        }
        throw err;
      }
    }
    throw new BadRequestException('Could not issue certificate');
  }

  async listMine(userId: string): Promise<CertificateView[]> {
    const certs = await this.prisma.certificate.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' } });
    return certs.map((c) => this.toView(c));
  }

  /** Public verification by serial. */
  async verify(serial: string): Promise<CertificateView | null> {
    const cert = await this.prisma.certificate.findUnique({ where: { serial } });
    return cert ? this.toView(cert) : null;
  }

  // ─── Referrals ──────────────────────────────────────────────────────────

  async getReferral(userId: string, appBaseUrl: string): Promise<ReferralView> {
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (!user.referralCode) {
      // Generate lazily; retry on the unlikely unique collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = this.newReferralCode();
        try {
          await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
          user = { referralCode: code };
          break;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
          throw err;
        }
      }
    }
    const code = user.referralCode!;
    const referredCount = await this.prisma.user.count({ where: { referredById: userId } });
    return { code, shareUrl: `${appBaseUrl.replace(/\/$/, '')}/r/${code}`, referredCount };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private newSerial(): string {
    return formatSerial(randomBytes(8).toString('hex'));
  }

  private newReferralCode(): string {
    return randomBytes(5).toString('hex').toUpperCase().replace(/[^0-9A-HJ-NP-Z]/g, '').slice(0, 8).padEnd(6, '0');
  }

  private async resolveCourseTitle(courseId: string, sourceLocale: string, fallbackSlug: string): Promise<string> {
    const t = await this.prisma.contentTranslation.findFirst({
      where: { entityType: 'COURSE', entityId: courseId, field: 'title', locale: sourceLocale },
      select: { value: true },
    });
    return t?.value || fallbackSlug;
  }

  private toView(c: Certificate): CertificateView {
    return {
      serial: c.serial,
      recipientName: c.recipientName,
      courseTitle: c.courseTitle,
      isCapstone: c.isCapstone,
      issuedAt: c.issuedAt.toISOString(),
      courseId: c.courseId,
    };
  }
}

/** Branded SVG certificate (server-rendered, shareable/printable). */
export function renderCertificateSvg(cert: CertificateView): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string));
  const date = new Date(cert.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const kind = cert.isCapstone ? 'Capstone Certificate' : 'Certificate of Completion';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="848" viewBox="0 0 1200 848" role="img" aria-label="${esc(kind)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="848" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="768" fill="none" stroke="#7c5cff" stroke-width="4" rx="16"/>
  <text x="600" y="150" text-anchor="middle" fill="#7c5cff" font-family="Georgia, serif" font-size="34" letter-spacing="6">CODIFY</text>
  <text x="600" y="250" text-anchor="middle" fill="#e2e8f0" font-family="Georgia, serif" font-size="44">${esc(kind)}</text>
  <text x="600" y="320" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="22">This certifies that</text>
  <text x="600" y="410" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="60" font-weight="bold">${esc(cert.recipientName)}</text>
  <text x="600" y="480" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="22">has successfully completed</text>
  <text x="600" y="555" text-anchor="middle" fill="#e2e8f0" font-family="Georgia, serif" font-size="40">${esc(cert.courseTitle)}</text>
  <text x="600" y="700" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="20">${esc(date)}</text>
  <text x="600" y="740" text-anchor="middle" fill="#7c5cff" font-family="monospace" font-size="22" letter-spacing="2">${esc(cert.serial)}</text>
  <text x="600" y="772" text-anchor="middle" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="15">Verify at codify.app/verify/${esc(cert.serial)}</text>
</svg>`;
}
